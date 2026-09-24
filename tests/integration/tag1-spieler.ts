/**
 * The scripted player of the day-1 test (tests/integration/tag1.test.ts, M3-36; MASTERPROMPT §31.2
 * "Tag-1-Szenario (sammeln → Werkzeuge → Feuer → Nacht überleben)").
 *
 * It plays the headless game like a person at the keyboard: it looks at the world (chunks, the objects on
 * them, its bags, the clock, its vitals, the fire's fuel – read only) and acts **only** through the
 * commands the input layer and the UI send for a player (`PLAYER_COMMANDS`): walking with the stick
 * direction, aiming, holding E on a target, choosing a hotbar slot, moving items in the inventory screen,
 * crafting from the menu, using the item in hand – and E on the fire (feed it, light it) and on the river
 * (drink), which the interaction hands to the light and action systems. Debug commands (`inventory.give`,
 * `player.teleport`, time jumps …) are refused by `send`, so nothing in the day is a shortcut;
 * every command is validated like a replay file (`parseGameCommand`) and applied in the next tick.
 *
 * The script is a generator: each `yield` is one simulation tick (`Day1Player.run` steps the simulation
 * between them and hands the tick's events to the script). Walking uses a breadth-first path over the
 * collision grid – the way a player sees open ground, water and cliffs – with the rules of a land walker
 * (no swimming, no jumping down), steering towards tile centres.
 */
import { CONTENT } from '../../src/content/index';
import type { EventArgs } from '../../src/engine/events';
import { CommandRecorder } from '../../src/engine/commands';
import { parseGameCommand, type GameCommand, type GameCommandType } from '../../src/game/commands';
import type { CraftingSystem } from '../../src/game/crafting/system';
import type { FearSystem } from '../../src/game/fear/system';
import { isHarvested, isStump } from '../../src/game/gathering/objectState';
import type { GatheringSystem, ObjectHit } from '../../src/game/gathering/system';
import { createObjectHit } from '../../src/game/gathering/system';
import type { InventorySystem } from '../../src/game/inventory/system';
import type { BagArea, SlotRef } from '../../src/game/items/slots';
import type { LightSystem } from '../../src/game/light/system';
import type { WorldCollision } from '../../src/game/player/collision';
import type { PlayerSystem } from '../../src/game/player/system';
import type { SimEventMap, Simulation } from '../../src/game/sim';
import type { Vitals } from '../../src/game/survival/state';
import { LAND_CREATURE_RULES, blocksMover, infoCategories, infoConnector, infoLevel } from '../../src/world/collision/tiles';
import { WATER_DEPTH_MASK, WATER_FROZEN, WATER_SEA } from '../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX } from '../../src/world/model/coords';
import { contentWorldIdTables } from '../../src/world/model/runtimeIds';

/** The commands a player sends through keyboard, mouse and menus (docs/SPIEL.md §3) – nothing else is allowed. */
export const PLAYER_COMMANDS: ReadonlySet<GameCommandType> = new Set<GameCommandType>([
  'player.spawn',
  'player.move',
  'player.sprint',
  'player.aim',
  'player.interact',
  'player.selectHotbar',
  'player.useItem',
  'inventory.move',
  'craft.start',
]);

/** One event of a tick. */
export type TickEvent = EventArgs<SimEventMap>;

/** A tile. */
export interface Tile {
  readonly tx: number;
  readonly ty: number;
}

/** A world object the player can work: its anchor tile and footprint. */
interface Target extends Tile {
  readonly id: string;
  readonly w: number;
  readonly h: number;
}

/** Farthest the player looks for things [tiles] (about a screen and a half around it). */
const SIGHT_TILES = 48;
/** Most tiles a path search visits. */
const PATH_NODE_LIMIT = 40_000;
/** Distance to a tile centre that counts as arrived [px]. */
const ARRIVED_PX = 1.5;
/** Ticks without progress after which a walk gives up. */
const STUCK_TICKS = 90;
/** Longest a single harvest may take [ticks] (a Grünhain tree takes 5 axe swings of 0,5 s). */
const WORK_LIMIT_TICKS = 600;
/** Wait for the drops of a harvest (tree fall and flight) [ticks]. */
const DROP_WAIT_TICKS = 150;
/** Drops the player walks to after a harvest [tiles]. */
const DROP_REACH_TILES = 6;
/** Longest a craft may take [ticks] (the "gross" class plus margin). */
const CRAFT_LIMIT_TICKS = 3_600;

const IDS = contentWorldIdTables();

/** Areas the player's items lie in, searched in this order for an item to use. */
const CARRY_ORDER: readonly BagArea[] = ['schnellleiste', 'inventar', 'rucksackfach'];

/** Runtime ids of world objects whose drops include `item` (by the content's drop tables). */
export function objectsDropping(item: string, occasion: 'abbau' | 'roden' | 'ernte' = 'abbau'): string[] {
  return CONTENT.collection('worldObjects')
    .values()
    .filter((o) => (o.drops ?? []).some((d) => d.item === item && (d.anlass ?? 'abbau') === occasion))
    .map((o) => o.id);
}

/** Systems the player reads (never writes). */
interface Views {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly gathering: GatheringSystem;
  readonly light: LightSystem;
  readonly crafting: CraftingSystem;
  readonly fear: FearSystem;
  readonly collision: WorldCollision;
}

/** A step of the day: yields once per tick. */
export type Script = Generator<void, void, void>;

export class Day1Player {
  readonly sim: Simulation;
  /** Every command the player sent, tick-stamped (the replay proves the day depends on nothing else). */
  readonly recorder = new CommandRecorder<GameCommand>();
  /** Events of the last tick. */
  events: TickEvent[] = [];
  /** A short log of what happened (milestones), for the test's failure messages. */
  readonly log: string[] = [];
  private readonly v: Views;
  private readonly pos = { x: 0, y: 0 };
  private sentDx = 0;
  private sentDy = 0;
  private readonly hit: ObjectHit = createObjectHit();
  /** Targets that could not be reached or worked (never tried again). */
  private readonly skipped = new Set<string>();
  /** Drops seen landing and not yet gone. */
  private readonly drops = new Map<number, { x: number; y: number }>();

  constructor(sim: Simulation) {
    this.sim = sim;
    const get = <T>(id: string): T => sim.system(id) as unknown as T;
    this.v = {
      player: get('player'),
      inventory: get('inventory'),
      gathering: get('gathering'),
      light: get('light'),
      crafting: get('crafting'),
      fear: get('fear'),
      collision: get('world-collision'),
    };
    sim.commands.setSink(this.recorder);
  }

  // -------------------------------------------------------------------------------------------
  // Driving
  // -------------------------------------------------------------------------------------------

  /** Runs `script` to its end, one simulation tick per `yield`. */
  run(script: Script): void {
    for (;;) {
      const r = script.next();
      this.sim.step();
      this.events = [];
      this.sim.events.drain((...e) => this.events.push(e));
      this.observe();
      if (r.done === true) return;
    }
  }

  /** Queues a player command for the next tick; anything but a player's own command is a test error. */
  send(raw: GameCommand): void {
    if (!PLAYER_COMMANDS.has(raw.type)) throw new Error(`Day1Player: "${raw.type}" is not a command a player sends`);
    this.sim.commands.push(parseGameCommand(raw));
  }

  /** Waits `ticks` ticks. */
  *wait(ticks: number): Script {
    for (let i = 0; i < ticks; i++) yield;
  }

  /** Waits at least one tick, then until `until()` holds (checked after every tick) or `limit` ticks passed; returns whether it held. */
  *waitFor(until: () => boolean, limit: number): Generator<void, boolean, void> {
    for (let i = 0; i < limit; i++) {
      yield;
      if (until()) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // What the player sees
  // -------------------------------------------------------------------------------------------

  /** Position of the feet [px]. */
  get at(): { readonly x: number; readonly y: number } {
    if (!this.v.player.position(this.sim, this.pos)) throw new Error('Day1Player: no player');
    return this.pos;
  }

  /** Tile under the feet. */
  get tile(): Tile {
    const p = this.at;
    return { tx: Math.floor(p.x / TILE_PX), ty: Math.floor(p.y / TILE_PX) };
  }

  get vitals(): Vitals {
    const v = this.v.player.vitalsOf(this.sim.player);
    if (v === undefined) throw new Error('Day1Player: no vitals');
    return v;
  }

  get fear(): number {
    return this.v.fear.state.value;
  }

  /** Items of `item` in the bags. */
  count(item: string): number {
    return this.v.inventory.count(item);
  }

  /** The first slot holding `item`, or `null`. */
  slotOf(item: string): SlotRef | null {
    const bags = this.v.inventory.state;
    for (const bereich of CARRY_ORDER) {
      const slots = bags[bereich];
      for (let index = 0; index < slots.length; index++) if (slots[index]?.item === item) return { bereich, index };
    }
    return null;
  }

  /** The placed fire with id `id`. */
  fire(id: number): { readonly lit: boolean; readonly fuelSeconds: number } {
    const l = this.v.light.placed(id);
    if (l?.fire === null || l?.fire === undefined) return { lit: false, fuelSeconds: 0 };
    return { lit: l.fire.lit, fuelSeconds: l.fire.fuel / this.sim.clock.tickHz };
  }

  /** Events of the last tick of type `type`. */
  eventsOf<K extends keyof SimEventMap>(type: K): SimEventMap[K][] {
    return this.events.filter((e) => e[0] === type).map((e) => e[1] as SimEventMap[K]);
  }

  private observe(): void {
    for (const [type, payload] of this.events) {
      if (type === 'dropLanded') {
        const d = payload as SimEventMap['dropLanded'];
        this.drops.set(d.entity, { x: d.x, y: d.y });
      } else if (type === 'dropPickedUp' || type === 'dropExpired') {
        this.drops.delete((payload as SimEventMap['dropPickedUp']).entity);
      }
    }
    for (const e of [...this.drops.keys()]) if (!this.sim.ecs.alive(e)) this.drops.delete(e);
  }

  /** World objects of `ids` within sight, nearest first, that can be worked now (standing; `stumps`: felled trees). */
  targets(ids: readonly string[], stumps = false): Target[] {
    const wanted = new Set(ids.map((id) => IDS.objects.runtimeId(id)));
    const me = this.tile;
    const out: Array<Target & { d: number }> = [];
    const chunks = this.v.collision.chunks;
    for (let ty = me.ty - SIGHT_TILES; ty <= me.ty + SIGHT_TILES; ty++) {
      for (let tx = me.tx - SIGHT_TILES; tx <= me.tx + SIGHT_TILES; tx++) {
        const chunk = chunks.get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
        if (chunk === undefined) continue;
        const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
        const r = chunk.object[i] as number;
        if (r === 0 || !wanted.has(r)) continue;
        const key = `${tx},${ty}`;
        if (this.skipped.has(key)) continue;
        const state = chunk.objectState.get(i);
        if (isHarvested(state) || isStump(state) !== stumps) continue;
        if (!this.v.gathering.objectAt(0, tx, ty, this.hit) || this.hit.rule === null) continue;
        out.push({ id: IDS.objects.stringId(r), tx, ty, w: this.hit.rule.footprintW, h: this.hit.rule.footprintH, d: Math.hypot(tx - me.tx, ty - me.ty) });
      }
    }
    return out.sort((a, b) => a.d - b.d || a.ty - b.ty || a.tx - b.tx);
  }

  /** The nearest fresh water tile (river, lake, spring; not the salty sea, not frozen) within sight, or `null`. */
  freshWater(): Tile | null {
    const me = this.tile;
    let best: Tile | null = null;
    let bestD = Infinity;
    const chunks = this.v.collision.chunks;
    for (let ty = me.ty - SIGHT_TILES; ty <= me.ty + SIGHT_TILES; ty++) {
      for (let tx = me.tx - SIGHT_TILES; tx <= me.tx + SIGHT_TILES; tx++) {
        const chunk = chunks.get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
        if (chunk === undefined) continue;
        const w = chunk.water[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number;
        if ((w & WATER_DEPTH_MASK) === 0 || (w & (WATER_SEA | WATER_FROZEN)) !== 0) continue;
        const d = Math.hypot(tx - me.tx, ty - me.ty);
        if (d < bestD) {
          bestD = d;
          best = { tx, ty };
        }
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // Walking
  // -------------------------------------------------------------------------------------------

  /**
   * Shortest 4-connected path from the player's tile to a tile for which `goal` holds, over ground a land
   * walker can cross (no deep water, no cliff faces, levels changed only on ramps). Returns the tiles after
   * the start, or `null`.
   */
  path(goal: (tx: number, ty: number) => boolean): Tile[] | null {
    const grid = this.v.collision.grid;
    grid.beginQuery();
    const start = this.tile;
    const key = (tx: number, ty: number): number => (ty << 16) | tx;
    const prev = new Map<number, number>([[key(start.tx, start.ty), -1]]);
    const queue: Tile[] = [start];
    for (let head = 0; head < queue.length && prev.size < PATH_NODE_LIMIT; head++) {
      const t = queue[head] as Tile;
      if (goal(t.tx, t.ty)) {
        const out: Tile[] = [];
        for (let k = key(t.tx, t.ty); k !== key(start.tx, start.ty); k = prev.get(k) as number) out.push({ tx: k & 0xffff, ty: k >> 16 });
        return out.reverse();
      }
      const ref = grid.info(0, t.tx, t.ty);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = t.tx + dx;
        const ny = t.ty + dy;
        const k = key(nx, ny);
        if (prev.has(k) || blocksMover(LAND_CREATURE_RULES, ref, grid.info(0, nx, ny), 0)) continue;
        prev.set(k, key(t.tx, t.ty));
        queue.push({ tx: nx, ty: ny });
      }
    }
    return null;
  }

  /** Steers towards world px (x, y): the stick direction, sent only when it changes. */
  private steer(x: number, y: number): void {
    const p = this.at;
    const dx = x - p.x;
    const dy = y - p.y;
    const len = Math.hypot(dx, dy);
    const ux = len < ARRIVED_PX ? 0 : Math.round((dx / len) * 100) / 100;
    const uy = len < ARRIVED_PX ? 0 : Math.round((dy / len) * 100) / 100;
    if (ux === this.sentDx && uy === this.sentDy) return;
    this.sentDx = ux;
    this.sentDy = uy;
    this.send({ type: 'player.move', dx: ux, dy: uy });
  }

  /** Lets go of the stick. */
  *stop(): Script {
    if (this.sentDx !== 0 || this.sentDy !== 0) {
      this.sentDx = 0;
      this.sentDy = 0;
      this.send({ type: 'player.move', dx: 0, dy: 0 });
      yield;
    }
  }

  /** Walks along `path` (tile centres); returns false when stuck. */
  *walk(path: readonly Tile[]): Generator<void, boolean, void> {
    for (const t of path) {
      const x = t.tx * TILE_PX + TILE_PX / 2;
      const y = t.ty * TILE_PX + TILE_PX / 2;
      let best = Infinity;
      let still = 0;
      for (;;) {
        const p = this.at;
        const d = Math.hypot(x - p.x, y - p.y);
        if (d < ARRIVED_PX) break;
        if (d < best - 0.1) {
          best = d;
          still = 0;
        } else if (++still > STUCK_TICKS) {
          yield* this.stop();
          return false;
        }
        this.steer(x, y);
        yield;
      }
    }
    yield* this.stop();
    return true;
  }

  /** Walks next to (within one tile of) the footprint of `t`; returns false if there is no way. */
  *approach(t: Target): Generator<void, boolean, void> {
    const inside = (tx: number, ty: number): boolean => tx >= t.tx && tx < t.tx + t.w && ty <= t.ty && ty > t.ty - t.h;
    const path = this.path((tx, ty) => !inside(tx, ty) && tx >= t.tx - 1 && tx <= t.tx + t.w && ty >= t.ty - t.h && ty <= t.ty + 1);
    if (path === null) return false;
    return yield* this.walk(path);
  }

  /** Walks onto tile (tx, ty); returns false if there is no way. */
  *goTo(tx: number, ty: number): Generator<void, boolean, void> {
    const path = this.path((x, y) => x === tx && y === ty);
    if (path === null) return false;
    return yield* this.walk(path);
  }

  /** Walks to a tile from which (tx, ty) lies within `reach` tiles; returns false if there is no way. */
  *approachTile(tx: number, ty: number, reach: number): Generator<void, boolean, void> {
    const path = this.path((x, y) => (x !== tx || y !== ty) && Math.hypot(x - tx, y - ty) <= reach);
    if (path === null) return false;
    return yield* this.walk(path);
  }

  // -------------------------------------------------------------------------------------------
  // Working
  // -------------------------------------------------------------------------------------------

  /** Aims at tile (tx, ty) and presses E once (down, then up); returns the events of both ticks. */
  *press(tx: number, ty: number): Generator<void, TickEvent[], void> {
    this.send({ type: 'player.aim', x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2 });
    this.send({ type: 'player.interact', on: true, tx, ty });
    yield;
    const down = this.events;
    this.send({ type: 'player.interact', on: false });
    yield;
    return [...down, ...this.events];
  }

  /** Aims at and holds E on the object `t` until it is harvested; returns whether it was. */
  *work(t: Target): Generator<void, boolean, void> {
    this.send({ type: 'player.aim', x: t.tx * TILE_PX + TILE_PX / 2, y: t.ty * TILE_PX + TILE_PX / 2 });
    this.send({ type: 'player.interact', on: true, tx: t.tx, ty: t.ty });
    let done = false;
    for (let i = 0; i < WORK_LIMIT_TICKS && !done; i++) {
      yield;
      if (this.eventsOf('harvested').some((h) => h.tx === t.tx && h.ty === t.ty)) done = true;
      else if (this.eventsOf('commandRejected').some((r) => r.type === 'player.interact')) break;
    }
    this.send({ type: 'player.interact', on: false });
    yield;
    return done;
  }

  /** Picks up the drops that landed around the player (walking into the magnet radius). */
  *collectDrops(): Script {
    yield* this.wait(DROP_WAIT_TICKS);
    for (let round = 0; round < DROP_REACH_TILES * 2 && this.drops.size > 0; round++) {
      const p = this.at;
      let best: { x: number; y: number } | null = null;
      let bestD = DROP_REACH_TILES * TILE_PX;
      for (const d of this.drops.values()) {
        const dist = Math.hypot(d.x - p.x, d.y - p.y);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      if (best === null) return;
      const goal = best;
      const path = this.path((tx, ty) => tx === Math.floor(goal.x / TILE_PX) && ty === Math.floor(goal.y / TILE_PX));
      if (path === null || !(yield* this.walk(path))) {
        for (const [e, d] of this.drops) if (d === goal) this.drops.delete(e);
        continue;
      }
      yield* this.wait(DROP_WAIT_TICKS / 2);
      for (const [e, d] of this.drops) if (d === goal && this.sim.ecs.alive(e)) this.drops.delete(e);
    }
  }

  /**
   * Gathers until the bags hold `count` of `item`, working the nearest reachable objects of `ids`
   * (standing ones; `stumps`: stumps of felled trees). Returns whether the goal was met.
   */
  *gather(item: string, count: number, ids: readonly string[], stumps = false): Generator<void, boolean, void> {
    while (this.count(item) < count) {
      const t = this.targets(ids, stumps).find((c) => !this.skipped.has(`${c.tx},${c.ty}`));
      if (t === undefined) return false;
      const reached = yield* this.approach(t);
      const worked = reached && (yield* this.work(t));
      if (!worked) {
        this.skipped.add(`${t.tx},${t.ty}`);
        continue;
      }
      yield* this.collectDrops();
    }
    return true;
  }

  /** Crafts `count` pieces of `recipe` from the menu and waits until they are done; returns whether they were. */
  *craft(recipe: string, count = 1): Generator<void, boolean, void> {
    this.send({ type: 'craft.start', recipe, count });
    let made = 0;
    for (let i = 0; i < CRAFT_LIMIT_TICKS * count && made < count; i++) {
      yield;
      if (this.eventsOf('commandRejected').some((r) => r.type === 'craft.start')) return false;
      for (const c of this.eventsOf('craftCompleted')) if (c.recipe === recipe) made++;
    }
    this.log.push(`${this.clockText()} ${recipe} ×${made}`);
    return made >= count;
  }

  /** `HH:MM` of the game clock. */
  clockText(): string {
    const c = this.sim.clock;
    return `Tag ${c.day} ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
  }

  /** Whether a tile is free ground on the player's level: nothing blocks it (no water, rock, object, cliff) and no light stands there. */
  freeGround(tx: number, ty: number): boolean {
    const grid = this.v.collision.grid;
    grid.beginQuery();
    const me = this.tile;
    const info = grid.info(0, tx, ty);
    return infoCategories(info) === 0 && !infoConnector(info) && infoLevel(info) === infoLevel(grid.info(0, me.tx, me.ty)) && this.v.light.lightAt(0, tx, ty) === undefined;
  }
}
