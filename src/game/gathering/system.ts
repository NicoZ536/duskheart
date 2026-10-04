/**
 * Harvesting the world (MASTERPROMPT §13.2, §14, §D; M3-11 … M3-14): felling trees, clearing stumps,
 * picking fruit, bushes, plants and scatter, mining rocks, ore nodes, crystals, solid rock and ore veins,
 * digging and tilling ground – and everything coming back.
 *
 * - **Plans and hits** (called by the interaction system, which holds the player's action): `planObject`
 *   / `planTile` tell what the held tool can do to a target (action, hits, why not); `hitObject` /
 *   `hitTile` apply one tool hit or a finished hand pick. A tool below the target's hardness strikes
 *   sparks and does nothing ("Zu hart", §13.2). Hit points of objects stay in the chunk's object state
 *   (§14 "Knoten mit Treffer-HP"; src/game/gathering/objectState.ts).
 * - **Results**: a felled tree leaves its stump and falls away from the player (§14); its drops fly out of
 *   the trunk when it lands and creatures under it take damage (`onTreeLanded`, the creature system of M5
 *   registers). Clearing a stump yields wood/resin and 40 % a sapling (drops `roden`). Picked bushes and
 *   fruit trees stand bare until they carry again; everything else leaves its tile. Drops are rolled from
 *   the object's content (`rollDrops`, stream `gathering`) and spawned by the drop system.
 * - **Tiles**: solid rock and ore veins (pickaxe) open into tunnels; the shovel turns grass into a path,
 *   digs pits in bare ground, deepens dug soil beside other dug ground into dry trenches (M4-36) and, next
 *   to water, opens water ditches whose water runs on along the connected dry trenches; right beside a
 *   river it brings up gravel (gravel banks); the hoe prepares fields (§14 "begrenztes Terraforming").
 *   Every change is chunk data – saved as chunk diffs (M2-27). The first stroke into a hidden dig spot
 *   brings up its find (`isDigSpot`, src/content/digSpots.ts).
 * - **Filling in** (M4-40, `refillable` / `refill`, used by the tools system with earth in the hand): a dug tile gets
 *   back the ground, water and flags its chunk was generated with (`generated`, the baseline of the chunk diffs); a
 *   filled water ditch takes the water from the ditches it fed that reach no open water any more, inside the active
 *   zone like the flooding. A dig spot filled in stays spent (saved in `gathering`).
 * - **Regrowth** (§14 "wächst … nach", "Oberflächenknoten wachsen außerhalb des Basisradius nach 7 Tagen
 *   nach"): stumps grow back into trees, bare bushes and fruit trees carry again, removed plants, nodes
 *   and cut bushes return after their regrow days – mushrooms only in their hours. Nothing regrows inside
 *   a base where the rules say so (`addBaseAreas`, the building system of M4). Active chunks are checked
 *   every world tick; frozen chunks catch up analytically (`catchUp`), the same way in any order.
 *   Removed objects that come back are remembered in the save participant `gathering` (the tile itself
 *   is empty); objects that stay keep their regrow tick in the chunk's object state.
 * - **Built ground** (`addGroundClaims`, the building system of M4): no shovel or hoe where a floor, structure or piece
 *   of furniture stands or is planned (`builtOver`), no water runs along a trench under it, nothing is filled in under
 *   it – the ground under a building stays what it was built on.
 * - **Hooks**: `addBaseAreas`, `addGroundClaims`, `onTreeLanded`, `setSkillBonus` (the skill system of M3-32: "+0,5 %
 *   Wirkung je Stufe" enters §D's hit formula), `setExperience` (every hit and finished harvest gives the
 *   experience of its source, §23.2 "EP-Quellen Sammeln"), `setObjectPowerFactor` (M6-06: a battle axe – a weapon with
 *   tool data of kind `axt` – fells trees and clears stumps with 50 % of its mining power).
 */
import { z } from 'zod';
import { BALANCE, type SeasonId } from '../../content/balance';
import { DIG_SPOT_LOOT } from '../../content/digSpots';
import type { Rng } from '../../engine/rng';
import type { Calendar } from '../../world/calendar';
import { BLOCK_OBJECT } from '../../world/collision/tiles';
import {
  NO_REGROW_TICK,
  TILE_FLAG_BRIDGE,
  TILE_FLAG_CLIFF_EDGE,
  TILE_FLAG_DUG,
  TILE_FLAG_PLACE,
  TILE_FLAG_RAMP,
  TILE_FLAG_ROAD,
  TILE_FLAG_STAIRS,
  WATER_DEPTH_MASK,
  WATER_DEPTH_SHALLOW,
  WATER_FROZEN,
  WATER_RIVER,
  type ChunkData,
} from '../../world/model/chunk';
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT, TILE_PX, isLayer, packChunkId, unpackChunkId, type ChunkCoord, type Layer } from '../../world/model/coords';
import type { ItemCatalog } from '../items/catalog';
import { newStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import type { SimSystem, Simulation } from '../sim';
import type { DropSystem } from '../drops/system';
import { FALL_VECTORS, fallDirection, hitDamage, hitsNeeded, isDigSpot, isRipe, powerSuffices, regrowTick, rollDrops, secondsToTicks, type FallDirection, type HourWindow, type RolledDrop } from './formulas';
import { GROWTH_GROWN, STAGE_HARVESTED, STAGE_STUMP, isHarvested, isStump } from './objectState';
import { contentGatheringRules, type GatheringRules, type HarvestAction, type HarvestMaterial, type HarvestSkill, type HarvestTool, type ObjectHarvest, type ObjectRule, type TileRule } from './rules';
import type { DigResult, FillKind } from './events';

/** Id of the gathering system and its save participant. */
export const GATHERING_SYSTEM_ID = 'gathering';
/** Data version of the `gathering` participant. */
export const GATHERING_SAVE_VERSION = 1;
/** Random stream of drops and dig finds. */
export const GATHERING_RNG_STREAM = 'gathering';

const HARVEST = BALANCE.harvest;
const MUSHROOM_WINDOW: HourWindow = HARVEST.mushrooms;
const MUSHROOMS: ReadonlySet<string> = new Set(HARVEST.mushrooms.objects);
/** Terrain ids of ground the hoe turns into fields (§14 "Felder"): meadow and bare earth. */
const TILLABLE_GROUND = ['gras', 'erde'] as const;
/** Ground a field lies on. */
const FIELD_GROUND = 'erde';
/** Flags on which nothing is dug: built or connecting ground (roads, bridges, ramps, stairs, places, cliff edges). */
const UNDIGGABLE_FLAGS = TILE_FLAG_ROAD | TILE_FLAG_BRIDGE | TILE_FLAG_RAMP | TILE_FLAG_STAIRS | TILE_FLAG_PLACE | TILE_FLAG_CLIFF_EDGE;
/** Offset of a tile's centre from its corner [px]. */
const HALF_TILE = TILE_PX / 2;
/** Where along the fallen trunk its drops pop out [share of the trunk length]: its middle. */
const TRUNK_DROP_SHARE = 0.5;
/** Row stride of `packTile`: wider than any world (at most 2048 tiles, WORLD.md §1), so neighbours of edge tiles never alias. */
const TILE_KEY_STRIDE = 65_536;
/** Key of a tile in a set of visited tiles. */
function packTile(tx: number, ty: number): number {
  return ty * TILE_KEY_STRIDE + tx;
}
/** 4-neighbourhood (water ditches connect to water beside them, not across corners). */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** A tool in the player's hand (resolved by the interaction system from the selected hotbar slot). */
export interface HeldTool {
  /** Tool kind of the item (`werkzeug.art`). */
  readonly kind: HarvestTool | string;
  /** Mining power (§13.2): what the tool opens (the tier check). */
  readonly power: number;
  /** Quality factor of the piece [×] (§13.1 "+10 % bzw. +20 % auf Werte": 1 / 1,1 / 1,2); absent = 1. */
  readonly qualityFactor?: number;
  /** Durability used up (§13.1 "Kaputt = unbenutzbar"). */
  readonly broken: boolean;
}

/**
 * Power of a hit with `tool` [power]: its mining power times its quality (§13.1 "Qualität … +10 % bzw. +20 % auf Werte")
 * – a better piece fells and mines in fewer hits; what it can open (`powerSuffices`) stays its mining power alone.
 */
export function hitPowerOf(tool: HeldTool): number {
  return tool.power * (tool.qualityFactor ?? 1);
}

/**
 * Share of its mining power the tool in the hand strikes world objects with [fraction] (M6-06: a battle axe fells trees
 * with 50 %, `BALANCE.combat.axe.fellPowerFactor`); 1 for real tools. What it can open stays its mining power.
 */
export type ObjectPowerFactor = (sim: Simulation) => number;

/** Why a target cannot be worked now (`builtOver`: a building stands or is planned on the ground). */
export const HARVEST_BLOCKS = ['needsTool', 'toolBroken', 'notRipe', 'regrowing', 'alreadyDug', 'notDiggable', 'builtOver', 'nothing'] as const;
export type HarvestBlock = (typeof HARVEST_BLOCKS)[number];

/** Whether something built claims the ground of tile (tx, ty) of `layer` (the building system: floors, walls, furniture, their blueprints). */
export type GroundClaim = (layer: Layer, tx: number, ty: number) => boolean;

/** A world object found on the map (anchor tile of its footprint). */
export interface ObjectHit {
  chunk: ChunkData | null;
  /** Local index of the anchor tile in `chunk`. */
  i: number;
  layer: Layer;
  tx: number;
  ty: number;
  rule: ObjectRule | null;
}

/** A fresh `ObjectHit`. */
export function createObjectHit(): ObjectHit {
  return { chunk: null, i: 0, layer: 0, tx: 0, ty: 0, rule: null };
}

/** What working a target would do (filled by `planObject` / `planTile`; allocation free). */
export interface HarvestPlan {
  /** A way exists; `block` says why it cannot run now (then the action does not start). */
  ok: boolean;
  block: HarvestBlock | null;
  /** Tool kind the block asks for (`needsTool`). */
  needs: HarvestTool | null;
  action: HarvestAction;
  tool: HarvestTool;
  material: HarvestMaterial;
  skill: HarvestSkill;
  /** Experience sources of a hit and of the finished work (src/content/skills.ts). */
  xpHit: string | null;
  xpDone: string;
  /** Target id: world object id or terrain id. */
  target: string;
  /** By hand: one pick; with a tool: hits. */
  byHand: boolean;
  /** The held tool is below the hardness (§13.2 "Zu hart"). */
  tooWeak: boolean;
  hardness: number;
  /** Hit points of the stage untouched and now [HP]. */
  hpMax: number;
  hp: number;
  /** Hits the held tool needs from untouched and from now (§D). */
  hitsTotal: number;
  hitsLeft: number;
  /** Harvest of an object (null for tiles). */
  harvest: ObjectHarvest | null;
  /** Tile work: rule, result. */
  tile: TileRule | null;
  dig: DigResult | null;
  /** Centre of the target [world px]. */
  x: number;
  y: number;
}

/** A fresh `HarvestPlan`. */
export function createHarvestPlan(): HarvestPlan {
  return {
    ok: false,
    block: 'nothing',
    needs: null,
    action: 'aufsammeln',
    tool: 'hand',
    material: 'pflanze',
    skill: 'sammeln',
    xpHit: null,
    xpDone: '',
    target: '',
    byHand: true,
    tooWeak: false,
    hardness: 0,
    hpMax: 0,
    hp: 0,
    hitsTotal: 0,
    hitsLeft: 0,
    harvest: null,
    tile: null,
    dig: null,
    x: 0,
    y: 0,
  };
}

/** Outcome of one hit. */
export type HitOutcome = 'hit' | 'done' | 'tooHard' | 'invalid';

/** Tells whether a tile lies inside a base (the building system of M4 registers one). */
export interface BaseAreas {
  inBase(layer: Layer, tx: number, ty: number): boolean;
}

/** A tree on its way down (saved). */
export interface TreeFall {
  readonly layer: Layer;
  readonly tx: number;
  readonly ty: number;
  readonly object: string;
  readonly direction: FallDirection;
  readonly landsAtTick: number;
  /** Rolled when it was felled; they fly out of the trunk on landing. */
  readonly drops: readonly RolledDrop[];
}

/** Called when a felled tree lands; the creature system damages what lies under the trunk. */
export type TreeLandedListener = (sim: Simulation, fall: TreeFall, trunk: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }, damage: number) => void;

/**
 * Listener of tilled ground (M7, docs/SPIEL.md §17 "Haken", §20 "Acker"; ADR-0175): the hoe made tile (tx, ty) of `layer`
 * a field (`tilled`), or it was filled in or built over (`!tilled`). The gathering hook `onTilled` (strand D) lets farming
 * create and drop its plot data.
 */
export type TilledListener = (sim: Simulation, layer: Layer, tx: number, ty: number, tilled: boolean) => void;

/** The skill bonus of a harvest (§23.2 "+0,5 % Wirkung je Stufe") [fraction]. */
export type SkillBonusSource = (sim: Simulation, skill: HarvestSkill) => number;
/** Receives the experience source (src/content/skills.ts) of a hit or a finished harvest (the skill system's `award`). */
export type ExperienceSink = (sim: Simulation, sourceId: string) => void;

/** The generated state of resident chunks: the baseline their diffs are taken against (`ChunkManager.generatedOf`). */
export interface GeneratedChunks {
  /** Chunk `chunk` as generated (read-only), or `undefined` when it is not known. */
  generatedOf(chunk: ChunkData): ChunkData | undefined;
}

/** Dependencies of the gathering system (built in `createSimulation`). */
export interface GatheringDeps {
  readonly collision: WorldCollision;
  readonly calendar: Calendar;
  readonly drops: DropSystem;
  readonly catalog: ItemCatalog;
  /** Chunks of the active zone (sorted, stable order). */
  readonly activeChunks: () => readonly ChunkData[];
  /** Where the player stands (a regrowing obstacle waits until the player stepped off it); false without player. */
  readonly playerAt: (out: { x: number; y: number; layer: Layer }) => boolean;
  readonly rules?: GatheringRules;
  /** The chunks as generated – what filling a dug tile in restores (M4-40); default: the simulation's chunk store. */
  readonly generated?: GeneratedChunks;
}

/** One removed object that comes back. */
interface Regrowth {
  readonly object: string;
  readonly at: number;
}

const regrowthSchema = z.object({ layer: z.number().int(), cx: z.number().int(), cy: z.number().int(), i: z.number().int().min(0), object: z.string().min(1), at: z.number().int().min(0) }).strict();
const fallSchema = z
  .object({
    layer: z.number().int(),
    tx: z.number().int(),
    ty: z.number().int(),
    object: z.string().min(1),
    direction: z.enum(['rechts', 'links', 'nord', 'sued']),
    landsAtTick: z.number().int().min(0),
    drops: z.array(z.object({ item: z.string().min(1), count: z.number().int().min(1) }).strict()),
  })
  .strict();
const spentSpotSchema = z.object({ layer: z.number().int(), cx: z.number().int(), cy: z.number().int(), i: z.number().int().min(0) }).strict();
/** `spentDigSpots` only when some dig spot was filled in (M4-40): snapshots without it are the ones of before. */
const gatheringSnapshotSchema = z.object({ regrowing: z.array(regrowthSchema), falling: z.array(fallSchema), spentDigSpots: z.array(spentSpotSchema).optional() }).strict();

/** What a neighbour of a filled water ditch is to the ditches beside it (`drainDitches`). */
const DITCH_DRY = 0;
/** A water ditch: a dug tile holding water. */
const DITCH_WET = 1;
/** Open natural water that feeds the ditches beside it. */
const DITCH_SOURCE = 2;
/** Outside the active zone: the ditch may run on there and be fed (nothing is read or written in frozen chunks). */
const DITCH_UNKNOWN = 3;

export class GatheringSystem implements SimSystem {
  readonly id = GATHERING_SYSTEM_ID;
  readonly save: SaveParticipant;
  readonly rules: GatheringRules;
  private readonly collision: WorldCollision;
  private readonly calendar: Calendar;
  private readonly drops: DropSystem;
  private readonly catalog: ItemCatalog;
  private readonly activeChunks: () => readonly ChunkData[];
  private readonly playerAt: GatheringDeps['playerAt'];
  private readonly generatedSource: GeneratedChunks | null;
  /** Removed objects that come back, by packed chunk id and tile index. */
  private readonly regrowing = new Map<number, Map<number, Regrowth>>();
  /** Hidden dig spots filled back in after their find came up, by packed chunk id and tile index (M4-40): they stay spent. */
  private readonly spentSpots = new Map<number, Set<number>>();
  /** Trees falling right now. */
  private falling: TreeFall[] = [];
  private readonly bases: BaseAreas[] = [];
  private readonly groundClaims: GroundClaim[] = [];
  private readonly landedListeners: TreeLandedListener[] = [];
  private skillBonus: SkillBonusSource = () => 0;
  private objectPowerFactor: ObjectPowerFactor = () => 1;
  private experience: ExperienceSink | null = null;
  private readonly fallTicks: number;
  private readonly player = { x: 0, y: 0, layer: 0 as Layer };
  private readonly coord: ChunkCoord = { layer: 0, cx: 0, cy: 0 };
  private readonly scratchHit = createObjectHit();
  private readonly seatHit = createObjectHit();
  private readonly fireHit = createObjectHit();

  constructor(sim: Simulation, deps: GatheringDeps) {
    this.collision = deps.collision;
    this.calendar = deps.calendar;
    this.drops = deps.drops;
    this.catalog = deps.catalog;
    this.activeChunks = deps.activeChunks;
    this.playerAt = deps.playerAt;
    this.generatedSource = deps.generated ?? null;
    this.rules = deps.rules ?? contentGatheringRules();
    this.fallTicks = secondsToTicks(HARVEST.tree.fallSeconds, sim.clock.tickHz);
    this.save = {
      id: GATHERING_SYSTEM_ID,
      version: GATHERING_SAVE_VERSION,
      serialize: () => {
        const regrowing: z.input<typeof regrowthSchema>[] = [];
        for (const id of [...this.regrowing.keys()].sort((a, b) => a - b)) {
          unpackChunkId(id, this.coord);
          const tiles = this.regrowing.get(id) as Map<number, Regrowth>;
          for (const i of [...tiles.keys()].sort((a, b) => a - b)) {
            const r = tiles.get(i) as Regrowth;
            regrowing.push({ layer: this.coord.layer, cx: this.coord.cx, cy: this.coord.cy, i, object: r.object, at: r.at });
          }
        }
        const spent: z.input<typeof spentSpotSchema>[] = [];
        for (const id of [...this.spentSpots.keys()].sort((a, b) => a - b)) {
          unpackChunkId(id, this.coord);
          for (const i of [...(this.spentSpots.get(id) as Set<number>)].sort((a, b) => a - b)) spent.push({ layer: this.coord.layer, cx: this.coord.cx, cy: this.coord.cy, i });
        }
        const falling = this.falling.map((f) => ({ ...f, drops: f.drops.map((d) => ({ ...d })) }));
        return spent.length === 0 ? { regrowing, falling } : { regrowing, falling, spentDigSpots: spent };
      },
      deserialize: (data) => {
        const parsed = gatheringSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`gathering snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        const regrowing = new Map<number, Map<number, Regrowth>>();
        for (const r of parsed.data.regrowing) {
          if (!isLayer(r.layer)) throw new TypeError(`gathering snapshot invalid: unknown layer ${r.layer}`);
          if (this.rules.object(r.object) === undefined) throw new TypeError(`gathering snapshot invalid: unknown world object "${r.object}"`);
          if (r.i >= CHUNK_AREA) throw new TypeError(`gathering snapshot invalid: tile index ${r.i}`);
          const id = packChunkId(r.layer, r.cx, r.cy);
          let tiles = regrowing.get(id);
          if (tiles === undefined) regrowing.set(id, (tiles = new Map()));
          tiles.set(r.i, { object: r.object, at: r.at });
        }
        const falling: TreeFall[] = [];
        for (const f of parsed.data.falling) {
          if (!isLayer(f.layer)) throw new TypeError(`gathering snapshot invalid: unknown layer ${f.layer}`);
          if (this.rules.object(f.object) === undefined) throw new TypeError(`gathering snapshot invalid: unknown world object "${f.object}"`);
          for (const d of f.drops) if (!this.catalog.has(d.item)) throw new TypeError(`gathering snapshot invalid: unknown item "${d.item}"`);
          falling.push({ ...f, layer: f.layer as Layer, drops: f.drops.map((d) => ({ ...d })) });
        }
        const spent = new Map<number, Set<number>>();
        for (const p of parsed.data.spentDigSpots ?? []) {
          if (!isLayer(p.layer)) throw new TypeError(`gathering snapshot invalid: unknown layer ${p.layer}`);
          if (p.i >= CHUNK_AREA) throw new TypeError(`gathering snapshot invalid: tile index ${p.i}`);
          const tx = (p.cx << CHUNK_SHIFT) + (p.i & CHUNK_MASK);
          const ty = (p.cy << CHUNK_SHIFT) + (p.i >> CHUNK_SHIFT);
          if (!isDigSpot(sim.config.seed, p.layer, tx, ty)) throw new TypeError(`gathering snapshot invalid: no dig spot at ${tx}, ${ty} on layer ${p.layer}`);
          const id = packChunkId(p.layer, p.cx, p.cy);
          let tiles = spent.get(id);
          if (tiles === undefined) spent.set(id, (tiles = new Set()));
          tiles.add(p.i);
        }
        this.regrowing.clear();
        for (const [k, v] of regrowing) this.regrowing.set(k, v);
        this.falling = falling;
        this.spentSpots.clear();
        for (const [k, v] of spent) this.spentSpots.set(k, v);
      },
    };
  }

  // -------------------------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------------------------

  /** Adds a source of base areas: nothing whose rules say so regrows inside them (M4). */
  addBaseAreas(source: BaseAreas): void {
    this.bases.push(source);
  }

  /** Adds a source of built ground: no digging, tilling, flooding or filling in where it claims a tile (M4). */
  addGroundClaims(claim: GroundClaim): void {
    this.groundClaims.push(claim);
  }

  /** Whether something built claims the ground of the tile. */
  private claimed(layer: Layer, tx: number, ty: number): boolean {
    for (let k = 0; k < this.groundClaims.length; k++) if ((this.groundClaims[k] as GroundClaim)(layer, tx, ty)) return true;
    return false;
  }

  /** Adds a listener for landing trees (creatures under the trunk take `damage`, M5). */
  onTreeLanded(listener: TreeLandedListener): void {
    this.landedListeners.push(listener);
  }

  /** Sets where the skill bonus of a harvest comes from (M3-32). */
  setSkillBonus(source: SkillBonusSource): void {
    this.skillBonus = source;
  }

  /** Sets the share of mining power the hand strikes world objects with (the combat system: battle axes, M6-06). */
  setObjectPowerFactor(source: ObjectPowerFactor): void {
    this.objectPowerFactor = source;
  }

  /** Sets where the experience of hits and finished harvests goes (M3-32). */
  setExperience(sink: ExperienceSink): void {
    this.experience = sink;
  }

  /** Gives the experience of source `xp` (none for `null`). */
  private gain(sim: Simulation, xp: string | null): void {
    if (xp !== null && this.experience !== null) this.experience(sim, xp);
  }

  /** Trees falling right now (presentation: the fall animation). */
  get fallingTrees(): readonly TreeFall[] {
    return this.falling;
  }

  /** Removed objects waiting to come back (tests, debug). */
  get regrowingCount(): number {
    let n = 0;
    for (const tiles of this.regrowing.values()) n += tiles.size;
    return n;
  }

  /** When the removed object of tile (tx, ty) comes back (tick), or `NO_REGROW_TICK`. */
  regrowAt(layer: Layer, tx: number, ty: number): number {
    return this.regrowing.get(packChunkId(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT))?.get(((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK))?.at ?? NO_REGROW_TICK;
  }

  // -------------------------------------------------------------------------------------------
  // Finding and planning
  // -------------------------------------------------------------------------------------------

  /** The resident chunk of a tile. */
  chunkOf(layer: Layer, tx: number, ty: number): ChunkData | undefined {
    return this.collision.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
  }

  /**
   * Finds the world object whose footprint covers tile (tx, ty) (anchored there, or west/south of it,
   * WORLD.md: footprints extend east and north). Returns false when there is none.
   */
  objectAt(layer: Layer, tx: number, ty: number, out: ObjectHit): boolean {
    const rules = this.rules;
    for (let dy = 0; dy < rules.maxFootprintH; dy++) {
      for (let dx = 0; dx < rules.maxFootprintW; dx++) {
        const ax = tx - dx;
        const ay = ty + dy;
        const chunk = this.chunkOf(layer, ax, ay);
        if (chunk === undefined) continue;
        const i = ((ay & CHUNK_MASK) << CHUNK_SHIFT) | (ax & CHUNK_MASK);
        const r = chunk.object[i] as number;
        if (r === 0) continue;
        const rule = rules.objects[r] ?? null;
        if (rule === null || dx >= rule.footprintW || dy >= rule.footprintH) continue;
        out.chunk = chunk;
        out.i = i;
        out.layer = layer;
        out.tx = ax;
        out.ty = ay;
        out.rule = rule;
        return true;
      }
    }
    return false;
  }

  /**
   * Whether a tree stump covers tile (tx, ty) of `layer` – a seat (§11.4 "Sitzen (Stühle, Baumstümpfe)");
   * its anchor tile's centre [world px] goes into `out`.
   */
  stumpAt(layer: Layer, tx: number, ty: number, out: { x: number; y: number }): boolean {
    const hit = this.seatHit;
    if (!this.objectAt(layer, tx, ty, hit) || hit.chunk === null || hit.rule === null || hit.rule.stump === null) return false;
    if (!isStump(hit.chunk.objectState.get(hit.i))) return false;
    out.x = hit.tx * TILE_PX + TILE_PX / 2;
    out.y = hit.ty * TILE_PX + TILE_PX / 2;
    return true;
  }

  /**
   * The standing tree anchored on tile (tx, ty) of `layer` – something a fire burns (M4-28) – into `out`; false when
   * none stands there (no tree, a stump, or its chunk is not resident).
   */
  standingTreeAt(layer: Layer, tx: number, ty: number, out: ObjectHit): boolean {
    const chunk = this.chunkOf(layer, tx, ty);
    if (chunk === undefined) return false;
    const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
    const rule = this.rules.objects[chunk.object[i] as number] ?? null;
    if (rule === null || rule.stump === null || rule.standing?.result !== 'stump' || isStump(chunk.objectState.get(i))) return false;
    out.chunk = chunk;
    out.i = i;
    out.layer = layer;
    out.tx = tx;
    out.ty = ty;
    out.rule = rule;
    return true;
  }

  /**
   * The standing tree anchored on tile (tx, ty) burned down at tick `at` (the fire system, §16.2 "Ausbreitung auf …
   * Bäume", M4-28): its stump stays and grows back like a felled tree's – counted from `at`, not inside a base – and no
   * wood falls (it burned). False when no standing tree is anchored there.
   */
  burnTree(layer: Layer, tx: number, ty: number, at: number): boolean {
    const hit = this.fireHit;
    if (!this.standingTreeAt(layer, tx, ty, hit)) return false;
    const rule = hit.rule as ObjectRule;
    const fell = rule.standing as ObjectHarvest;
    const regrows = fell.regrowDays !== null && !(fell.baseBlocksRegrow && this.inBase(layer, tx, ty));
    const back = regrows ? regrowTick(at, fell.regrowDays as number, this.calendar.clock.ticksPerDay, this.calendar.clock.minuteOfDay) : NO_REGROW_TICK;
    (hit.chunk as ChunkData).setObjectState(hit.i, rule.stump === null ? 1 : rule.stump.hp, STAGE_STUMP, back);
    this.invalidateFootprint(layer, tx, ty, rule);
    return true;
  }

  /** Centre of an object's footprint [world px] into `out`. */
  objectCentre(hit: ObjectHit, out: { x: number; y: number }): void {
    const w = hit.rule?.footprintW ?? 1;
    const h = hit.rule?.footprintH ?? 1;
    out.x = hit.tx * TILE_PX + (w * TILE_PX) / 2;
    out.y = (hit.ty + 1) * TILE_PX - (h * TILE_PX) / 2;
  }

  /** The current season (drops and ripeness). */
  get season(): SeasonId {
    return this.calendar.season;
  }

  /**
   * What the held tool (`null` = empty hand or no tool) does to the object of `hit` now, into `out`.
   * Returns `out.ok`.
   */
  planObject(sim: Simulation, hit: ObjectHit, tool: HeldTool | null, out: HarvestPlan): boolean {
    const rule = hit.rule;
    const chunk = hit.chunk;
    resetPlan(out);
    if (rule === null || chunk === null) return false;
    const state = chunk.objectState.get(hit.i);
    const season = this.season;
    let harvest: ObjectHarvest | null;
    if (isStump(state)) harvest = rule.stump;
    else if (rule.fruit !== null && tool?.kind !== rule.standing?.tool && !isHarvested(state) && isRipe(rule.drops, 'ernte', season)) harvest = rule.fruit;
    else harvest = rule.standing;
    if (harvest === null) return false;
    out.harvest = harvest;
    out.target = rule.id;
    out.action = harvest.action;
    out.tool = harvest.tool;
    out.material = harvest.material;
    out.skill = harvest.skill;
    out.xpHit = harvest.xpHit;
    out.xpDone = harvest.xpDone;
    out.hardness = harvest.hardness;
    out.byHand = harvest.tool === 'hand';
    out.hpMax = harvest.hp;
    // Hit points of the stage: a stump or a damaged (or picked) standing object keeps its own.
    out.hp = harvest === rule.fruit || state === undefined || isStump(state) !== (harvest === rule.stump) ? harvest.hp : state.hp;
    this.objectCentre(hit, out);
    out.ok = true;
    out.block = null;
    if (harvest.result === 'harvested' && isHarvested(state)) out.block = 'regrowing';
    else if (harvest.tool === 'hand' && rule.drops.some((d) => d.anlass === harvest.occasion) && !isRipe(rule.drops, harvest.occasion, season)) out.block = 'notRipe';
    else if (!out.byHand) this.checkTool(harvest.tool, harvest.hardness, tool, out);
    this.countHits(sim, tool, out, this.objectPowerFactor(sim));
    return out.ok;
  }

  /**
   * What the held tool does to tile (tx, ty): mining solid rock or a vein with the pickaxe, digging with
   * the shovel, tilling with the hoe. Returns `out.ok` (false: nothing to do there with this tool).
   */
  planTile(sim: Simulation, layer: Layer, tx: number, ty: number, tool: HeldTool | null, out: HarvestPlan): boolean {
    resetPlan(out);
    const chunk = this.chunkOf(layer, tx, ty);
    if (chunk === undefined || tool === null) return false;
    const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
    out.x = tx * TILE_PX + HALF_TILE;
    out.y = ty * TILE_PX + HALF_TILE;
    const solid = chunk.solid[i] as number;
    if (solid !== 0) {
      const rule = this.rules.tiles[solid] ?? null;
      if (rule === null || tool.kind !== rule.tool) return false;
      this.fillTile(rule, 'stollen', out);
      this.checkTool(rule.tool, rule.hardness, tool, out);
      this.countHits(sim, tool, out);
      return true;
    }
    if (tool.kind === 'schaufel') return this.planDig(sim, layer, chunk, i, tx, ty, tool, out);
    if (tool.kind === 'hacke') return this.planTill(sim, layer, chunk, i, tx, ty, tool, out);
    return false;
  }

  /**
   * The shovel on open ground: undug ground becomes a path or a pit (the first stroke); dug ground beside water opens
   * into a water ditch; dug soil beside other dug ground deepens into a dry trench (M4-36: a trench runs as a line, a
   * lone hole stays a pit); anything else is dug already. A blocked dug tile names what it could become (trench for
   * soil, else water ditch).
   */
  private planDig(sim: Simulation, layer: Layer, chunk: ChunkData, i: number, tx: number, ty: number, tool: HeldTool, out: HarvestPlan): boolean {
    const rule = this.rules.tiles[chunk.ground[i] as number] ?? null;
    if (rule === null || rule.tool !== 'schaufel') return false;
    const dug = ((chunk.flags[i] as number) & TILE_FLAG_DUG) !== 0;
    const ditch = dug && layer === 0 && this.waterBeside(layer, tx, ty);
    const trench = dug && !ditch && rule.trench !== 0 && this.dugBeside(layer, tx, ty);
    const result: DigResult = !dug ? (rule.becomes === rule.runtimeId ? 'grube' : 'pfad') : ditch ? 'wassergraben' : rule.trench !== 0 ? 'graben' : 'wassergraben';
    this.fillTile(rule, result, out);
    if (this.claimed(layer, tx, ty)) out.block = 'builtOver';
    else if (!this.openGround(layer, chunk, i, tx, ty)) out.block = 'notDiggable';
    else if (dug && !ditch && !trench) out.block = 'alreadyDug';
    else this.checkTool(rule.tool, rule.hardness, tool, out);
    this.countHits(sim, tool, out);
    return true;
  }

  private planTill(sim: Simulation, layer: Layer, chunk: ChunkData, i: number, tx: number, ty: number, tool: HeldTool, out: HarvestPlan): boolean {
    const ids = this.rules.ids.terrain;
    const ground = ids.stringId(chunk.ground[i] as number);
    if (layer !== 0 || !(TILLABLE_GROUND as readonly string[]).includes(ground)) return false;
    const rule = this.rules.tiles[chunk.ground[i] as number] ?? null;
    if (rule === null) return false;
    this.fillTile(rule, 'feld', out);
    out.action = 'hacken';
    out.tool = 'hacke';
    out.hardness = rule.hardness;
    if (this.claimed(layer, tx, ty)) out.block = 'builtOver';
    else if (!this.openGround(layer, chunk, i, tx, ty)) out.block = 'notDiggable';
    else if (ground === FIELD_GROUND && ((chunk.flags[i] as number) & TILE_FLAG_DUG) !== 0) out.block = 'alreadyDug';
    else this.checkTool('hacke', rule.hardness, tool, out);
    this.countHits(sim, tool, out);
    return true;
  }

  private fillTile(rule: TileRule, dig: DigResult, out: HarvestPlan): void {
    out.ok = true;
    out.block = null;
    out.tile = rule;
    out.dig = dig;
    out.target = rule.terrain;
    out.action = rule.action;
    out.tool = rule.tool;
    out.material = rule.material;
    out.skill = rule.skill;
    out.xpHit = rule.xpHit;
    out.xpDone = rule.xpDone;
    out.hardness = rule.hardness;
    out.byHand = false;
    out.hpMax = rule.hp;
    out.hp = rule.hp;
  }

  /** Tool checks of a plan: the kind must match; a broken tool blocks; a weak tool strikes sparks. */
  private checkTool(needed: HarvestTool, hardness: number, tool: HeldTool | null, out: HarvestPlan): void {
    if (tool === null || tool.kind !== needed) {
      out.block = 'needsTool';
      out.needs = needed;
    } else if (tool.broken) out.block = 'toolBroken';
    else out.tooWeak = !powerSuffices(tool.power, hardness);
  }

  /** Hits the plan needs; `factor` scales the tool's power (world objects: `objectPowerFactor`, tiles 1). */
  private countHits(sim: Simulation, tool: HeldTool | null, out: HarvestPlan, factor = 1): void {
    if (out.byHand) {
      out.hitsTotal = 1;
      out.hitsLeft = 1;
      return;
    }
    if (tool === null || tool.kind !== out.tool || !(tool.power > 0) || out.tooWeak) {
      out.hitsTotal = 0;
      out.hitsLeft = 0;
      return;
    }
    const bonus = this.skillBonus(sim, out.skill);
    out.hitsTotal = hitsNeeded(out.hpMax, hitPowerOf(tool) * factor, bonus);
    out.hitsLeft = hitsNeeded(out.hp, hitPowerOf(tool) * factor, bonus);
  }

  /** Whether nothing stands on the tile, it is dry and no building, road or edge claims it. */
  private openGround(layer: Layer, chunk: ChunkData, i: number, tx: number, ty: number): boolean {
    if (((chunk.flags[i] as number) & UNDIGGABLE_FLAGS) !== 0) return false;
    const water = chunk.water[i] as number;
    if ((water & WATER_DEPTH_MASK) !== 0 || (water & WATER_FROZEN) !== 0) return false;
    return (this.collision.grid.tileInfo(layer, tx, ty) & BLOCK_OBJECT) === 0 && !this.claimed(layer, tx, ty);
  }

  /** Whether an unfrozen water tile lies beside (tx, ty) (4-neighbourhood). */
  private waterBeside(layer: Layer, tx: number, ty: number): boolean {
    for (const [dx, dy] of NEIGHBOURS) {
      const c = this.chunkOf(layer, tx + dx, ty + dy);
      if (c === undefined) continue;
      const w = c.water[(((ty + dy) & CHUNK_MASK) << CHUNK_SHIFT) | ((tx + dx) & CHUNK_MASK)] as number;
      if ((w & WATER_DEPTH_MASK) !== 0 && (w & WATER_FROZEN) === 0) return true;
    }
    return false;
  }

  /** Whether a dug tile (path, pit, trench, ditch, field) lies beside (tx, ty) (4-neighbourhood): a trench continues it. */
  private dugBeside(layer: Layer, tx: number, ty: number): boolean {
    for (const [dx, dy] of NEIGHBOURS) {
      const c = this.chunkOf(layer, tx + dx, ty + dy);
      if (c !== undefined && ((c.flags[(((ty + dy) & CHUNK_MASK) << CHUNK_SHIFT) | ((tx + dx) & CHUNK_MASK)] as number) & TILE_FLAG_DUG) !== 0) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Hits
  // -------------------------------------------------------------------------------------------

  /**
   * One hit (tool) or a finished pick (hand) on the object of `hit` as planned in `plan` (planned in this
   * tick). (px, py) is where the player stands (the tree falls away from it).
   */
  hitObject(sim: Simulation, hit: ObjectHit, plan: HarvestPlan, tool: HeldTool | null, px: number, py: number): HitOutcome {
    const rule = hit.rule;
    const chunk = hit.chunk;
    const harvest = plan.harvest;
    if (!plan.ok || plan.block !== null || rule === null || chunk === null || harvest === null) return 'invalid';
    const tick = sim.eventTick;
    const base = { layer: hit.layer, tx: hit.tx, ty: hit.ty, x: plan.x, y: plan.y, target: rule.id, action: harvest.action, material: harvest.material, tick };
    if (plan.tooWeak || (!plan.byHand && tool === null)) {
      sim.events.push('harvestHit', { ...base, hits: 0, hitsNeeded: plan.hitsTotal, tooHard: true, xp: null });
      return 'tooHard';
    }
    const state = chunk.objectState.get(hit.i);
    const power = tool === null ? 0 : hitPowerOf(tool) * this.objectPowerFactor(sim);
    const bonus = this.skillBonus(sim, harvest.skill);
    const hp = plan.byHand ? 0 : plan.hp - hitDamage(power, bonus);
    const hits = plan.byHand ? 1 : plan.hitsTotal - (hp > 0 ? hitsNeeded(hp, power, bonus) : 0);
    sim.events.push('harvestHit', { ...base, hits, hitsNeeded: plan.hitsTotal, tooHard: false, xp: plan.xpHit });
    this.gain(sim, plan.xpHit);
    if (hp > 0) {
      const growth = state === undefined ? GROWTH_GROWN : state.growth;
      chunk.setObjectState(hit.i, hp, growth, state?.regrowAtTick ?? NO_REGROW_TICK);
      return 'hit';
    }
    this.complete(sim, hit, rule, harvest, state?.hp ?? rule.def.hp, px, py);
    sim.events.push('harvested', { ...base, skill: harvest.skill, xp: plan.xpDone });
    this.gain(sim, plan.xpDone);
    return 'done';
  }

  /** The object of `hit` is harvested: stump, bare or gone; drops; regrowth. */
  private complete(sim: Simulation, hit: ObjectHit, rule: ObjectRule, harvest: ObjectHarvest, objectHp: number, px: number, py: number): void {
    const chunk = hit.chunk as ChunkData;
    const tick = sim.eventTick;
    const clock = sim.clock;
    const drops = rollDrops(rule.drops, harvest.occasion, this.season, this.random(sim));
    const centre = { x: 0, y: 0 };
    this.objectCentre(hit, centre);
    const regrows = harvest.regrowDays !== null && !(harvest.baseBlocksRegrow && this.inBase(hit.layer, hit.tx, hit.ty));
    const window = MUSHROOMS.has(rule.id) && hit.layer === 0 ? MUSHROOM_WINDOW : null;
    const at = regrows ? regrowTick(tick, harvest.regrowDays as number, clock.ticksPerDay, clock.minuteOfDay, window) : NO_REGROW_TICK;
    switch (harvest.result) {
      case 'stump': {
        const stump = rule.stump;
        chunk.setObjectState(hit.i, stump === null ? 1 : stump.hp, STAGE_STUMP, at);
        const direction = fallDirection(centre.x - px, centre.y - py);
        const fall: TreeFall = { layer: hit.layer, tx: hit.tx, ty: hit.ty, object: rule.id, direction, landsAtTick: tick + this.fallTicks, drops };
        this.falling.push(fall);
        sim.events.push('treeFelled', { layer: hit.layer, tx: hit.tx, ty: hit.ty, object: rule.id, direction, landsAtTick: fall.landsAtTick, tick });
        return;
      }
      case 'harvested':
        chunk.setObjectState(hit.i, objectHp, STAGE_HARVESTED, at);
        break;
      case 'removed':
        chunk.setObject(hit.i, 0);
        this.invalidateFootprint(hit.layer, hit.tx, hit.ty, rule);
        if (at !== NO_REGROW_TICK) this.remember(hit.layer, hit.tx, hit.ty, rule.id, at);
        break;
    }
    this.spawnAll(sim, drops, hit.layer, centre.x, centre.y, px, py);
  }

  /**
   * One tool hit on tile work planned in `plan` at (tx, ty); `damage` is what earlier hits of the held
   * action already did [HP]. Returns the outcome and writes the damage after this hit into `outDamage`.
   */
  hitTile(sim: Simulation, layer: Layer, tx: number, ty: number, plan: HarvestPlan, tool: HeldTool | null, damage: number, outDamage: { value: number }, px: number, py: number): HitOutcome {
    const rule = plan.tile;
    outDamage.value = damage;
    if (!plan.ok || plan.block !== null || rule === null || tool === null) return 'invalid';
    const tick = sim.eventTick;
    const base = { layer, tx, ty, x: plan.x, y: plan.y, target: rule.terrain, action: plan.action, material: plan.material, tick };
    if (plan.tooWeak) {
      sim.events.push('harvestHit', { ...base, hits: 0, hitsNeeded: plan.hitsTotal, tooHard: true, xp: null });
      return 'tooHard';
    }
    const bonus = this.skillBonus(sim, plan.skill);
    const dealt = damage + hitDamage(hitPowerOf(tool), bonus);
    const left = plan.hpMax - dealt;
    outDamage.value = dealt;
    sim.events.push('harvestHit', { ...base, hits: plan.hitsTotal - (left > 0 ? hitsNeeded(left, hitPowerOf(tool), bonus) : 0), hitsNeeded: plan.hitsTotal, tooHard: false, xp: plan.xpHit });
    this.gain(sim, plan.xpHit);
    if (left > 0) return 'hit';
    this.completeTile(sim, layer, tx, ty, plan, rule, px, py);
    sim.events.push('harvested', { ...base, skill: plan.skill, xp: plan.xpDone });
    this.gain(sim, plan.xpDone);
    return 'done';
  }

  private completeTile(sim: Simulation, layer: Layer, tx: number, ty: number, plan: HarvestPlan, rule: TileRule, px: number, py: number): void {
    const chunk = this.chunkOf(layer, tx, ty) as ChunkData;
    const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
    const tick = sim.eventTick;
    const terrain = this.rules.ids.terrain;
    const random = this.random(sim);
    const drops: RolledDrop[] = [];
    const from = plan.dig === 'stollen' ? rule.terrain : terrain.stringId(chunk.ground[i] as number);
    const firstDig = ((chunk.flags[i] as number) & TILE_FLAG_DUG) === 0;
    // Scatter and small plants on dug ground go with the soil (nothing blocking stands there, `openGround`).
    if (plan.dig !== 'stollen' && (chunk.object[i] as number) !== 0) chunk.setObject(i, 0);
    switch (plan.dig) {
      case 'stollen': {
        const biomeId = chunk.biome[i] as number;
        const biome = biomeId === 0 ? null : this.rules.ids.biomes.stringId(biomeId);
        drops.push(...rollDrops(this.rules.solidDrops(rule, biome), 'abbau', this.season, random));
        chunk.solid[i] = 0;
        break;
      }
      case 'feld':
        chunk.ground[i] = terrain.runtimeId(FIELD_GROUND);
        break;
      case 'wassergraben':
        // A water ditch is a trench the water runs into: soil deepens into its trench under the water.
        if (rule.trench !== 0) chunk.ground[i] = rule.trench;
        chunk.water[i] = WATER_DEPTH_SHALLOW;
        this.digYield(rule, random, drops, this.gravelBank(layer, tx, ty));
        break;
      case 'graben':
        chunk.ground[i] = rule.trench;
        this.digYield(rule, random, drops, this.gravelBank(layer, tx, ty));
        break;
      default:
        chunk.ground[i] = rule.becomes;
        this.digYield(rule, random, drops, this.gravelBank(layer, tx, ty));
    }
    chunk.flags[i] = (chunk.flags[i] as number) | TILE_FLAG_DUG;
    this.collision.invalidateTile(layer, tx, ty);
    if (plan.dig === 'wassergraben') this.floodTrenches(layer, tx, ty);
    const to = terrain.stringId(chunk.ground[i] as number);
    sim.events.push('tileDug', { layer, tx, ty, from, to, result: plan.dig ?? 'grube', tick });
    if (plan.dig !== 'stollen' && plan.dig !== 'feld' && firstDig && isDigSpot(sim.config.seed, layer, tx, ty) && !this.spotSpent(layer, tx, ty)) {
      for (let k = 0; k < HARVEST.dig.spotRolls; k++) drops.push(rollDigSpot(random));
      sim.events.push('digSpotFound', { layer, tx, ty, tick });
    }
    this.spawnAll(sim, drops, layer, plan.x, plan.y, px, py);
  }

  /**
   * Water of a new ditch at (tx, ty) runs on along the dry trenches connected to it (M4-36, §14 "Wassergräben"): every
   * dry, open trench tile reachable over trench tiles (4-neighbourhood) fills with shallow water, in a fixed order. It
   * stays inside the active zone (the rule for systems: nothing writes into frozen chunks); a stretch beyond stays dry
   * until its first tile is dug open again.
   */
  private floodTrenches(layer: Layer, tx: number, ty: number): void {
    const active = new Set<ChunkData>(this.activeChunks());
    const trench = this.rules.trenchGround;
    const seen = new Set<number>([packTile(tx, ty)]);
    const queue: number[] = [tx, ty];
    for (let head = 0; head < queue.length; head += 2) {
      const x = queue[head] as number;
      const y = queue[head + 1] as number;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        const key = packTile(nx, ny);
        if (seen.has(key)) continue;
        seen.add(key);
        const c = this.chunkOf(layer, nx, ny);
        if (c === undefined || !active.has(c)) continue;
        const i = ((ny & CHUNK_MASK) << CHUNK_SHIFT) | (nx & CHUNK_MASK);
        if (trench[c.ground[i] as number] !== 1 || ((c.flags[i] as number) & TILE_FLAG_DUG) === 0 || !this.openGround(layer, c, i, nx, ny)) continue;
        c.water[i] = WATER_DEPTH_SHALLOW;
        this.collision.invalidateTile(layer, nx, ny);
        queue.push(nx, ny);
      }
    }
  }

  /** What digging the tile of `rule` yields: its soil, or on a gravel bank gravel where the ground holds one (M4-36, M4-40). */
  private digYield(rule: TileRule, random: () => number, out: RolledDrop[], gravel: boolean): void {
    const d = HARVEST.dig;
    const item = gravel && rule.gravel ? d.gravelBankItem : rule.yieldItem;
    if (item === null) return;
    out.push({ item, count: d.yieldMin + Math.floor(random() * (d.yieldMax - d.yieldMin + 1)) });
  }

  /** Whether tile (tx, ty) is a gravel bank: on the surface, one of its four neighbours carries river water (§14, M4-36). */
  gravelBank(layer: Layer, tx: number, ty: number): boolean {
    if (layer !== 0) return false;
    for (const [dx, dy] of NEIGHBOURS) {
      const c = this.chunkOf(layer, tx + dx, ty + dy);
      if (c === undefined) continue;
      const w = c.water[(((ty + dy) & CHUNK_MASK) << CHUNK_SHIFT) | ((tx + dx) & CHUNK_MASK)] as number;
      if ((w & WATER_DEPTH_MASK) !== 0 && (w & WATER_RIVER) !== 0) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Filling in (M4-40)
  // -------------------------------------------------------------------------------------------

  /**
   * What dug tile (tx, ty) is when it can be filled back in (M4-40), else `null`: dug and still soil – a pit, a path, a
   * dry trench, a water ditch (a tilled field counts as the pit or path its ground makes) –, nothing standing on it and
   * the generated state of its chunk known. A tunnel, or a clay pocket or root floor dug out down to the bare cave
   * floor, has no soil left to fill. A path is ground the shovel turned into another (meadow into earth), a pit ground
   * that stayed itself. Read-only.
   */
  refillable(sim: Simulation, layer: Layer, tx: number, ty: number): FillKind | null {
    const chunk = this.chunkOf(layer, tx, ty);
    if (chunk === undefined) return null;
    const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
    const flags = chunk.flags[i] as number;
    if ((flags & TILE_FLAG_DUG) === 0 || (flags & UNDIGGABLE_FLAGS) !== 0 || (chunk.solid[i] as number) !== 0) return null;
    const ground = chunk.ground[i] as number;
    if (this.rules.tiles[ground]?.tool !== 'schaufel') return null;
    if ((this.collision.grid.tileInfo(layer, tx, ty) & BLOCK_OBJECT) !== 0 || this.claimed(layer, tx, ty)) return null;
    const generated = this.generatedOf(sim, chunk);
    if (generated === undefined) return null;
    if (((chunk.water[i] as number) & WATER_DEPTH_MASK) !== 0) return 'wassergraben';
    if (this.rules.trenchGround[ground] === 1) return 'graben';
    const before = this.rules.tiles[generated.ground[i] as number] ?? null;
    return before !== null && before.becomes !== before.runtimeId ? 'pfad' : 'grube';
  }

  /**
   * Fills dug tile (tx, ty) back in (M4-40): its ground, water and flags return to the generated state of its chunk
   * (the chunk diff shrinks back; scatter the shovel took along stays gone). A filled water ditch takes the water from
   * the ditches it fed that reach no open water any more (`drainDitches`); a hidden dig spot there stays spent – its
   * find came up with the first stroke (a field hoed over a spot and filled in loses the spot as well: the ground
   * does not tell a field from a pit). Returns what the tile was, or `null` when it cannot be filled (`refillable`).
   */
  refill(sim: Simulation, layer: Layer, tx: number, ty: number): FillKind | null {
    const kind = this.refillable(sim, layer, tx, ty);
    if (kind === null) return null;
    const chunk = this.chunkOf(layer, tx, ty) as ChunkData;
    const generated = this.generatedOf(sim, chunk) as ChunkData;
    const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
    chunk.ground[i] = generated.ground[i] as number;
    chunk.water[i] = generated.water[i] as number;
    chunk.flags[i] = (chunk.flags[i] as number) & ~TILE_FLAG_DUG;
    this.collision.invalidateTile(layer, tx, ty);
    if (isDigSpot(sim.config.seed, layer, tx, ty)) this.spendSpot(layer, tx, ty);
    if (kind === 'wassergraben') this.drainDitches(layer, tx, ty);
    return kind;
  }

  /** Whether the hidden dig spot of tile (tx, ty) was filled back in after its find came up (M4-40). */
  spotSpent(layer: Layer, tx: number, ty: number): boolean {
    return this.spentSpots.get(packChunkId(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT))?.has(((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)) ?? false;
  }

  private spendSpot(layer: Layer, tx: number, ty: number): void {
    const id = packChunkId(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    let tiles = this.spentSpots.get(id);
    if (tiles === undefined) this.spentSpots.set(id, (tiles = new Set()));
    tiles.add(((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK));
  }

  /** Chunk `chunk` as generated: the injected source, else the simulation's chunk store. */
  private generatedOf(sim: Simulation, chunk: ChunkData): ChunkData | undefined {
    return (this.generatedSource ?? sim.world.chunks).generatedOf(chunk);
  }

  /**
   * After the water ditch at (tx, ty) was filled in, the ditches beside it keep their water only while they still reach
   * open water (M4-40, the counterpart of `floodTrenches`): every connected stretch of water ditches (dug tiles holding
   * water, 4-neighbourhood) beside the filled tile that touches no open natural water drains – a trench stays a dry
   * trench, a pit a dry pit. Like the flooding it stays inside the active zone: a stretch that runs on into a frozen or
   * unloaded chunk may be fed from there and keeps its water.
   */
  private drainDitches(layer: Layer, tx: number, ty: number): void {
    const active = new Set<ChunkData>(this.activeChunks());
    const seen = new Set<number>([packTile(tx, ty)]);
    const stretch: number[] = [];
    for (const [sx, sy] of NEIGHBOURS) {
      const x0 = tx + sx;
      const y0 = ty + sy;
      if (seen.has(packTile(x0, y0)) || this.ditchAt(layer, x0, y0, active) !== DITCH_WET) continue;
      seen.add(packTile(x0, y0));
      stretch.length = 0;
      stretch.push(x0, y0);
      let fed = false;
      for (let head = 0; head < stretch.length; head += 2) {
        const x = stretch[head] as number;
        const y = stretch[head + 1] as number;
        for (const [dx, dy] of NEIGHBOURS) {
          const key = packTile(x + dx, y + dy);
          if (seen.has(key)) continue;
          const d = this.ditchAt(layer, x + dx, y + dy, active);
          if (d === DITCH_WET) {
            seen.add(key);
            stretch.push(x + dx, y + dy);
          } else if (d !== DITCH_DRY) fed = true;
        }
      }
      if (fed) continue;
      for (let k = 0; k < stretch.length; k += 2) {
        const x = stretch[k] as number;
        const y = stretch[k + 1] as number;
        const c = this.chunkOf(layer, x, y) as ChunkData;
        const i = ((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK);
        c.water[i] = (c.water[i] as number) & ~WATER_DEPTH_MASK;
        this.collision.invalidateTile(layer, x, y);
      }
    }
  }

  /** What tile (tx, ty) is to a water ditch beside it (`DITCH_*`); tiles of chunks outside the active zone are not read. */
  private ditchAt(layer: Layer, tx: number, ty: number, active: ReadonlySet<ChunkData>): number {
    const c = this.chunkOf(layer, tx, ty);
    if (c === undefined || !active.has(c)) return DITCH_UNKNOWN;
    const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
    const water = c.water[i] as number;
    if ((water & WATER_DEPTH_MASK) === 0) return DITCH_DRY;
    if (((c.flags[i] as number) & TILE_FLAG_DUG) !== 0) return DITCH_WET;
    return (water & WATER_FROZEN) === 0 ? DITCH_SOURCE : DITCH_DRY;
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  /** Trees that land in this tick drop their logs; the creature hook sees the trunk. */
  update(sim: Simulation): void {
    if (this.falling.length === 0) return;
    const tick = sim.eventTick;
    const pending: TreeFall[] = [];
    for (const f of this.falling) {
      if (f.landsAtTick > tick) {
        pending.push(f);
        continue;
      }
      this.land(sim, f);
    }
    this.falling = pending;
  }

  private land(sim: Simulation, f: TreeFall): void {
    const rule = this.rules.object(f.object);
    const w = rule?.footprintW ?? 1;
    const v = FALL_VECTORS[f.direction];
    const baseX = f.tx * TILE_PX + (w * TILE_PX) / 2;
    const baseY = f.ty * TILE_PX + HALF_TILE;
    const length = HARVEST.tree.fallLengthTiles * TILE_PX;
    const trunk = { x0: baseX, y0: baseY, x1: baseX + v.x * length, y1: baseY + v.y * length };
    sim.events.push('treeLanded', { layer: f.layer, tx: f.tx, ty: f.ty, object: f.object, direction: f.direction, tick: sim.eventTick });
    for (const l of this.landedListeners) l(sim, f, trunk, HARVEST.tree.creatureDamage);
    const mx = baseX + v.x * length * TRUNK_DROP_SHARE;
    const my = baseY + v.y * length * TRUNK_DROP_SHARE;
    this.spawnAll(sim, f.drops, f.layer, mx, my, baseX, baseY);
  }

  /** Active chunks: whatever is due comes back (a blocking object waits while the player stands in it). */
  worldTick(sim: Simulation): void {
    const hasPlayer = this.playerAt(this.player);
    const chunks = this.activeChunks();
    for (let k = 0; k < chunks.length; k++) this.regrow(chunks[k] as ChunkData, sim.tick, hasPlayer ? this.player : null, sim);
  }

  /** A frozen chunk catches up: everything due by `toTick` is back (analytic, order independent). */
  catchUp(chunk: ChunkData, _fromTick: number, toTick: number): void {
    this.regrow(chunk, toTick, null, null);
  }

  private regrow(chunk: ChunkData, now: number, player: { x: number; y: number; layer: Layer } | null, sim: Simulation | null): void {
    const x0 = chunk.cx << CHUNK_SHIFT;
    const y0 = chunk.cy << CHUNK_SHIFT;
    if (chunk.objectState.size > 0) {
      for (const [i, s] of chunk.objectState) {
        if (s.regrowAtTick === NO_REGROW_TICK || s.regrowAtTick > now || s.growth >= 0) continue;
        const r = chunk.object[i] as number;
        const rule = this.rules.objects[r] ?? null;
        const tx = x0 + (i & CHUNK_MASK);
        const ty = y0 + (i >> CHUNK_SHIFT);
        if (rule !== null && s.growth === STAGE_STUMP && rule.standing?.baseBlocksRegrow === true && this.inBase(chunk.layer, tx, ty)) {
          s.regrowAtTick = NO_REGROW_TICK;
          continue;
        }
        chunk.clearObjectState(i);
        if (sim !== null && rule !== null) sim.events.push('objectRegrown', { layer: chunk.layer, tx, ty, object: rule.id, tick: sim.eventTick });
      }
    }
    const tiles = this.regrowing.get(chunk.id);
    if (tiles === undefined) return;
    for (const [i, g] of [...tiles]) {
      if (g.at > now) continue;
      const rule = this.rules.object(g.object);
      const tx = x0 + (i & CHUNK_MASK);
      const ty = y0 + (i >> CHUNK_SHIFT);
      if (rule === undefined || (rule.standing?.baseBlocksRegrow === true && this.inBase(chunk.layer, tx, ty)) || !this.freeFor(chunk, i, tx, ty, rule)) {
        tiles.delete(i);
        continue;
      }
      if (player !== null && rule.blocking && player.layer === chunk.layer && this.covers(rule, tx, ty, player.x, player.y)) continue;
      chunk.setObject(i, rule.runtimeId);
      this.invalidateFootprint(chunk.layer, tx, ty, rule);
      tiles.delete(i);
      if (sim !== null) sim.events.push('objectRegrown', { layer: chunk.layer, tx, ty, object: rule.id, tick: sim.eventTick });
    }
    if (tiles.size === 0) this.regrowing.delete(chunk.id);
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  private random(sim: Simulation): () => number {
    const rng: Rng = sim.rng.stream(GATHERING_RNG_STREAM);
    return () => rng.next();
  }

  private inBase(layer: Layer, tx: number, ty: number): boolean {
    for (const b of this.bases) if (b.inBase(layer, tx, ty)) return true;
    return false;
  }

  private remember(layer: Layer, tx: number, ty: number, object: string, at: number): void {
    const id = packChunkId(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    let tiles = this.regrowing.get(id);
    if (tiles === undefined) this.regrowing.set(id, (tiles = new Map()));
    tiles.set(((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK), { object, at });
  }

  /** Whether the removed object can stand on its tile again: the tile is empty and no other footprint covers it. */
  private freeFor(chunk: ChunkData, i: number, tx: number, ty: number, rule: ObjectRule): boolean {
    if ((chunk.object[i] as number) !== 0 || (chunk.solid[i] as number) !== 0) return false;
    for (let dy = 0; dy < rule.footprintH; dy++) {
      for (let dx = 0; dx < rule.footprintW; dx++) {
        if (this.objectAt(chunk.layer, tx + dx, ty - dy, this.scratchHit)) return false;
      }
    }
    return true;
  }

  /** Whether the footprint of `rule` anchored at (tx, ty) covers world px (x, y). */
  private covers(rule: ObjectRule, tx: number, ty: number, x: number, y: number): boolean {
    const left = tx * TILE_PX;
    const right = (tx + rule.footprintW) * TILE_PX;
    const bottom = (ty + 1) * TILE_PX;
    const top = bottom - rule.footprintH * TILE_PX;
    const r = BALANCE.player.movement.colliderRadiusPx;
    return x + r > left && x - r < right && y + r > top && y - r < bottom;
  }

  private invalidateFootprint(layer: Layer, tx: number, ty: number, rule: ObjectRule): void {
    for (let dy = 0; dy < rule.footprintH; dy++) for (let dx = 0; dx < rule.footprintW; dx++) this.collision.invalidateTile(layer, tx + dx, ty - dy);
  }

  private spawnAll(sim: Simulation, drops: readonly RolledDrop[], layer: Layer, x: number, y: number, fallbackX: number, fallbackY: number): void {
    for (const d of drops) {
      const def = this.catalog.find(d.item);
      if (def === undefined) continue;
      this.drops.spawn(sim, newStack(def, d.count), layer, x, y, fallbackX, fallbackY);
    }
  }
}

function resetPlan(p: HarvestPlan): void {
  p.ok = false;
  p.block = 'nothing';
  p.needs = null;
  p.tooWeak = false;
  p.harvest = null;
  p.tile = null;
  p.dig = null;
  p.hitsTotal = 0;
  p.hitsLeft = 0;
  p.hp = 0;
  p.hpMax = 0;
}

/** One roll on the dig spot table (weights of src/content/digSpots.ts). */
function rollDigSpot(random: () => number): RolledDrop {
  let total = 0;
  for (const e of DIG_SPOT_LOOT) total += e.weight;
  let pick = random() * total;
  let entry = DIG_SPOT_LOOT[DIG_SPOT_LOOT.length - 1] as (typeof DIG_SPOT_LOOT)[number];
  for (const e of DIG_SPOT_LOOT) {
    pick -= e.weight;
    if (pick < 0) {
      entry = e;
      break;
    }
  }
  return { item: entry.item, count: entry.min + Math.floor(random() * (entry.max - entry.min + 1)) };
}
