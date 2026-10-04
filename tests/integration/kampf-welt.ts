/**
 * The real game world for the fight's acceptance tests (M6-37, M6-18, M6-28; tests/integration/rudel.test.ts,
 * schattenbrut-licht.test.ts, kampf-balance.test.ts): `createSimulation` with the content's creatures, items, armour and
 * light – no probe creatures, no test light map. The player enters a small world at a chosen hour, stands on open ground
 * and is driven through validated game commands (debug commands where they save time: `setTime`, `debug.god`,
 * `inventory.give`, `player.teleport`, `creature.spawn`), like the fixture scenario (tools/save/fixture.ts).
 */
import { BALANCE } from '../../src/content/balance';
import type { CreatureDef } from '../../src/content/creatures/schema';
import { CONTENT } from '../../src/content/index';
import type { EventArgs } from '../../src/engine/events';
import type { Entity } from '../../src/engine/ecs';
import { createCombatAttack, type CombatAttack, type CombatSystem } from '../../src/game/combat/system';
import type { ConditionsSystem } from '../../src/game/conditions/system';
import { creatureDamage, grabBiteDamage } from '../../src/game/creatures/formulas';
import { maxHealthOf } from '../../src/game/creatures/population';
import { parseGameCommand, type GameCommand } from '../../src/game/commands';
import type { CreatureSystem } from '../../src/game/creatures/system';
import type { InventorySystem } from '../../src/game/inventory/system';
import { equipmentRef, type EquipmentSlot, type SlotRef } from '../../src/game/items/slots';
import type { LightSystem } from '../../src/game/light/system';
import type { WorldCollision } from '../../src/game/player/collision';
import type { PlayerSystem } from '../../src/game/player/system';
import { createSimulation } from '../../src/game/setup';
import type { SimEventMap, Simulation } from '../../src/game/sim';
import { BLOCK_ALL } from '../../src/world/collision/tiles';
import { TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_MASK } from '../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX } from '../../src/world/model/coords';

/** The world of the acceptance tests: the fixture world (small, start beach with sand and meadows behind it). */
export const KAMPF_WELT = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** Ticks for the player to appear and the zone to settle. */
const SETTLE_TICKS = 30;
/** Farthest an open spot is looked for [tiles]. */
const SPOT_SEARCH_TILES = 48;
/** Simulation ticks per second. */
const TICK_HZ = BALANCE.time.tickHz;

/** One event of a tick. */
export type TickEvent = EventArgs<SimEventMap>;

/** A tile. */
export interface Tile {
  readonly tx: number;
  readonly ty: number;
}

/** The world and its driver. */
export interface KampfWelt {
  readonly sim: Simulation;
  readonly player: PlayerSystem;
  readonly combat: CombatSystem;
  readonly creatures: CreatureSystem;
  readonly inventory: InventorySystem;
  readonly light: LightSystem;
  /** Runs one tick with `commands`, then `ticks − 1` more; returns the events of all of them. */
  run(commands?: readonly GameCommand[], ticks?: number): TickEvent[];
  /** Keeps `events` (of a step the caller did not read, e.g. `heal`'s cure) for the next `run`, which returns them first. */
  defer(events: readonly TickEvent[]): void;
  /** Runs `commands` and throws if one of them was refused. */
  ok(what: string, commands: readonly GameCommand[], ticks?: number): TickEvent[];
  /** The player's position [px]. */
  pos(): { x: number; y: number };
  /** The player's tile. */
  tile(): Tile;
  /** Teleports the player onto the centre of `t` and lets the zone settle. */
  goTo(t: Tile, ticks?: number): void;
  /** The nearest spot whose (2 · `half` + 1)² tiles are open ground (walkable, dry), `min` … `max` tiles (Chebyshev) from `from`. */
  openSpot(from: Tile, half: number, min?: number, max?: number): Tile;
  /** `count` creatures `id` around tile `at` (the debug spawn: free tiles nearest to it); their entities. */
  spawn(id: string, count: number, at: Tile): Entity[];
  /** Gives `item` and moves it into equipment slot `slot`. */
  wear(item: string, slot: EquipmentSlot): void;
  /** Gives `item` and puts it into the first hotbar slot, selected: the hand holds it. */
  hold(item: string): void;
  /** Light level of tile `t` of the surface (the gameplay light map the creatures read). */
  lightAt(t: Tile): number;
  /** Back to the skills the player entered with (every level 1): the measurements of §D are those of a fresh fighter. */
  freshSkills(): void;
  /** The nearest tile of shallow water (a swimmer's ground) around `from`. */
  waterNear(from: Tile): Tile;
}

function sys<T>(sim: Simulation, id: string): T {
  return sim.system(id) as unknown as T;
}

/** Centre of tile `t` [px]. */
export function centreOf(t: Tile): { x: number; y: number } {
  return { x: t.tx * TILE_PX + TILE_PX / 2, y: t.ty * TILE_PX + TILE_PX / 2 };
}

/** The tile of a position [px]. */
export function tileAt(p: { x: number; y: number }): Tile {
  return { tx: Math.floor(p.x / TILE_PX), ty: Math.floor(p.y / TILE_PX) };
}

/**
 * A fresh world at `hour`:`minute` of its first day (evening twilight 18–20 h: wolves and the brood awake, no night
 * spawner; night from 20 h: the night spawner too), the player on the start beach, god mode as asked.
 */
export function kampfWelt(opts: { readonly hour: number; readonly minute?: number; readonly god: boolean }): KampfWelt {
  const sim = createSimulation(KAMPF_WELT);
  const player = sys<PlayerSystem>(sim, 'player');
  const inventory = sys<InventorySystem>(sim, 'inventory');
  // Events of steps run on the side (`heal` curing conditions): returned first by the next `run`, so no tick's events are lost.
  const deferred: TickEvent[] = [];
  const run = (commands: readonly GameCommand[] = [], ticks = 1): TickEvent[] => {
    const out: TickEvent[] = deferred.splice(0);
    for (let i = 0; i < ticks; i++) {
      sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      sim.events.drain((...e) => out.push(e));
    }
    return out;
  };
  const ok = (what: string, commands: readonly GameCommand[], ticks = 1): TickEvent[] => {
    const events = run(commands, ticks);
    const refused = events.filter((e) => e[0] === 'commandRejected').map((e) => JSON.stringify(e[1]));
    if (refused.length > 0) throw new Error(`Kampfwelt: ${what} abgelehnt: ${refused.join(', ')}`);
    return events;
  };
  const pos = (): { x: number; y: number } => {
    const at = { x: 0, y: 0 };
    if (!player.position(sim, at)) throw new Error('Kampfwelt: kein Spieler');
    return at;
  };
  // Open ground: walkable (nothing that blocks – grass and flowers do not), dry, no ramp or stairs.
  const open = (x: number, y: number): boolean => {
    const chunk = sim.world.chunks.get(0, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
    if (chunk === undefined) return false;
    const i = ((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK);
    return (
      (sys<WorldCollision>(sim, 'world-collision').grid.tileInfo(0, x, y) & BLOCK_ALL) === 0 &&
      ((chunk.water[i] as number) & WATER_DEPTH_MASK) === 0 &&
      ((chunk.flags[i] as number) & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) === 0
    );
  };
  const w: KampfWelt = {
    sim,
    player,
    combat: sys<CombatSystem>(sim, 'combat'),
    creatures: sys<CreatureSystem>(sim, 'creatures'),
    inventory,
    light: sys<LightSystem>(sim, 'light'),
    run,
    defer: (events) => {
      deferred.push(...events);
    },
    ok,
    pos,
    tile: () => tileAt(pos()),
    goTo(t, ticks = 2) {
      ok('Teleport', [{ type: 'player.teleport', ...centreOf(t), layer: 0 }], ticks);
    },
    openSpot(from, half, min = 0, max = SPOT_SEARCH_TILES) {
      for (let r = min; r <= max; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            let free = true;
            for (let y = -half; y <= half && free; y++) for (let x = -half; x <= half && free; x++) free = open(from.tx + dx + x, from.ty + dy + y);
            if (free) return { tx: from.tx + dx, ty: from.ty + dy };
          }
        }
      }
      throw new Error(`Kampfwelt: kein freier Platz (${2 * half + 1}²) um ${from.tx},${from.ty}`);
    },
    spawn(id, count, at) {
      const events = ok(`${count} × ${id}`, [{ type: 'creature.spawn', creature: id, count, ...centreOf(at), layer: 0 }]);
      const out = events.filter((e) => e[0] === 'creatureSpawned' && (e[1] as SimEventMap['creatureSpawned']).creature === id).map((e) => (e[1] as SimEventMap['creatureSpawned']).entity);
      if (out.length !== count) throw new Error(`Kampfwelt: ${out.length} statt ${count} × ${id}`);
      return out;
    },
    wear(item, slot) {
      ok(`${item} geben`, [{ type: 'inventory.give', item, count: 1 }]);
      const from = slotOf(inventory, item);
      ok(`${item} anlegen`, [{ type: 'inventory.move', from, to: equipmentRef(slot), count: 1 }]);
    },
    hold(item) {
      const hand = { bereich: 'schnellleiste', index: 0 } as const;
      if (inventory.state.schnellleiste[0] !== null) ok('Hand leeren', [{ type: 'inventory.discard', from: hand }]);
      ok(`${item} geben`, [{ type: 'inventory.give', item, count: 1 }]);
      const from = slotOf(inventory, item);
      if (from.bereich !== 'schnellleiste' || from.index !== 0) ok(`${item} in die Hand`, [{ type: 'inventory.move', from, to: hand, count: 1 }]);
      ok('Hand wählen', [{ type: 'player.selectHotbar', index: 0 }]);
    },
    lightAt(t) {
      return sys<LightSystem>(sim, 'light').mapFor(sim).tileLevel(0, t.tx, t.ty);
    },
    waterNear(from) {
      for (let r = 0; r <= SPOT_SEARCH_TILES; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = from.tx + dx;
            const y = from.ty + dy;
            const chunk = sim.world.chunks.get(0, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
            if (chunk !== undefined && ((chunk.water[((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK)] as number) & WATER_DEPTH_MASK) !== 0) return { tx: x, ty: y };
          }
        }
      }
      throw new Error(`Kampfwelt: kein Wasser um ${from.tx},${from.ty}`);
    },
    freshSkills() {
      sim.participant('skills').deserialize(structuredClone(freshSkills));
    },
  };
  const freshSkills = sim.participant('skills').serialize();
  ok('Uhrzeit', [{ type: 'setTime', hour: opts.hour, minute: opts.minute ?? 0 }]);
  ok('Spieler erscheint', [{ type: 'player.spawn' }], SETTLE_TICKS);
  if (opts.god) ok('God-Modus', [{ type: 'debug.god', on: true }]);
  return w;
}

// ---------------------------------------------------------------------------------------------
// Measuring the §D numbers through the combat system (kampf-balance.test.ts, docs/BALANCE.md)
// ---------------------------------------------------------------------------------------------

/** A creature's attack as content writes it. */
export type ContentAttack = CreatureDef['angriffe'][number];

/**
 * The record of a light blow of the weapon in the hand – the first blow of a combo, no crit – as `CombatSystem.blow` builds
 * it from the hand's profile (src/game/combat/system.ts): the weapon's data through the real attack profile.
 */
export function playerBlow(w: KampfWelt): CombatAttack {
  const prof = w.combat.handProfile();
  const at = w.pos();
  const a = createCombatAttack();
  a.team = 'spieler';
  a.damage = prof.damage * (prof.combo[0] ?? 1);
  a.type = prof.art;
  a.wucht = prof.wucht;
  a.staggerSeconds = prof.staggerSeconds;
  a.critChance = 0;
  a.condition = prof.condition;
  a.kind = 'nahkampf';
  a.fromX = at.x;
  a.fromY = at.y;
  return a;
}

/**
 * The record of creature `e`'s attack `attack` as `CreatureSystem.strike` builds it (src/game/creatures/system.ts): its damage
 * on the difficulty of the world (Normal) times its variant's factor, its condition (with `sure`: always landing, for the
 * worst case of §D), crit chance `crit` (0: the ordinary blow, 1: the critical one of the one-shot check).
 */
export function creatureBlow(w: KampfWelt, e: Entity, attack: ContentAttack, crit: number, sure: boolean): CombatAttack {
  const s = w.creatures.store.get(e);
  if (s === undefined) throw new Error(`Kampfwelt: Kreatur ${e} fehlt`);
  const kind = w.creatures.catalog.get(s.creature);
  const v = s.variant >= 0 ? kind.def.varianten?.[s.variant] : undefined;
  const at = { x: 0, y: 0 };
  w.creatures.positionOf(e, at);
  const a = createCombatAttack();
  a.team = kind.def.team;
  a.damage = creatureDamage(attack.schaden * (v?.schaden ?? 1), w.creatures.difficulty);
  a.type = attack.schadensart;
  a.wucht = attack.wucht;
  a.staggerSeconds = attack.stagger;
  a.critChance = crit;
  a.condition = attack.zustand === undefined ? null : sure ? { ...attack.zustand, chance: 1 } : attack.zustand;
  a.blockable = attack.art !== 'flaeche';
  a.kind = 'nahkampf';
  a.fromX = at.x;
  a.fromY = at.y;
  return a;
}

/**
 * Spawns `creature` two tiles from the player – a swimmer on the nearest water –, as variant `variant` (−1: the base form)
 * at full health.
 */
export function foe(w: KampfWelt, creature: string, variant: number): Entity {
  const t = w.tile();
  const swims = w.creatures.catalog.get(creature).mover === 'schwimmer';
  const [e] = w.spawn(creature, 1, swims ? w.waterNear(t) : { tx: t.tx + 2, ty: t.ty });
  if (e === undefined) throw new Error(`Kampfwelt: ${creature} erschien nicht`);
  const s = w.creatures.store.get(e);
  if (s === undefined) throw new Error(`Kampfwelt: ${creature} fehlt`);
  if (variant >= 0) {
    const kind = w.creatures.catalog.get(creature);
    s.variant = variant;
    s.maxHealth = maxHealthOf(kind, variant);
    s.health = s.maxHealth;
  }
  return e;
}

/** Removes every creature of the world (between two measurements). */
export function clearCreatures(w: KampfWelt): void {
  w.run([{ type: 'creature.kill', radius: 64 }], 2);
}

/**
 * Hits of the weapon in the hand until `creature` (variant `variant`) falls: light first blows without crit, through
 * `CombatSystem.resolve` and the creature's own `applyHit` (resistance, armour, variant health). Also the damage per hit.
 */
export function hitsToKill(w: KampfWelt, creature: string, variant: number): { hits: number; perHit: number } {
  w.freshSkills();
  const e = foe(w, creature, variant);
  let hits = 0;
  let perHit = 0;
  for (; hits < 200; ) {
    const s = w.creatures.store.get(e);
    if (s === undefined || s.health <= 0) break;
    const h = w.combat.resolve(w.sim, w.sim.player, e, playerBlow(w));
    if (h === null) throw new Error(`Kampfwelt: ${creature} nimmt keinen Treffer an`);
    perHit = h.amount;
    hits++;
  }
  clearCreatures(w);
  return { hits, perHit };
}

/** What one attack takes from the player: the blow, its condition over its time, a grab's bites [HP]. */
export interface AttackToll {
  readonly blow: number;
  readonly condition: number;
  readonly bites: number;
  readonly total: number;
  /** The player's health after it, from full. */
  readonly left: number;
}

/**
 * The toll of attack `attack` of `creature` (variant `variant`) on the player as it stands (armour worn), from full health:
 * the blow through `CombatSystem.resolve` (crit chance `crit`), its condition landing for sure and running its seconds in
 * the world (the damage of `playerAfflicted`), and a grab's bites as `CreatureSystem.holdStep` deals them (unblockable, no
 * crit). The player is healed and cured before.
 */
export function attackToll(w: KampfWelt, creature: string, variant: number, attack: ContentAttack, crit = 0): AttackToll {
  heal(w);
  w.freshSkills();
  const e = foe(w, creature, variant);
  const v = w.player.vitalsOf(w.sim.player);
  if (v === undefined) throw new Error('Kampfwelt: keine Werte');
  const h = w.combat.resolve(w.sim, e, w.sim.player, creatureBlow(w, e, attack, crit, true));
  const blow = h?.amount ?? 0;
  let bites = 0;
  const grab = attack.festhalten;
  if (grab !== undefined) {
    const kind = w.creatures.catalog.get(creature);
    const factor = variant >= 0 ? (kind.def.varianten?.[variant]?.schaden ?? 1) : 1;
    const bite = createCombatAttack();
    bite.team = kind.def.team;
    bite.damage = creatureDamage(grabBiteDamage(grab) * factor, w.creatures.difficulty);
    bite.type = attack.schadensart;
    bite.critChance = 0;
    bite.blockable = false;
    for (let i = 0; i < grab.bisse; i++) bites += w.combat.resolve(w.sim, e, w.sim.player, bite)?.amount ?? 0;
  }
  clearCreatures(w);
  let condition = 0;
  if (attack.zustand !== undefined) {
    const events = w.run([], Math.ceil(attack.zustand.sekunden * TICK_HZ) + 2);
    for (const ev of events) if (ev[0] === 'playerAfflicted' && (ev[1] as SimEventMap['playerAfflicted']).source === 'zustand') condition += (ev[1] as SimEventMap['playerAfflicted']).amount;
  }
  const left = v.health;
  heal(w);
  return { blow, condition, bites, total: blow + condition + bites, left };
}

/** Back to full health, without the conditions a blow brings (conditions derived from the vitals refuse a cure and stay). */
export function heal(w: KampfWelt): void {
  // Only timed conditions can be cured; derived ones (`dauer.art: 'wert'`, e.g. well fed) follow the values and stay.
  const cure = sys<ConditionsSystem>(w.sim, 'conditions')
    .active()
    .filter((c) => CONTENT.collection('conditions').get(c.id).dauer.art !== 'wert')
    .map((c) => ({ type: 'conditions.cure', id: c.id }) as const);
  // The cure is a step of its own: its events (a bite landing in it, say) go to the caller's next `run`.
  if (cure.length > 0) w.defer(w.run(cure));
  const v = w.player.vitalsOf(w.sim.player);
  if (v !== undefined) v.health = v.maxHealth;
}

/** The first carried slot (hotbar, inventory, backpack compartment) holding `item`. */
function slotOf(inventory: InventorySystem, item: string): SlotRef {
  const bags = inventory.state;
  for (const bereich of ['schnellleiste', 'inventar', 'rucksackfach'] as const) {
    const index = bags[bereich].findIndex((s) => s?.item === item);
    if (index >= 0) return { bereich, index };
  }
  throw new Error(`Kampfwelt: ${item} ist nicht in den Taschen`);
}
