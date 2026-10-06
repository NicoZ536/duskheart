/**
 * Fishing (docs/SPIEL.md §20 "Angeln", MASTERPROMPT §14; M7-24; system `fishing`, place 34 of `SYSTEM_ORDER`).
 *
 * - **The rod** (`angel_holz`, tool kind `angel`): cast into open water or an open ice hole within `castReachTiles`
 *   (`fishing.cast`; E on water with the rod in the hand). The float flies `castSeconds`, then waits: the bite comes after a
 *   wait drawn from `hash(seed, cast tick)`, shortened by the bait (the first bait in the bags, block `koeder`), if any fish
 *   fits the water, biome, hour, weather and season there – chosen by weight, a preferred bait counting thrice. The float dips
 *   for `biteWindowSeconds`: a press of the reel (E held, or `fishing.reel {on}`) hooks the fish – the bait is eaten either
 *   way – and the fight begins (`fightStep`, src/game/fishing/formulas.ts): tension 0–1, the fish pulling, leaping and tiring,
 *   drawn from the stream `fishing`. Landed, the raw fish goes into the bags, the rod wears by one use, the skill `sammeln`
 *   gains `fisch_gefangen`. The line comes loose when the player walks off, puts the rod away, sleeps or dies.
 * - **Ice fishing:** the pickaxe cuts a hole into frozen water (`fishing.cutHole`), open for `iceHoleDays`; a cast into it
 *   fishes the water `eis`.
 * - **Fish traps** (`reuse`, `fishing.placeTrap`/`fishing.takeTrap`): set into open water, a trap catches at every 06:00 with
 *   `trap.catchChance` one fish that lives there (`reuse: true`), up to `trap.capacity` – from a hash of (seed, layer, tile,
 *   dawn), in active chunks at the dawn, in frozen ones for every dawn they missed when they wake (`catchUp`): the same draws.
 * - Save participant `fishing` (version 1): the line (phase, float, fish, fight), the traps per chunk, the ice holes.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { FISH } from '../../content/fishing/index';
import { FISH_WATERS, type FishRecord, type FishWater } from '../../content/fishing/schema';
import type { ItemDef } from '../../content/schema/item';
import type { WeatherStateId } from '../../content/weather';
import type { Calendar } from '../../world/calendar';
import type { WeatherSystem } from '../../world/climate/weather';
import { WATER_DEPTH_MASK, WATER_FROZEN, type ChunkData } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, isLayer, packChunkId, type Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import { waterSource } from '../actions/formulas';
import type { CommandOfType } from '../commands';
import { isValidRef, slotAt, withSlot } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import type { ItemCatalog } from '../items/catalog';
import type { SlotRef } from '../items/slots';
import { newStack, withCount, type ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import { facingToward } from '../interaction/formulas';
import type { FacingSource, PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { FishingRejectReason, FishLossReason } from './events';
import { FISH_SALT, biteWaitSeconds, castRoll, chooseFish, fightStep, fishDayPhase, startFight, trapRoll, type Fight, type FishConditions } from './formulas';
import { FISHING_PHASES, type FishingPhase, type FishingSample } from './types';

/** Id of the fishing system and its save participant. */
export const FISHING_SYSTEM_ID = 'fishing';
/** Data version of the `fishing` participant. */
export const FISHING_SAVE_VERSION = 1;
/** Tool kind of the rods. */
export const ROD_KIND = 'angel';
/** Tool kind that cuts ice holes. */
export const ICE_TOOL_KIND = 'spitzhacke';
/** The fish trap item (and placed trap). */
export const TRAP_ITEM = 'reuse';
/** The stream of the fight's draws (§28). */
export const FISHING_STREAM = 'fishing';

const B = BALANCE.fishing;
/** Biome a tile without one counts as (drawn test worlds). */
const FALLBACK_BIOME = 'gruenhain';
/** Reach of placing and emptying a trap, cutting a hole [px from the feet]. */
const HAND_REACH_PX = B.trap.reachTiles * TILE_PX;

/** Where the fishing happens: the resident chunks, the active zone, the weather. */
export interface FishingWorld {
  chunk(layer: Layer, cx: number, cy: number): ChunkData | undefined;
  activeChunks(): readonly ChunkData[];
  /** Weather region of a surface tile (−1: none). */
  regionAt(tx: number, ty: number): number;
  weather(): WeatherSystem | null;
}

/** The player's skill as far as fishing raises it (bound after the life systems). */
export interface FishingSkills {
  award(sim: Simulation, sourceId: string): unknown;
}

/** Dependencies of the fishing system. */
export interface FishingDeps {
  readonly world: FishingWorld;
  readonly calendar: Pick<Calendar, 'seasonOfDay' | 'clock'>;
  readonly inventory: InventorySystem;
  readonly catalog: ItemCatalog;
  readonly player: PlayerSystem;
  readonly spill: (sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number) => void;
  /** Whether the reel is held by E (`InteractionSystem.holding`); absent: only `fishing.reel`. */
  readonly holding?: () => boolean;
}

/** The line in the water. */
interface Line {
  phase: Exclude<FishingPhase, 'aus'>;
  layer: Layer;
  /** Float [world px]. */
  x: number;
  y: number;
  /** Where the float landed (the fight draws it home along this line) [world px]. */
  landX: number;
  landY: number;
  water: FishWater;
  castTick: number;
  /** Tick the phase began. */
  phaseTick: number;
  /** Tick of the bite (−1: no fish fits, none will bite). */
  biteTick: number;
  fish: string;
  /** The bait taken along (item id or ''). */
  bait: string;
  /** The reel was held when the float dipped: it must be let go and pressed again to hook. */
  heldAtBite: boolean;
  lost: FishLossReason | null;
  readonly fight: Fight;
}

/** An ice hole: tile and the day it was cut. */
export interface IceHole {
  readonly layer: Layer;
  readonly tx: number;
  readonly ty: number;
  readonly day: number;
}

/** A fish trap in the water. */
interface Trap {
  readonly layer: Layer;
  readonly tx: number;
  readonly ty: number;
  fish: string[];
}

/** The traps of one chunk. */
interface TrapChunk {
  readonly layer: Layer;
  readonly cx: number;
  readonly cy: number;
  traps: Trap[];
  processedTick: number;
}

const fishIdSchema = z.string().refine((id) => FISH.some((f) => f.id === id), { message: 'unknown fish' });
const snapshotSchema = z
  .object({
    line: z
      .object({
        phase: z.enum(FISHING_PHASES).exclude(['aus']),
        layer: z.number().int().refine(isLayer, { message: 'unknown layer' }),
        x: z.number().finite(),
        y: z.number().finite(),
        landX: z.number().finite(),
        landY: z.number().finite(),
        water: z.enum(FISH_WATERS),
        castTick: z.number().int().min(0),
        phaseTick: z.number().int().min(0),
        biteTick: z.number().int().min(-1),
        fish: z.union([z.literal(''), fishIdSchema]),
        bait: z.string(),
        heldAtBite: z.boolean(),
        lost: z.enum(['gerissen', 'entkommen', 'verpasst']).nullable(),
        reel: z.boolean(),
        fight: z
          .object({
            tension: z.number().min(0).max(1),
            pull: z.number().min(-1).max(1),
            pullLeft: z.number().finite(),
            leapLeft: z.number().min(0),
            stamina: z.number().min(0),
            distance: z.number().min(0),
          })
          .strict(),
      })
      .strict()
      .nullable(),
    traps: z.array(
      z
        .object({
          layer: z.number().int().refine(isLayer, { message: 'unknown layer' }),
          cx: z.number().int().min(0),
          cy: z.number().int().min(0),
          processedTick: z.number().int().min(0),
          traps: z.array(z.object({ tx: z.number().int(), ty: z.number().int(), fish: z.array(fishIdSchema).max(B.trap.capacity) }).strict()).min(1),
        })
        .strict(),
    ),
    holes: z.array(z.tuple([z.number().int().refine(isLayer, { message: 'unknown layer' }), z.number().int(), z.number().int(), z.number().int().min(1)])),
  })
  .strict();

/** The fish water of a tile's water bits (the spring is a river's), or null on dry land; frozen water is `eis`. */
export function fishWaterOf(water: number): FishWater | null {
  const source = waterSource(water);
  if (source === null) return null;
  if (source === 'quelle') return 'fluss';
  return source;
}

/** Whether `def` is a fishing rod. */
export function isRod(def: ItemDef | null): boolean {
  return def !== null && def.werkzeug?.art === ROD_KIND;
}

/** Row stride of a tile key: wider than any world (at most 2048 tiles, docs/WORLD.md §1). */
const KEY_STRIDE = 4096;
/** Layers from −8 up fit the key. */
const KEY_LAYER_BIAS = 8;

/** Key of tile (tx, ty) of `layer` (ice holes). */
function holeKey(layer: Layer, tx: number, ty: number): number {
  return ((layer + KEY_LAYER_BIAS) * KEY_STRIDE + ty) * KEY_STRIDE + tx;
}

export class FishingSystem implements SimSystem {
  readonly id = FISHING_SYSTEM_ID;
  readonly save: SaveParticipant;
  readonly commands: CommandHandlers;
  private readonly world: FishingWorld;
  private readonly calendar: Pick<Calendar, 'seasonOfDay' | 'clock'>;
  private readonly inventory: InventorySystem;
  private readonly catalog: ItemCatalog;
  private readonly player: PlayerSystem;
  private readonly spill: FishingDeps['spill'];
  private readonly holding: () => boolean;
  private skills: FishingSkills | null = null;
  private readonly seed: number;
  private readonly biomes = contentWorldIdTables().biomes;
  private lineValue: Line | null = null;
  /** `fishing.reel {on}` holds the reel (besides E). */
  private reelCmd = false;
  private readonly trapChunks = new Map<number, TrapChunk>();
  /** Open ice holes: tile key → the day they were cut (with layer and tile for saving). */
  private readonly holes = new Map<number, IceHole>();
  private readonly at = { x: 0, y: 0 };
  private readonly cond: { -readonly [K in keyof FishConditions]: FishConditions[K] } = { biome: FALLBACK_BIOME, water: 'see', phase: 'tag', weather: 'klar', season: 'fruehling' };
  private readonly draw: () => number;
  private drawSim: Simulation | null = null;

  constructor(sim: Simulation, deps: FishingDeps) {
    this.world = deps.world;
    this.calendar = deps.calendar;
    this.inventory = deps.inventory;
    this.catalog = deps.catalog;
    this.player = deps.player;
    this.spill = deps.spill;
    this.holding = deps.holding ?? (() => false);
    this.seed = sim.config.seed;
    this.draw = () => (this.drawSim as Simulation).rng.stream(FISHING_STREAM).next();
    this.commands = {
      'fishing.cast': (s, cmd, tick) => this.reject(s, cmd.type, this.cast(s, cmd, tick), tick),
      'fishing.reel': (_s, cmd) => {
        this.reelCmd = cmd.on;
      },
      'fishing.cancel': (s, cmd, tick) => this.reject(s, cmd.type, this.cancel(s, tick), tick),
      'fishing.placeTrap': (s, cmd, tick) => this.reject(s, cmd.type, this.placeTrap(s, cmd, tick), tick),
      'fishing.takeTrap': (s, cmd, tick) => this.reject(s, cmd.type, this.takeTrap(s, cmd.tx, cmd.ty, tick), tick),
      'fishing.cutHole': (s, cmd, tick) => this.reject(s, cmd.type, this.cutHole(s, cmd.tx, cmd.ty, tick), tick),
    };
    this.save = {
      id: FISHING_SYSTEM_ID,
      version: FISHING_SAVE_VERSION,
      // Saves before M7 (versions 1–3): no line, no traps, no holes (§27).
      migrations: [{ from: 0, migrate: () => ({ line: null, traps: [], holes: [] }) }],
      serialize: () => this.serialize(),
      deserialize: (data: unknown) => this.restore(data),
    };
  }

  /** Binds the skills (experience of a caught fish). */
  useSkills(skills: FishingSkills): void {
    this.skills = skills;
  }

  private reject(sim: Simulation, type: CommandOfType<'fishing.cast'>['type'] | 'fishing.cancel' | 'fishing.placeTrap' | 'fishing.takeTrap' | 'fishing.cutHole', reason: FishingRejectReason | 'noPlayer' | 'outOfReach' | 'bagsFull' | null, tick: number): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  /** The phase of the line (`aus` without one). */
  get phase(): FishingPhase {
    return this.lineValue?.phase ?? 'aus';
  }

  /** Whether the reel is held (E or `fishing.reel`). */
  get reeling(): boolean {
    return this.reelCmd || this.holding();
  }

  /**
   * The facing while a line is out (`PlayerSystem.addFacingSource`, after the fight's): towards the float – the figure looks
   * where it fishes, the rod held out over the water. Null without a line (or once it is landed or lost).
   */
  readonly facingSource: FacingSource = (sim, current) => {
    const l = this.lineValue;
    if (l === null || l.phase === 'gefangen' || l.phase === 'verloren' || this.feet(sim) === null) return null;
    return facingToward(l.x - this.at.x, l.y - this.at.y, current);
  };

  /** Fills `out` with the line for the renderer and the HUD (a held record). */
  sample(out: FishingSample): FishingSample {
    const l = this.lineValue;
    out.phase = l?.phase ?? 'aus';
    out.floatX = l?.x ?? 0;
    out.floatY = l?.y ?? 0;
    out.tension = l?.phase === 'drill' ? l.fight.tension : 0;
    out.pull = l?.phase === 'drill' ? l.fight.pull : 0;
    out.fish = l?.fish ?? '';
    out.layer = l?.layer ?? 0;
    out.reeling = l !== null && this.reeling;
    out.distance = l?.phase === 'drill' ? l.fight.distance : 0;
    out.leaping = l?.phase === 'drill' && l.fight.leapLeft > 0;
    out.grund = l?.lost ?? '';
    return out;
  }

  /** The traps of chunk (layer, cx, cy) for the renderer (read them, do not change them). */
  trapsIn(layer: Layer, cx: number, cy: number): readonly { readonly tx: number; readonly ty: number; readonly fish: readonly string[] }[] {
    return this.trapChunks.get(packChunkId(layer, cx, cy))?.traps ?? NO_TRAPS;
  }

  /** Calls `visit` with every fish trap, chunk by chunk in ascending packed id (the reference save's facts, tests). */
  forEachTrap(visit: (layer: Layer, tx: number, ty: number, fish: readonly string[]) => void): void {
    for (const id of [...this.trapChunks.keys()].sort((a, b) => a - b)) {
      const c = this.trapChunks.get(id);
      if (c !== undefined) for (const t of c.traps) visit(c.layer, t.tx, t.ty, t.fish);
    }
  }

  /** The trap on tile (tx, ty), or undefined. */
  trapAt(layer: Layer, tx: number, ty: number): { readonly fish: readonly string[] } | undefined {
    const c = this.trapChunks.get(packChunkId(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT));
    return c?.traps.find((t) => t.tx === tx && t.ty === ty);
  }

  /** The ice holes cut so far (open while `day − day cut < iceHoleDays`; the renderer iterates them with `forEach`). */
  get iceHoles(): ReadonlyMap<number, IceHole> {
    return this.holes;
  }

  /** Whether an open ice hole is on tile (tx, ty) today. */
  holeOpen(layer: Layer, tx: number, ty: number, day: number): boolean {
    const h = this.holes.get(holeKey(layer, tx, ty));
    return h !== undefined && day - h.day < B.iceHoleDays;
  }

  /** The water bits of tile (tx, ty), or 0 when the chunk is not resident. */
  waterAt(layer: Layer, tx: number, ty: number): number {
    const chunk = this.world.chunk(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    return chunk === undefined ? 0 : (chunk.water[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number);
  }

  /** Whether a cast may go to tile (tx, ty) now: open water, or frozen water with an open hole; the refusal otherwise. */
  castProblem(layer: Layer, tx: number, ty: number, day: number): 'noWater' | 'iceClosed' | null {
    const w = this.waterAt(layer, tx, ty);
    if ((w & WATER_DEPTH_MASK) === 0) return 'noWater';
    if ((w & WATER_FROZEN) !== 0 && !this.holeOpen(layer, tx, ty, day)) return 'iceClosed';
    return null;
  }

  /** The rod in the hand (the selected hotbar slot), or null. */
  private rodInHand(): ItemStack | null {
    const stack = this.inventory.selected();
    return stack !== null && isRod(this.catalog.get(stack.item)) ? stack : null;
  }

  /** The player's feet into `this.at` and its layer, or null without a capable player. */
  private feet(sim: Simulation): Layer | null {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.at) || this.player.incapacity(sim) !== null) return null;
    return body.layer;
  }

  // -------------------------------------------------------------------------------------------
  // The rod
  // -------------------------------------------------------------------------------------------

  private cast(sim: Simulation, cmd: CommandOfType<'fishing.cast'>, tick: number): FishingRejectReason | 'noPlayer' | null {
    const layer = this.feet(sim);
    if (layer === null) return 'noPlayer';
    if (this.rodInHand() === null) return 'noRod';
    if (this.lineValue !== null) return 'lineOut';
    const dx = cmd.x - this.at.x;
    const dy = cmd.y - this.at.y;
    if (dx * dx + dy * dy > (B.castReachTiles * TILE_PX) ** 2) return 'tooFar';
    const tx = Math.floor(cmd.x / TILE_PX);
    const ty = Math.floor(cmd.y / TILE_PX);
    const problem = this.castProblem(layer, tx, ty, sim.clock.day);
    if (problem !== null) return problem;
    const water = fishWaterOf(this.waterAt(layer, tx, ty)) as FishWater;
    const bait = this.baitInBags();
    const line: Line = {
      phase: 'wurf',
      layer,
      x: cmd.x,
      y: cmd.y,
      landX: cmd.x,
      landY: cmd.y,
      water,
      castTick: tick,
      phaseTick: tick,
      biteTick: -1,
      fish: '',
      bait: bait?.id ?? '',
      heldAtBite: false,
      lost: null,
      fight: { tension: 0, pull: 0, pullLeft: 0, leapLeft: 0, stamina: 0, distance: 0 },
    };
    this.lineValue = line;
    sim.events.push('fishCast', { layer, x: cmd.x, y: cmd.y, gewaesser: water, tick });
    return null;
  }

  /** `fishing.cancel`: reel in at once; a biting or hooked fish gets away. */
  private cancel(sim: Simulation, tick: number): FishingRejectReason | null {
    const l = this.lineValue;
    if (l === null || l.phase === 'gefangen' || l.phase === 'verloren') return 'noLine';
    if (l.phase === 'biss' || l.phase === 'drill') this.lose(sim, l, 'entkommen', tick);
    else this.end(sim, l, 'eingeholt', tick);
    return null;
  }

  /** The first bait in the bags (hotbar first), or null. */
  private baitInBags(): ItemDef | null {
    const state = this.inventory.state;
    for (const area of [state.schnellleiste, state.inventar]) {
      for (let i = 0; i < area.length; i++) {
        const s = area[i];
        if (s === null || s === undefined) continue;
        const def = this.catalog.get(s.item);
        if (def.koeder !== undefined) return def;
      }
    }
    return null;
  }

  private end(sim: Simulation, l: Line, grund: 'eingeholt' | 'losgerissen', tick: number): void {
    this.lineValue = null;
    sim.events.push('castEnded', { layer: l.layer, x: l.x, y: l.y, grund, tick });
  }

  private lose(sim: Simulation, l: Line, grund: FishLossReason, tick: number): void {
    l.phase = 'verloren';
    l.phaseTick = tick;
    l.lost = grund;
    sim.events.push('fishLost', { layer: l.layer, x: l.x, y: l.y, fish: l.fish, grund, tick });
  }

  /** The line's tick: flight, wait, bite, fight, result (see module comment). */
  update(sim: Simulation): void {
    const l = this.lineValue;
    if (l === null) return;
    const tick = sim.eventTick;
    const hz = BALANCE.time.tickHz;
    if (l.phase === 'gefangen' || l.phase === 'verloren') {
      if (tick - l.phaseTick >= Math.round(B.resultSeconds * hz)) this.lineValue = null;
      return;
    }
    // The line comes loose: no capable player, no rod in the hand, another layer, too far off.
    const layer = this.feet(sim);
    const slack = (B.castReachTiles + B.lineSlackTiles) * TILE_PX;
    if (layer === null || layer !== l.layer || this.rodInHand() === null || (this.at.x - l.x) ** 2 + (this.at.y - l.y) ** 2 > slack * slack) {
      if (l.phase === 'drill' || l.phase === 'biss') this.lose(sim, l, 'entkommen', tick);
      else this.end(sim, l, 'losgerissen', tick);
      return;
    }
    const reeling = this.reeling;
    switch (l.phase) {
      case 'wurf':
        if (tick - l.phaseTick < Math.round(B.castSeconds * hz)) return;
        l.phase = 'warten';
        l.phaseTick = tick;
        {
          const bait = l.bait === '' ? undefined : this.catalog.get(l.bait).koeder;
          const wait = biteWaitSeconds(castRoll(this.seed, l.castTick, FISH_SALT.bite), bait?.biss ?? 1);
          l.biteTick = tick + Math.max(1, Math.round(wait * hz));
        }
        return;
      case 'warten':
        if (l.biteTick < 0 || tick < l.biteTick) return;
        this.bite(sim, l, tick, reeling);
        return;
      case 'biss':
        if (l.heldAtBite && !reeling) l.heldAtBite = false;
        if (reeling && !l.heldAtBite) {
          l.phase = 'drill';
          l.phaseTick = tick;
          const fish = FISH.find((f) => f.id === l.fish) as FishRecord;
          startFight(l.fight, fish, Math.hypot(l.landX - this.at.x, l.landY - this.at.y) / TILE_PX);
          sim.events.push('fishHooked', { layer: l.layer, x: l.x, y: l.y, fish: l.fish, tick });
          return;
        }
        if (tick - l.phaseTick >= Math.round(B.biteWindowSeconds * hz)) this.lose(sim, l, 'verpasst', tick);
        return;
      case 'drill':
        this.fight(sim, l, reeling, tick);
        return;
      default:
        return;
    }
  }

  /** The float dips: the fish that fits (none: no bite at all), the bait eaten. */
  private bite(sim: Simulation, l: Line, tick: number, reeling: boolean): void {
    const tx = Math.floor(l.x / TILE_PX);
    const ty = Math.floor(l.y / TILE_PX);
    const c = this.cond;
    c.biome = this.biomeAt(l.layer, tx, ty);
    c.water = l.water;
    const day = sim.clock.day;
    c.season = this.calendar.seasonOfDay(day);
    c.phase = fishDayPhase(c.season, this.calendar.clock.hour);
    c.weather = this.weatherAt(l.layer, tx, ty);
    const baitDef = l.bait === '' || this.inventory.count(l.bait) === 0 ? null : this.catalog.get(l.bait);
    const fish = chooseFish(FISH, c, false, baitDef?.id ?? '', baitDef?.koeder, castRoll(this.seed, l.castTick, FISH_SALT.fish));
    if (fish === null) {
      l.biteTick = -1;
      return;
    }
    if (baitDef !== null) this.inventory.take(sim, baitDef.id, 1);
    l.bait = baitDef?.id ?? '';
    l.fish = fish.id;
    l.phase = 'biss';
    l.phaseTick = tick;
    l.heldAtBite = reeling;
    sim.events.push('fishBite', { layer: l.layer, x: l.x, y: l.y, tick });
  }

  /** One tick of the fight; the float follows the fish home along the cast line. */
  private fight(sim: Simulation, l: Line, reeling: boolean, tick: number): void {
    const fish = FISH.find((f) => f.id === l.fish) as FishRecord;
    this.drawSim = sim;
    const outcome = fightStep(l.fight, fish, reeling, 1 / BALANCE.time.tickHz, this.draw);
    this.drawSim = null;
    const total = Math.hypot(l.landX - this.at.x, l.landY - this.at.y);
    const k = total <= 0 ? 0 : Math.min(1, (l.fight.distance * TILE_PX) / total);
    l.x = this.at.x + (l.landX - this.at.x) * k;
    l.y = this.at.y + (l.landY - this.at.y) * k;
    switch (outcome) {
      case 'sprung':
        sim.events.push('fishLeap', { layer: l.layer, x: l.x, y: l.y, fish: l.fish, tick });
        return;
      case 'gefangen':
        this.land(sim, l, fish, tick);
        return;
      case 'gerissen':
      case 'entkommen':
        this.lose(sim, l, outcome, tick);
        return;
      default:
        return;
    }
  }

  /** The fish is landed: into the bags (the rest at the feet), the rod wears, the skill learns. */
  private land(sim: Simulation, l: Line, fish: FishRecord, tick: number): void {
    l.phase = 'gefangen';
    l.phaseTick = tick;
    const stack = newStack(this.catalog.get(fish.id), 1);
    const { rest } = this.inventory.giveStack(sim, stack);
    if (rest > 0) this.spill(sim, withCount(stack, rest), l.layer, this.at.x, this.at.y);
    this.wearRod(sim, tick);
    sim.events.push('fishCaught', { layer: l.layer, x: l.x, y: l.y, fish: fish.id, tick });
    this.skills?.award(sim, B.experience);
  }

  /** The rod in the hand loses one use of its durability (§D "jede Nutzung"); at 0 it breaks. */
  private wearRod(sim: Simulation, tick: number): void {
    const state = this.inventory.state;
    const ref: SlotRef = { bereich: 'schnellleiste', index: state.auswahl };
    if (!isValidRef(state, ref)) return;
    const stack = slotAt(state, ref);
    if (stack === null || stack.haltbarkeit === undefined) return;
    const next = { ...stack, haltbarkeit: Math.max(0, stack.haltbarkeit - 1) };
    this.inventory.bags.replace(withSlot(state, ref, next));
    if (next.haltbarkeit === 0) sim.events.push('itemBroken', { at: { ...ref }, item: next.item, tick });
  }

  private biomeAt(layer: Layer, tx: number, ty: number): string {
    const chunk = this.world.chunk(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    const id = chunk === undefined ? 0 : (chunk.biome[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number);
    return id === 0 ? FALLBACK_BIOME : this.biomes.stringId(id);
  }

  private weatherAt(layer: Layer, tx: number, ty: number): WeatherStateId {
    const w = this.world.weather();
    const region = layer === 0 ? this.world.regionAt(tx, ty) : -1;
    return w === null || region < 0 || region >= w.regionCount ? 'klar' : w.state(region);
  }

  // -------------------------------------------------------------------------------------------
  // Ice holes
  // -------------------------------------------------------------------------------------------

  private cutHole(sim: Simulation, tx: number, ty: number, tick: number): FishingRejectReason | 'noPlayer' | 'outOfReach' | null {
    const layer = this.feet(sim);
    if (layer === null) return 'noPlayer';
    const tool = this.inventory.selected();
    if (tool === null || this.catalog.get(tool.item).werkzeug?.art !== ICE_TOOL_KIND) return 'noPickaxe';
    if (!this.near(tx, ty)) return 'outOfReach';
    const w = this.waterAt(layer, tx, ty);
    if ((w & WATER_DEPTH_MASK) === 0 || (w & WATER_FROZEN) === 0) return 'notIce';
    const day = sim.clock.day;
    if (this.holeOpen(layer, tx, ty, day)) return 'holeOpen';
    this.holes.set(holeKey(layer, tx, ty), { layer, tx, ty, day });
    sim.events.push('iceHoleCut', { layer, tx, ty, tick });
    return null;
  }

  /** Whether tile (tx, ty)'s centre lies within the hand reach of the feet (`this.at`). */
  private near(tx: number, ty: number): boolean {
    const dx = (tx + 0.5) * TILE_PX - this.at.x;
    const dy = (ty + 0.5) * TILE_PX - this.at.y;
    return dx * dx + dy * dy <= HAND_REACH_PX * HAND_REACH_PX;
  }

  // -------------------------------------------------------------------------------------------
  // Fish traps
  // -------------------------------------------------------------------------------------------

  private placeTrap(sim: Simulation, cmd: CommandOfType<'fishing.placeTrap'>, tick: number): FishingRejectReason | 'noPlayer' | 'outOfReach' | null {
    const layer = this.feet(sim);
    if (layer === null) return 'noPlayer';
    const state = this.inventory.state;
    if (!isValidRef(state, cmd.from)) return 'notTrap';
    const stack = slotAt(state, cmd.from);
    if (stack === null || stack.item !== TRAP_ITEM) return 'notTrap';
    if (!this.near(cmd.tx, cmd.ty)) return 'outOfReach';
    const w = this.waterAt(layer, cmd.tx, cmd.ty);
    if ((w & WATER_DEPTH_MASK) === 0 || (w & WATER_FROZEN) !== 0) return 'noWater';
    if (this.trapAt(layer, cmd.tx, cmd.ty) !== undefined) return 'trapThere';
    this.inventory.bags.replace(withSlot(state, cmd.from, stack.count > 1 ? withCount(stack, stack.count - 1) : null));
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    const id = packChunkId(layer, cmd.tx >> CHUNK_SHIFT, cmd.ty >> CHUNK_SHIFT);
    let c = this.trapChunks.get(id);
    if (c === undefined) {
      c = { layer, cx: cmd.tx >> CHUNK_SHIFT, cy: cmd.ty >> CHUNK_SHIFT, traps: [], processedTick: sim.clock.tick };
      this.trapChunks.set(id, c);
    }
    c.traps.push({ layer, tx: cmd.tx, ty: cmd.ty, fish: [] });
    sim.events.push('fishTrapPlaced', { layer, tx: cmd.tx, ty: cmd.ty, tick });
    return null;
  }

  /** E on a trap: its fish into the bags; an empty trap comes back into the bags itself. */
  private takeTrap(sim: Simulation, tx: number, ty: number, tick: number): FishingRejectReason | 'noPlayer' | 'outOfReach' | 'bagsFull' | null {
    const layer = this.feet(sim);
    if (layer === null) return 'noPlayer';
    const id = packChunkId(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    const c = this.trapChunks.get(id);
    const k = c === undefined ? -1 : c.traps.findIndex((t) => t.tx === tx && t.ty === ty);
    if (c === undefined || k < 0) return 'noTrap';
    if (!this.near(tx, ty)) return 'outOfReach';
    const trap = c.traps[k] as Trap;
    const x = (tx + 0.5) * TILE_PX;
    const y = (ty + 0.5) * TILE_PX;
    if (trap.fish.length > 0) {
      const n = trap.fish.length;
      for (const f of trap.fish) {
        const stack = newStack(this.catalog.get(f), 1);
        const { rest } = this.inventory.giveStack(sim, stack);
        if (rest > 0) this.spill(sim, stack, layer, x, y);
      }
      trap.fish = [];
      sim.events.push('fishTrapEmptied', { layer, tx, ty, anzahl: n, tick });
      return null;
    }
    const { rest } = this.inventory.giveStack(sim, newStack(this.catalog.get(TRAP_ITEM), 1));
    if (rest > 0) return 'bagsFull';
    c.traps.splice(k, 1);
    if (c.traps.length === 0) this.trapChunks.delete(id);
    sim.events.push('fishTrapTaken', { layer, tx, ty, tick });
    return null;
  }

  /** The traps of `c` catch at dawn `dawn` (dawn k ends day k); events only with `sim`. */
  /**
   * The traps of `c` catch at dawn `dawn`. Water and biome come from `chunk`, the trap chunk's own data: a frozen chunk that
   * catches up is not resident yet, so a lookup through the world would find no water there (and catch nothing).
   */
  private trapDawn(sim: Simulation | null, c: TrapChunk, chunk: ChunkData, dawn: number): void {
    const season = this.calendar.seasonOfDay(dawn);
    for (const t of c.traps) {
      if (t.fish.length >= B.trap.capacity) continue;
      if (trapRoll(this.seed, t.layer, t.tx, t.ty, dawn, FISH_SALT.trap) >= B.trap.catchChance) continue;
      const i = ((t.ty & CHUNK_MASK) << CHUNK_SHIFT) | (t.tx & CHUNK_MASK);
      const water = fishWaterOf(chunk.water[i] as number);
      if (water === null || water === 'eis') continue;
      const cond = this.cond;
      const biome = chunk.biome[i] as number;
      cond.biome = biome === 0 ? FALLBACK_BIOME : this.biomes.stringId(biome);
      cond.water = water;
      cond.season = season;
      const fish = chooseFish(FISH, cond, true, '', undefined, trapRoll(this.seed, t.layer, t.tx, t.ty, dawn, FISH_SALT.trapFish));
      if (fish === null) continue;
      t.fish.push(fish.id);
      if (sim !== null) sim.events.push('fishTrapCaught', { layer: t.layer, tx: t.tx, ty: t.ty, fish: fish.id, tick: sim.eventTick });
    }
  }

  /** The dawn of day `day` (dawn `day − 1`): the traps of the active chunks catch; ice holes closed by now are forgotten. */
  dailyTick(sim: Simulation, day: number): void {
    for (const [key, h] of this.holes) if (day - h.day >= B.iceHoleDays) this.holes.delete(key);
    if (this.trapChunks.size === 0) return;
    const chunks = this.world.activeChunks();
    for (let k = 0; k < chunks.length; k++) {
      const chunk = chunks[k] as ChunkData;
      const c = this.trapChunks.get(chunk.id);
      if (c === undefined) continue;
      this.trapDawn(sim, c, chunk, day - 1);
      c.processedTick = sim.clock.tick;
    }
  }

  /** A frozen chunk catches up: its traps catch at every dawn in (fromTick, toTick], silently. */
  catchUp(chunk: ChunkData, fromTick: number, toTick: number): void {
    const c = this.trapChunks.get(chunk.id);
    if (c === undefined) return;
    const perDay = this.calendar.clock.ticksPerDay;
    const last = Math.floor(toTick / perDay);
    for (let dawn = Math.floor(fromTick / perDay) + 1; dawn <= last; dawn++) this.trapDawn(null, c, chunk, dawn);
    c.processedTick = toTick;
  }

  // -------------------------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------------------------

  private serialize(): z.input<typeof snapshotSchema> {
    const l = this.lineValue;
    const traps = [...this.trapChunks.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => ({ layer: c.layer, cx: c.cx, cy: c.cy, processedTick: c.processedTick, traps: c.traps.map((t) => ({ tx: t.tx, ty: t.ty, fish: [...t.fish] })) }));
    const holes = [...this.holes.entries()].sort((a, b) => a[0] - b[0]).map(([, h]): [number, number, number, number] => [h.layer, h.tx, h.ty, h.day]);
    return {
      line:
        l === null
          ? null
          : {
              phase: l.phase,
              layer: l.layer,
              x: l.x,
              y: l.y,
              landX: l.landX,
              landY: l.landY,
              water: l.water,
              castTick: l.castTick,
              phaseTick: l.phaseTick,
              biteTick: l.biteTick,
              fish: l.fish,
              bait: l.bait,
              heldAtBite: l.heldAtBite,
              lost: l.lost,
              reel: this.reelCmd,
              fight: { ...l.fight },
            },
      traps,
      holes,
    };
  }

  private restore(data: unknown): void {
    const parsed = snapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`fishing snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    const d = parsed.data;
    const l = d.line;
    if (l !== null && l.bait !== '' && this.catalog.find(l.bait)?.koeder === undefined) throw new TypeError(`fishing snapshot invalid: "${l.bait}" is no bait`);
    if (l !== null && (l.phase === 'biss' || l.phase === 'drill' || l.phase === 'gefangen') && l.fish === '') throw new TypeError(`fishing snapshot invalid: phase ${l.phase} without a fish`);
    this.trapChunks.clear();
    for (const c of d.traps) {
      const id = packChunkId(c.layer as Layer, c.cx, c.cy);
      if (this.trapChunks.has(id)) throw new TypeError(`fishing snapshot invalid: chunk ${c.layer}:${c.cx}:${c.cy} twice`);
      const seen = new Set<number>();
      for (const t of c.traps) {
        if (t.tx >> CHUNK_SHIFT !== c.cx || t.ty >> CHUNK_SHIFT !== c.cy) throw new TypeError(`fishing snapshot invalid: trap ${t.tx},${t.ty} outside its chunk`);
        const key = ((t.ty & CHUNK_MASK) << CHUNK_SHIFT) | (t.tx & CHUNK_MASK);
        if (seen.has(key)) throw new TypeError(`fishing snapshot invalid: two traps on ${t.tx},${t.ty}`);
        seen.add(key);
      }
      this.trapChunks.set(id, { layer: c.layer as Layer, cx: c.cx, cy: c.cy, processedTick: c.processedTick, traps: c.traps.map((t) => ({ layer: c.layer as Layer, tx: t.tx, ty: t.ty, fish: [...t.fish] })) });
    }
    this.holes.clear();
    for (const [layer, tx, ty, day] of d.holes) this.holes.set(holeKey(layer as Layer, tx, ty), { layer: layer as Layer, tx, ty, day });
    this.reelCmd = l?.reel ?? false;
    this.lineValue = l === null ? null : { ...l, layer: l.layer as Layer, fight: { ...l.fight } };
  }
}

const NO_TRAPS: readonly Trap[] = Object.freeze([]);
