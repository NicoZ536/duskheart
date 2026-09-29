/**
 * Building system (MASTERPROMPT §16.1 "Raster & Ebenen", §16.2, §16.3 "Statik", §16.6 "Bau-UX"; M4-11, M4-12,
 * M4-14; the commands of src/game/building/commands.ts).
 *
 * - **Grid and layers:** parts stand in the structure layers of the world (src/world/structures): floor,
 *   structure (walls, fences, doors, gates, windows, pillars, ladders, stairs), objects 1×1 up to 4×4 (furniture,
 *   stations), wall objects (hung on the wall north of their tile) and roof. One part per tile and layer; the
 *   anchor of a part is the north-west tile of its rotated footprint.
 * - **Placing** (`build.place`, `build.blueprint`): within 8 tiles of the player (§16.1), on the player's layer, on
 *   free and buildable tiles – no rock, cliff face (but ladders and stairs), lava, world object, ramp or cave
 *   entrance; dry land or, for anything but roofs, a jetty (§16.1 "Wasserbauten … auf Pfählen": the jetty itself
 *   stands in water); a footprint on one height level; not where the player stands when it blocks; wall furniture
 *   needs a wall, rock or cliff face north of its tile; a roof tile a support in reach (§16.3). The part item comes
 *   from the bags (blueprints cost nothing).
 * - **Removing** (`build.remove`): the item back whole within 30 s of placing, afterwards 60 % of its materials
 *   (§16.6, `MaterialBook`); what does not fit into the bags lands at the player's feet. Wall furniture falls off a
 *   removed wall (whole). A jetty that carries something stays.
 * - **Statics** (§16.3): after a support or roof tile left (or a roof was upgraded to a shorter reach) every roof
 *   tile within the longest reach that is no longer carried comes down – dust (`roofCollapsed`) and 50 % of its
 *   materials on the ground.
 * - **Upgrading** in place, **finishing blueprints** with a hammer, **doors** that open and close. Finishing,
 *   upgrading and repairing take their items from a material source (`useMaterials`: the bags and the chests near
 *   the part, M4-24); without one from the bags.
 * - **Area repair** (`build.repair`, §16.6 "Flächenreparatur", M4-25): the hammer mends every damaged part of a
 *   rectangle in build reach for a share of its materials (src/game/building/repair.ts).
 * - **Rules of other systems** (M4-20, M4-21): `addPlacementRule` (one hearth per base, three bases at most),
 *   `addRemovalRule` (a chest that holds items, a burning hearth).
 * - Every change is reported to the collision grid (walls, doors and furniture collide, jetties bridge water; the
 *   light map traces again) and to the change listeners (rooms); placed and removed parts to the part listeners
 *   (stations, chests of later systems).
 *
 * No tick hooks (buildings do not change by themselves). Save participant `building`: the structure layers and the
 * placing ticks of the last 30 s (the full refund).
 */
import { BALANCE } from '../../content/balance';
import { BUILD_LAYERS, type BuildLayer } from '../../content/buildParts';
import { BLOCK_HAZARD, BLOCK_OBJECT, BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL, INFO_CONNECTOR, infoLevel, infoWallTop } from '../../world/collision/tiles';
import { TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_MASK } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import { contentPartCatalog, isUpgrade, type PartCatalog, type PartDef } from '../../world/structures/catalog';
import { BUILD_LAYER_COUNT, BUILD_LAYER_INDEX, anchorCell, cellBlueprint, cellCovered, cellOpen, cellPart, cellRot, coveredCell, rotatedSize, withOpen, withPart, withoutBlueprint } from '../../world/structures/cells';
import { ROT_DX, ROT_DY, StructureCollisionOverlay, anchorOf, type AnchorRef } from '../../world/structures/query';
import { deserializeStructures, serializeStructures } from '../../world/structures/snapshot';
import { StructureStore } from '../../world/structures/store';
import { z } from 'zod';
import type { SeatProvider } from '../actions/system';
import type { CommandOfType, GameCommandType } from '../commands';
import type { InventorySystem } from '../inventory/system';
import { newStack, type ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { BuildRejectReason, PartRefund, PartRemoveReason } from './events';
import { contentMaterialBook, type ItemAmount, type MaterialBook } from './materials';
import { repairCost } from './repair';
import { MAX_ROOF_REACH, roofDistances, roofSupportDistance, unsupportedRoofs, type RoofDistances, type RoofGrid } from './statics';

/** Id of the building system and its save participant. */
export const BUILDING_SYSTEM_ID = 'building';
/** Data version of the `building` participant. */
export const BUILDING_SAVE_VERSION = 1;

const B = BALANCE.building;
const REPAIR = B.repair;
const TICK_HZ = BALANCE.time.tickHz;
/** Build reach [px] (§16.1). */
const REACH_PX = B.reachTiles * TILE_PX;
/** Ticks after placing in which dismantling gives the whole piece back (§16.6). */
const FULL_REFUND_TICKS = B.refund.fullSeconds * TICK_HZ;
/** Radius of the player's body [px] (a blocking part cannot be placed onto it). */
const BODY_RADIUS_PX = BALANCE.player.movement.colliderRadiusPx;
/** Tile key span (larger than the largest world, 2048 tiles). */
const TILE_SPAN = 4096;
/** Bias that makes world layers (−3 … 0) non-negative in keys. */
const LAYER_BIAS = 3;
const FLOOR = BUILD_LAYER_INDEX.boden;
const STRUCTURE = BUILD_LAYER_INDEX.struktur;
const OBJECT = BUILD_LAYER_INDEX.objekt;
const WALL_OBJECT = BUILD_LAYER_INDEX.wandobjekt;
const ROOF = BUILD_LAYER_INDEX.dach;
/** The layer `build.remove` takes without `ebene`: what the hand reaches first. */
const REMOVE_ORDER: readonly number[] = [WALL_OBJECT, OBJECT, STRUCTURE, ROOF, FLOOR];
/** Terrain that no part stands on: rock, lava, outside the world. */
const GROUND_BLOCKERS = BLOCK_SOLID | BLOCK_HAZARD | BLOCK_VOID;
/** Collision of a part that cannot be set onto the player's body. */
const BODY_BLOCKERS = BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD;

/** Puts a stack into the world at (x, y) on `layer` (the drop system). */
export type DropItems = (sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number) => void;

/** Reports a change of the structures in the tile rectangle [tx0, tx1] × [ty0, ty1] of `layer` (rooms, overlays). */
export type BuildChangeListener = (sim: Simulation, layer: Layer, tx0: number, ty0: number, tx1: number, ty1: number) => void;

/** Whether something another system placed stands on tile (tx, ty) of `layer` (a station, a torch, a camp fire). */
export type OccupancyProvider = (sim: Simulation, layer: Layer, tx: number, ty: number) => boolean;

/** Hears parts come and go (chests, beds: their state lives with the anchor); `reason` says why a part left. */
export interface PartListener {
  placed?(sim: Simulation, part: PartDef, layer: Layer, tx: number, ty: number): void;
  removed?(sim: Simulation, part: PartDef, layer: Layer, tx: number, ty: number, reason: PartRemoveReason): void;
}

/**
 * A rule of another system about placing `part` with its anchor on (tx, ty) (rotated footprint w × h): the refusal,
 * or `null` (the hearth: three bases at most, one hearth per base). Also asked by the ghost preview and before a
 * blueprint is finished.
 */
export type PlacementRule = (sim: Simulation, part: PartDef, layer: Layer, tx: number, ty: number, w: number, h: number) => BuildRejectReason | null;

/** A rule of another system about taking the finished part anchored on (tx, ty) down or replacing it: the refusal, or `null`. */
export type RemovalRule = (sim: Simulation, part: PartDef, layer: Layer, tx: number, ty: number) => BuildRejectReason | null;

/**
 * Where finishing a blueprint, upgrading and repairing take their items (§16.6 "Material kommt aus Kisten im
 * Umkreis"): the bags and the chests near the part anchored on (tx, ty).
 */
export interface BuildMaterialSource {
  /** Usable pieces of `item` at hand for the part on (tx, ty) [pieces]. */
  count(sim: Simulation, item: string, layer: Layer, tx: number, ty: number): number;
  /** Takes exactly `count` pieces of `item` (true), or nothing when fewer are at hand (false). */
  take(sim: Simulation, item: string, count: number, layer: Layer, tx: number, ty: number): boolean;
}

/** Dependencies of the building system. */
export interface BuildingSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly collision: WorldCollision;
  /** Refunds that do not fit and collapse rubble go here. */
  readonly drops: DropItems;
  /** Default: the game's build parts and stations. */
  readonly catalog?: PartCatalog;
  /** Default: the materials of the game's recipes. */
  readonly materials?: MaterialBook;
}

const snapshotSchema = z
  .object({
    structures: z.unknown(),
    /** Placing ticks of the last 30 s: `[layer, buildLayer, tx, ty, tick]`. */
    recent: z.array(z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int().min(0)])),
  })
  .strict();

/** Where and on what the player acts. */
interface Actor {
  layer: Layer;
  x: number;
  y: number;
}

/** Key of a cell (world layer, build layer, tile). */
function cellKey(layer: Layer, li: number, tx: number, ty: number): number {
  return (((layer + LAYER_BIAS) * BUILD_LAYER_COUNT + li) * TILE_SPAN + ty) * TILE_SPAN + tx;
}

/** Centre of tile `t` [px]. */
function centre(t: number): number {
  return (t + 0.5) * TILE_PX;
}

/**
 * The roof grid statics reads (`RoofGrid`), set up for one question and reused for the next – the ghost preview asks
 * every frame, so it allocates nothing: finished roofs and supports of `layer` (with `plans` also blueprints) and –
 * when `reach` > 0 – a candidate roof of that reach on (cx, cy).
 */
class StructureRoofGrid implements RoofGrid {
  layer: Layer = 0;
  plans = false;
  cx = 0;
  cy = 0;
  reach = 0;

  constructor(
    private readonly store: StructureStore,
    private readonly catalog: PartCatalog,
  ) {}

  /** Sets the question; returns the grid. */
  set(layer: Layer, plans: boolean, cx: number, cy: number, reach: number): this {
    this.layer = layer;
    this.plans = plans;
    this.cx = cx;
    this.cy = cy;
    this.reach = reach;
    return this;
  }

  roofReach(tx: number, ty: number): number {
    if (this.reach > 0 && tx === this.cx && ty === this.cy) return this.reach;
    const cell = this.store.cell(this.layer, ROOF, tx, ty);
    if (cell === 0 || (!this.plans && cellBlueprint(cell))) return 0;
    return this.catalog.byRuntimeId(cellPart(cell))?.roofReach ?? 0;
  }

  support(tx: number, ty: number): boolean {
    const cell = this.store.cell(this.layer, STRUCTURE, tx, ty);
    if (cell === 0 || (!this.plans && cellBlueprint(cell))) return false;
    return this.catalog.byRuntimeId(cellPart(cell))?.supports === true;
  }
}

export class BuildingSystem implements SimSystem {
  readonly id = BUILDING_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  /** The structure layers (read-only for other systems: every write goes through a command). */
  readonly structures = new StructureStore();
  readonly catalog: PartCatalog;
  readonly materials: MaterialBook;
  /** The collision of the built structures (the collision grid's overlay). */
  readonly overlay: StructureCollisionOverlay;

  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly collision: WorldCollision;
  private readonly drops: DropItems;
  private readonly recent = new Map<number, number>();
  private readonly changeListeners: BuildChangeListener[] = [];
  private readonly partListeners: PartListener[] = [];
  private readonly restoreListeners: Array<() => void> = [];
  private readonly occupancy: OccupancyProvider[] = [];
  private readonly placementRules: PlacementRule[] = [];
  private readonly removalRules: RemovalRule[] = [];
  /** The bags alone, until `useMaterials` connects the chests. */
  private materialSource: BuildMaterialSource = {
    count: (_sim, item) => this.inventory.count(item),
    take: (sim, item, count) => this.inventory.take(sim, item, count) !== null,
  };
  private readonly actor: Actor = { layer: 0, x: 0, y: 0 };
  private readonly anchor: AnchorRef = { tx: 0, ty: 0, cell: 0 };
  private readonly pos = { x: 0, y: 0 };
  private readonly roofs: StructureRoofGrid;

  constructor(deps: BuildingSystemDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.collision = deps.collision;
    this.drops = deps.drops;
    this.catalog = deps.catalog ?? contentPartCatalog();
    this.materials = deps.materials ?? contentMaterialBook();
    this.overlay = new StructureCollisionOverlay(this.structures, this.catalog);
    this.roofs = new StructureRoofGrid(this.structures, this.catalog);
    this.collision.addOverlay(this.overlay);
    this.commands = {
      'build.place': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.place(sim, cmd, tick, false)),
      'build.blueprint': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.place(sim, cmd, tick, true)),
      'build.complete': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.complete(sim, cmd, tick)),
      'build.remove': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.removeCommand(sim, cmd, tick)),
      'build.upgrade': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.upgrade(sim, cmd, tick)),
      'build.door': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.door(sim, cmd, tick)),
      'build.repair': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.repairArea(sim, cmd, tick)),
    };
    this.save = {
      id: BUILDING_SYSTEM_ID,
      version: BUILDING_SAVE_VERSION,
      // Saves from before building (save version 1, M3) have no buildings.
      migrations: [{ from: 0, migrate: () => ({ structures: { ids: [], cells: [] }, recent: [] }) }],
      serialize: () => ({
        structures: serializeStructures(this.structures, (rid) => this.catalog.byRuntimeId(rid)?.id ?? String(rid)),
        recent: [...this.recent.entries()].sort((a, b) => a[0] - b[0]).map(([key, tick]) => [...this.unkey(key), tick]),
      }),
      deserialize: (data) => this.restore(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Hooks and queries
  // -------------------------------------------------------------------------------------------

  /** Adds a listener for every change of the structures (the rooms). */
  onChange(listener: BuildChangeListener): void {
    this.changeListeners.push(listener);
  }

  /** Adds a source of things other systems placed: no structure or object is built onto them (stations, lights). */
  addOccupancy(provider: OccupancyProvider): void {
    this.occupancy.push(provider);
  }

  /** Adds a listener for a restored save (everything may have changed: caches start afresh). */
  onRestore(listener: () => void): void {
    this.restoreListeners.push(listener);
  }

  /** Adds a listener for parts that come and go. */
  addPartListener(listener: PartListener): void {
    this.partListeners.push(listener);
  }

  /** Adds a rule of another system about placing parts (asked by `build.place`, `build.blueprint`, the preview and `build.complete`). */
  addPlacementRule(rule: PlacementRule): void {
    this.placementRules.push(rule);
  }

  /** Adds a rule of another system about taking finished parts down or replacing them (`build.remove`, `build.upgrade`). */
  addRemovalRule(rule: RemovalRule): void {
    this.removalRules.push(rule);
  }

  /** Sets where finishing, upgrading and repairing take their items (the bags and the chests near the part, M4-24). */
  useMaterials(source: BuildMaterialSource): void {
    this.materialSource = source;
  }

  /** The part on tile (tx, ty) of build layer `ebene` (covered tiles included), or `undefined`. */
  partAt(layer: Layer, ebene: BuildLayer, tx: number, ty: number): PartDef | undefined {
    const cell = this.structures.cell(layer, BUILD_LAYER_INDEX[ebene], tx, ty);
    return cell === 0 ? undefined : this.catalog.byRuntimeId(cellPart(cell));
  }

  /** Whether a finished roof covers tile (tx, ty) (§16.4: no precipitation; torches under it stay dry). */
  roofed(layer: Layer, tx: number, ty: number): boolean {
    const cell = this.structures.cell(layer, ROOF, tx, ty);
    return cell !== 0 && !cellBlueprint(cell);
  }

  /**
   * Whether something of the grid stands on the ground of tile (tx, ty) – a floor, jetty, trapdoor, structure or piece
   * of furniture, finished or planned (the gathering system's ground claims: no shovel or hoe under a building, no
   * water running under it). Roofs and wall furniture hang above the ground and do not claim it.
   */
  groundBuilt(layer: Layer, tx: number, ty: number): boolean {
    const store = this.structures;
    return store.cell(layer, FLOOR, tx, ty) !== 0 || store.cell(layer, STRUCTURE, tx, ty) !== 0 || store.cell(layer, OBJECT, tx, ty) !== 0;
  }

  /** Whether a finished ladder leans on tile (tx, ty) (the player's `ClimbAids`). */
  ladderAt(layer: Layer, tx: number, ty: number): boolean {
    const cell = this.structures.cell(layer, STRUCTURE, tx, ty);
    return cell !== 0 && !cellBlueprint(cell) && this.catalog.byRuntimeId(cellPart(cell))?.kind === 'leiter';
  }

  /**
   * Seats of the placed chairs, stools and benches (the actions' `addSeats`, §11.4 "Sitzen (Stühle, Baumstümpfe)"):
   * E on a tile of a finished seat sits down at the centre of its footprint.
   */
  seats(): SeatProvider {
    return (_sim, layer, tx, ty) => {
      if (!anchorOf(this.structures, layer, OBJECT, tx, ty, this.anchor) || cellBlueprint(this.anchor.cell)) return null;
      const part = this.catalog.byRuntimeId(cellPart(this.anchor.cell));
      if (part === undefined || part.category !== 'sitz') return null;
      const size = rotatedSize(part.w, part.h, cellRot(this.anchor.cell));
      return { x: (this.anchor.tx + size.w / 2) * TILE_PX, y: (this.anchor.ty + size.h / 2) * TILE_PX, layer };
    };
  }

  /**
   * Support distances of the finished roofs in the tile window (the build mode's support overlay, §16.3 "Der
   * Baumodus zeigt die Stützreichweite als Overlay"): per tile the distance to the next support, −1 where no roof
   * lies or it is not carried.
   */
  roofSupport(layer: Layer, x0: number, y0: number, w: number, h: number): RoofDistances {
    return roofDistances(this.roofGrid(layer, false, 0, 0, 0), x0, y0, w, h);
  }

  /**
   * Why the part `part` of cell `cell` anchored on (tx, ty) of `layer` cannot be dismantled now because of what it
   * carries (`carriesLoad`: a finished jetty with something standing or hanging on it), or `null` – the building
   * system's own rule of `build.remove`, read-only for the build mode's ghost before the click (M5-52).
   */
  loadProblem(sim: Simulation, part: Pick<PartDef, 'kind'>, cell: number, layer: Layer, tx: number, ty: number): 'carriesLoad' | null {
    return part.kind === 'steg' && !cellBlueprint(cell) && this.carriesLoad(sim, layer, tx, ty) ? 'carriesLoad' : null;
  }

  /** Tick a finished part was placed (within the full refund window), or `undefined`. */
  placedTick(layer: Layer, ebene: BuildLayer, tx: number, ty: number): number | undefined {
    return this.recent.get(cellKey(layer, BUILD_LAYER_INDEX[ebene], tx, ty));
  }

  /**
   * The ghost preview of the build mode (§16.6 "Geister-Vorschau grün/rot mit Grund"): why `build.place` (or
   * `build.blueprint` with `blueprint`) of `part` with its anchor on (tx, ty) and rotation `rot` would be refused
   * now, or `null` when it would succeed. Read-only: the same rules as the command, nothing is placed or taken.
   */
  preview(sim: Simulation, part: string, tx: number, ty: number, rot = 0, blueprint = false): BuildRejectReason | null {
    const checked = this.check(sim, part, tx, ty, rot, blueprint);
    if (typeof checked === 'string') return checked;
    return blueprint || this.inventory.count(checked.part.id) > 0 ? null : 'noMaterial';
  }

  /**
   * Damages the part on tile (tx, ty) of build layer `ebene` by `amount` hit points (fire, the Schattenflut, bosses:
   * §16.8 "Gebäude nehmen nur durch Schattenflut, Brände und Bosse Schaden"). At 0 the part is destroyed – nothing
   * comes back, wall furniture falls off a destroyed wall, roofs it carried may collapse. Returns the hit points left
   * (0: destroyed), or −1 when no part stands there.
   */
  damage(sim: Simulation, layer: Layer, ebene: BuildLayer, tx: number, ty: number, amount: number): number {
    const li = BUILD_LAYER_INDEX[ebene];
    if (!anchorOf(this.structures, layer, li, tx, ty, this.anchor)) return -1;
    const { tx: ax, ty: ay, cell } = this.anchor;
    const part = this.catalog.byRuntimeId(cellPart(cell)) as PartDef;
    const hp = Math.max(0, this.structures.hp(layer, li, ax, ay) - Math.max(0, amount));
    const tick = sim.eventTick;
    sim.events.push('partDamaged', { part: part.id, layer, tx: ax, ty: ay, ebene, hp, material: part.material, tick });
    if (hp > 0) {
      this.structures.setHp(layer, li, ax, ay, hp);
      return hp;
    }
    const size = rotatedSize(part.w, part.h, cellRot(cell));
    this.clear(layer, li, ax, ay, size.w, size.h);
    this.recent.delete(cellKey(layer, li, ax, ay));
    sim.events.push('partRemoved', { part: part.id, layer, tx: ax, ty: ay, ebene, reason: 'zerstoert', refund: 'keine', material: part.material, tick });
    if (!cellBlueprint(cell)) for (const l of this.partListeners) l.removed?.(sim, part, layer, ax, ay, 'zerstoert');
    if (part.kind === 'wand' && !cellBlueprint(cell)) this.dropWallFurniture(sim, layer, ax, ay, tick);
    this.changed(sim, layer, ax, ay, ax + size.w - 1, ay + size.h - 1);
    if (!cellBlueprint(cell) && (part.supports || part.layer === 'dach')) this.settle(sim, layer, ax, ay, tick);
    return 0;
  }

  // -------------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------------

  /** The rules of placing (command and preview): the part, its rotation and footprint, or the refusal. */
  private check(sim: Simulation, partId: string, tx: number, ty: number, rotation: number, blueprint: boolean): { part: PartDef; rot: number; w: number; h: number } | BuildRejectReason {
    const who = this.actorOf(sim);
    if (who !== null) return who;
    const part = this.catalog.find(partId);
    if (part === undefined) return 'unknownPart';
    // Wall furniture always hangs on the wall north of its tile; ladders lean north against their cliff.
    const rot = part.layer === 'wandobjekt' || part.kind === 'leiter' ? 0 : rotation;
    const size = rotatedSize(part.w, part.h, rot);
    if (this.distanceToRect(this.actor.x, this.actor.y, tx, ty, size.w, size.h) > REACH_PX) return 'tooFar';
    const problem = this.placementProblem(sim, part, this.actor.layer, tx, ty, size.w, size.h, rot, blueprint) ?? this.ruleProblem(sim, part, this.actor.layer, tx, ty, size.w, size.h);
    return problem ?? { part, rot, w: size.w, h: size.h };
  }

  private place(sim: Simulation, cmd: CommandOfType<'build.place'> | CommandOfType<'build.blueprint'>, tick: number, blueprint: boolean): BuildRejectReason | null {
    const checked = this.check(sim, cmd.part, cmd.tx, cmd.ty, cmd.rot ?? 0, blueprint);
    if (typeof checked === 'string') return checked;
    const { part, rot } = checked;
    const size = { w: checked.w, h: checked.h };
    const layer = this.actor.layer;
    if (!blueprint && this.inventory.take(sim, part.id, 1) === null) return 'noMaterial';
    const anchor = anchorCell(part.rid, rot, cmd.mirror ?? false, false, blueprint);
    this.write(layer, part.layerIndex, cmd.tx, cmd.ty, size.w, size.h, anchor, part.hp);
    if (!blueprint) {
      this.prune(tick);
      this.recent.set(cellKey(layer, part.layerIndex, cmd.tx, cmd.ty), tick);
    }
    this.changed(sim, layer, cmd.tx, cmd.ty, cmd.tx + size.w - 1, cmd.ty + size.h - 1);
    sim.events.push('partPlaced', { part: part.id, layer, tx: cmd.tx, ty: cmd.ty, ebene: part.layer, rot, mirror: cmd.mirror ?? false, blueprint, material: part.material, tick });
    if (!blueprint) for (const l of this.partListeners) l.placed?.(sim, part, layer, cmd.tx, cmd.ty);
    return null;
  }

  private complete(sim: Simulation, cmd: CommandOfType<'build.complete'>, tick: number): BuildRejectReason | null {
    const who = this.actorOf(sim);
    if (who !== null) return who;
    const layer = this.actor.layer;
    // Without a layer: the topmost blueprint on the tile, else the topmost part (which then is no blueprint).
    let li = cmd.ebene === undefined ? this.topmost(layer, cmd.tx, cmd.ty, true) : BUILD_LAYER_INDEX[cmd.ebene];
    if (li < 0) li = this.topmost(layer, cmd.tx, cmd.ty, false);
    if (li < 0 || !anchorOf(this.structures, layer, li, cmd.tx, cmd.ty, this.anchor)) return 'nothingHere';
    const { tx, ty, cell } = this.anchor;
    const part = this.catalog.byRuntimeId(cellPart(cell)) as PartDef;
    if (!cellBlueprint(cell)) return 'notABlueprint';
    const size = rotatedSize(part.w, part.h, cellRot(cell));
    if (this.distanceToRect(this.actor.x, this.actor.y, tx, ty, size.w, size.h) > REACH_PX) return 'tooFar';
    if (!this.hammerInHand()) return 'noHammer';
    // The ground may have changed since the plan was laid (water, a tree grown back, a torch set down): the same rules
    // as placing a finished part – a wall is never finished on water –, the support from finished parts only.
    const problem = this.placementProblem(sim, part, layer, tx, ty, size.w, size.h, cellRot(cell), false, true);
    if (problem !== null) return problem;
    const rule = this.ruleProblem(sim, part, layer, tx, ty, size.w, size.h);
    if (rule !== null) return rule;
    if (!this.materialSource.take(sim, part.id, 1, layer, tx, ty)) return 'noMaterial';
    this.write(layer, li, tx, ty, size.w, size.h, withoutBlueprint(cell), part.hp);
    this.prune(tick);
    this.recent.set(cellKey(layer, li, tx, ty), tick);
    this.changed(sim, layer, tx, ty, tx + size.w - 1, ty + size.h - 1);
    sim.events.push('blueprintCompleted', { part: part.id, layer, tx, ty, ebene: part.layer, material: part.material, tick });
    for (const l of this.partListeners) l.placed?.(sim, part, layer, tx, ty);
    return null;
  }

  private removeCommand(sim: Simulation, cmd: CommandOfType<'build.remove'>, tick: number): BuildRejectReason | null {
    const who = this.actorOf(sim);
    if (who !== null) return who;
    const layer = this.actor.layer;
    const li = cmd.ebene === undefined ? this.topmost(layer, cmd.tx, cmd.ty, false) : BUILD_LAYER_INDEX[cmd.ebene];
    if (li < 0 || !anchorOf(this.structures, layer, li, cmd.tx, cmd.ty, this.anchor)) return 'nothingHere';
    const { tx, ty, cell } = this.anchor;
    const part = this.catalog.byRuntimeId(cellPart(cell)) as PartDef;
    const size = rotatedSize(part.w, part.h, cellRot(cell));
    if (this.distanceToRect(this.actor.x, this.actor.y, tx, ty, size.w, size.h) > REACH_PX) return 'tooFar';
    const load = this.loadProblem(sim, part, cell, layer, tx, ty);
    if (load !== null) return load;
    if (!cellBlueprint(cell)) {
      const rule = this.removalProblem(sim, part, layer, tx, ty);
      if (rule !== null) return rule;
    }
    this.prune(tick);
    const refund = this.refundKind(layer, li, tx, ty, cell, tick);
    this.clear(layer, li, tx, ty, size.w, size.h);
    this.recent.delete(cellKey(layer, li, tx, ty));
    this.giveBack(sim, part, refund, layer);
    sim.events.push('partRemoved', { part: part.id, layer, tx, ty, ebene: part.layer, reason: 'abgebaut', refund, material: part.material, tick });
    if (!cellBlueprint(cell)) for (const l of this.partListeners) l.removed?.(sim, part, layer, tx, ty, 'abgebaut');
    if (part.kind === 'wand' && !cellBlueprint(cell)) this.dropWallFurniture(sim, layer, tx, ty, tick);
    this.changed(sim, layer, tx, ty, tx + size.w - 1, ty + size.h - 1);
    if (!cellBlueprint(cell) && (part.supports || part.layer === 'dach')) this.settle(sim, layer, tx, ty, tick);
    return null;
  }

  private upgrade(sim: Simulation, cmd: CommandOfType<'build.upgrade'>, tick: number): BuildRejectReason | null {
    const who = this.actorOf(sim);
    if (who !== null) return who;
    const next = this.catalog.find(cmd.part);
    if (next === undefined) return 'unknownPart';
    const layer = this.actor.layer;
    const li = next.layerIndex;
    if (!anchorOf(this.structures, layer, li, cmd.tx, cmd.ty, this.anchor)) return 'nothingHere';
    const { tx, ty, cell } = this.anchor;
    const old = this.catalog.byRuntimeId(cellPart(cell)) as PartDef;
    // Only a better part of the same kind, footprint and category (§16.6 "Aufwerten … (Holz → Stein)"): no downgrades,
    // no chair into a chest.
    if (!isUpgrade(old, next)) return 'notUpgradable';
    const size = rotatedSize(old.w, old.h, cellRot(cell));
    if (this.distanceToRect(this.actor.x, this.actor.y, tx, ty, size.w, size.h) > REACH_PX) return 'tooFar';
    const blueprint = cellBlueprint(cell);
    // A part that stands in the way is never set onto the player (a cushion upgraded to a stool would trap them).
    if (!blueprint && this.newlyBlocks(old, next, cell) && this.bodyOverlaps(tx, ty, size.w, size.h)) return 'blocked';
    if (next.layer === 'dach' && roofSupportDistance(this.roofGrid(layer, blueprint, tx, ty, next.roofReach), tx, ty) < 0) return 'noSupport';
    if (!blueprint) {
      const rule = this.removalProblem(sim, old, layer, tx, ty) ?? this.ruleProblem(sim, next, layer, tx, ty, size.w, size.h);
      if (rule !== null) return rule;
    }
    if (!blueprint && !this.materialSource.take(sim, next.id, 1, layer, tx, ty)) return 'noMaterial';
    this.prune(tick);
    const refund = this.refundKind(layer, li, tx, ty, cell, tick);
    this.write(layer, li, tx, ty, size.w, size.h, withPart(cell, next.rid), next.hp);
    this.recent.delete(cellKey(layer, li, tx, ty));
    if (!blueprint) this.recent.set(cellKey(layer, li, tx, ty), tick);
    this.giveBack(sim, old, refund, layer);
    sim.events.push('partRemoved', { part: old.id, layer, tx, ty, ebene: old.layer, reason: 'aufgewertet', refund, material: old.material, tick });
    sim.events.push('partUpgraded', { from: old.id, to: next.id, layer, tx, ty, ebene: next.layer, material: next.material, tick });
    if (!blueprint) {
      for (const l of this.partListeners) l.removed?.(sim, old, layer, tx, ty, 'aufgewertet');
      for (const l of this.partListeners) l.placed?.(sim, next, layer, tx, ty);
    }
    this.changed(sim, layer, tx, ty, tx + size.w - 1, ty + size.h - 1);
    if (!blueprint && next.layer === 'dach') this.settle(sim, layer, tx, ty, tick);
    return null;
  }

  /**
   * What `build.door {tx, ty, open}` would do now, read-only (the command and the interaction's hint): the door, gate or
   * trapdoor on the tile – its build layer, anchor, footprint and whether it ends up open – or the refusal.
   */
  private doorPlan(sim: Simulation, tx0: number, ty0: number, wanted: boolean | undefined): { li: number; part: PartDef; tx: number; ty: number; cell: number; w: number; h: number; open: boolean } | BuildRejectReason {
    const who = this.actorOf(sim);
    if (who !== null) return who;
    const layer = this.actor.layer;
    // The door or gate in the structure layer, else a trapdoor in the floor.
    const li = this.openableAt(layer, STRUCTURE, tx0, ty0) ? STRUCTURE : FLOOR;
    if (!anchorOf(this.structures, layer, li, tx0, ty0, this.anchor)) return 'notADoor';
    const { tx, ty, cell } = this.anchor;
    const part = this.catalog.byRuntimeId(cellPart(cell)) as PartDef;
    if (!part.openable || cellBlueprint(cell)) return 'notADoor';
    const size = rotatedSize(part.w, part.h, cellRot(cell));
    if (this.distanceToRect(this.actor.x, this.actor.y, tx, ty, size.w, size.h) > REACH_PX) return 'tooFar';
    const open = wanted ?? !cellOpen(cell);
    // Closing onto the player, or opening a trapdoor under the player, would trap or drop them.
    const blocksAfter = open ? part.blocksOpen : part.blocks;
    if (open !== cellOpen(cell) && (blocksAfter & BODY_BLOCKERS) !== 0 && this.bodyOverlaps(tx, ty, size.w, size.h)) return 'doorwayBlocked';
    // A trapdoor that something stands on – a part of the grid, a station, a torch, a camp fire – stays shut.
    if (open && !cellOpen(cell) && part.kind === 'falltuer' && this.carriesLoad(sim, layer, tx, ty)) return 'carriesLoad';
    return { li, part, tx, ty, cell, w: size.w, h: size.h, open };
  }

  /**
   * The door, gate or trapdoor covering tile (tx, ty) of the player's layer and what E would do with it (the interaction's
   * use target, src/game/building/uses.ts): its part, whether it is open now and why `build.door` would refuse to
   * toggle it (`doorwayBlocked` when the player stands in the way), read-only. `null` when none stands there.
   */
  doorAt(sim: Simulation, tx: number, ty: number): { readonly part: PartDef; readonly open: boolean; readonly problem: BuildRejectReason | null } | null {
    const plan = this.doorPlan(sim, tx, ty, undefined);
    if (typeof plan !== 'string') return { part: plan.part, open: !plan.open, problem: null };
    if (plan !== 'doorwayBlocked') return null;
    // Blocked: the part is there (the plan checked it), only the body is in the way.
    const cell = this.anchor.cell;
    return { part: this.catalog.byRuntimeId(cellPart(cell)) as PartDef, open: cellOpen(cell), problem: plan };
  }

  /**
   * The topmost blueprint covering tile (tx, ty) of the player's layer and whether a hammer is in the hand (the
   * interaction's use target "Fertigstellen", src/game/building/uses.ts; §16.6 "mit Hammer … fertigstellen"), read-only;
   * `null` when no blueprint lies there or the player cannot act.
   */
  blueprintAt(sim: Simulation, tx: number, ty: number): { readonly part: PartDef; readonly hammer: boolean } | null {
    if (this.actorOf(sim) !== null) return null;
    const li = this.topmost(this.actor.layer, tx, ty, true);
    if (li < 0 || !anchorOf(this.structures, this.actor.layer, li, tx, ty, this.anchor)) return null;
    return { part: this.catalog.byRuntimeId(cellPart(this.anchor.cell)) as PartDef, hammer: this.hammerInHand() };
  }

  /**
   * Turns the finished part anchored on (tx, ty) of build layer `ebene` into part `to` of the same kind and footprint
   * in place, without a player, material or refund (the station system's upgrade recipe, Werkbank I → II: the station
   * turned, its part follows). Keeps rotation, mirroring and open state; the new part has its full hit points.
   * `partUpgraded` tells the presentation; part listeners do not hear it (the owner turned it). False when no such part
   * stands there, `to` does not fit, or `to` would stand in the way where the player's body is and the old part did not.
   */
  swapPart(sim: Simulation, layer: Layer, ebene: BuildLayer, tx: number, ty: number, to: string): boolean {
    const li = BUILD_LAYER_INDEX[ebene];
    if (!anchorOf(this.structures, layer, li, tx, ty, this.anchor) || this.anchor.tx !== tx || this.anchor.ty !== ty) return false;
    const cell = this.anchor.cell;
    const old = this.catalog.byRuntimeId(cellPart(cell)) as PartDef;
    const next = this.catalog.find(to);
    if (next === undefined || cellBlueprint(cell) || next.id === old.id || next.kind !== old.kind || next.layerIndex !== li || next.w !== old.w || next.h !== old.h) return false;
    const size = rotatedSize(old.w, old.h, cellRot(cell));
    if (this.newlyBlocks(old, next, cell) && this.bodyOn(sim, layer, tx, ty, size.w, size.h)) return false;
    this.write(layer, li, tx, ty, size.w, size.h, withPart(cell, next.rid), next.hp);
    this.changed(sim, layer, tx, ty, tx + size.w - 1, ty + size.h - 1);
    sim.events.push('partUpgraded', { from: old.id, to: next.id, layer, tx, ty, ebene: next.layer, material: next.material, tick: sim.eventTick });
    return true;
  }

  private door(sim: Simulation, cmd: CommandOfType<'build.door'>, tick: number): BuildRejectReason | null {
    const plan = this.doorPlan(sim, cmd.tx, cmd.ty, cmd.open);
    if (typeof plan === 'string') return plan;
    const { li, part, tx, ty, cell, open } = plan;
    if (open === cellOpen(cell)) return null;
    const layer = this.actor.layer;
    const size = { w: plan.w, h: plan.h };
    this.write(layer, li, tx, ty, size.w, size.h, withOpen(cell, open), this.structures.hp(layer, li, tx, ty));
    this.changed(sim, layer, tx, ty, tx + size.w - 1, ty + size.h - 1);
    sim.events.push('doorToggled', { part: part.id, layer, tx, ty, open, tick });
    return null;
  }

  /**
   * `build.repair` (§16.6 "Flächenreparatur", M4-25): mends every finished, damaged part anchored in the rectangle
   * and within build reach to its full hit points, in the order of the build layers and rows; each pays its share of
   * materials (`repairCost`) from the material source near it, parts whose materials are missing stay as they are.
   */
  private repairArea(sim: Simulation, cmd: CommandOfType<'build.repair'>, tick: number): BuildRejectReason | null {
    const who = this.actorOf(sim);
    if (who !== null) return who;
    const x0 = Math.min(cmd.tx0, cmd.tx1);
    const x1 = Math.max(cmd.tx0, cmd.tx1);
    const y0 = Math.min(cmd.ty0, cmd.ty1);
    const y1 = Math.max(cmd.ty0, cmd.ty1);
    if (x1 - x0 + 1 > REPAIR.maxAreaTiles || y1 - y0 + 1 > REPAIR.maxAreaTiles) return 'areaTooLarge';
    if (!this.hammerInHand()) return 'noHammer';
    const layer = this.actor.layer;
    let damaged = 0;
    let mended = 0;
    for (let li = 0; li < BUILD_LAYER_COUNT; li++) {
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const cell = this.structures.cell(layer, li, tx, ty);
          // Anchors only (a part is mended once), finished parts only (a blueprint has no hit points yet).
          if (cell === 0 || cellCovered(cell) || cellBlueprint(cell)) continue;
          const part = this.catalog.byRuntimeId(cellPart(cell)) as PartDef;
          const hp = this.structures.hp(layer, li, tx, ty);
          if (hp >= part.hp) continue;
          const size = rotatedSize(part.w, part.h, cellRot(cell));
          if (this.distanceToRect(this.actor.x, this.actor.y, tx, ty, size.w, size.h) > REACH_PX) continue;
          damaged++;
          const cost = repairCost(this.materials.materials(part.id), hp, part.hp, REPAIR.materialShare);
          if (!cost.every((c) => this.materialSource.count(sim, c.item, layer, tx, ty) >= c.count)) continue;
          for (const c of cost) {
            if (!this.materialSource.take(sim, c.item, c.count, layer, tx, ty)) throw new Error(`BuildingSystem: ${c.count} × "${c.item}" counted but not taken`);
          }
          this.structures.setHp(layer, li, tx, ty, part.hp);
          mended++;
          sim.events.push('partRepaired', { part: part.id, layer, tx, ty, ebene: part.layer, hp: part.hp, material: part.material, tick });
        }
      }
    }
    if (damaged === 0) return 'nothingToRepair';
    return mended === 0 ? 'noMaterial' : null;
  }

  /** The first refusal of the placement rules of other systems, or `null`. */
  private ruleProblem(sim: Simulation, part: PartDef, layer: Layer, tx: number, ty: number, w: number, h: number): BuildRejectReason | null {
    for (let k = 0; k < this.placementRules.length; k++) {
      const reason = (this.placementRules[k] as PlacementRule)(sim, part, layer, tx, ty, w, h);
      if (reason !== null) return reason;
    }
    return null;
  }

  /** The first refusal of the removal rules of other systems for the finished part anchored on (tx, ty), or `null`. */
  private removalProblem(sim: Simulation, part: PartDef, layer: Layer, tx: number, ty: number): BuildRejectReason | null {
    for (let k = 0; k < this.removalRules.length; k++) {
      const reason = (this.removalRules[k] as RemovalRule)(sim, part, layer, tx, ty);
      if (reason !== null) return reason;
    }
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Placement rules
  // -------------------------------------------------------------------------------------------

  /**
   * Why `part` cannot stand with its anchor on (tx, ty) (rotated footprint w × h), or `null`. With `standing` the part
   * (a blueprint about to be finished) already lies there: its own cells do not count against it, everything else –
   * the ground, water, trees, other systems, support, the player – is judged as for a new part.
   */
  private placementProblem(sim: Simulation, part: PartDef, layer: Layer, tx: number, ty: number, w: number, h: number, rot: number, blueprint: boolean, standing = false): BuildRejectReason | null {
    const li = part.layerIndex;
    this.collision.ensureTiles(layer, tx - 1, ty - 1, tx + w, ty + h);
    const grid = this.collision.grid;
    grid.beginQuery();
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        if (!standing && this.structures.cell(layer, li, x, y) !== 0) return 'blocked';
        if ((grid.info(layer, x, y) & BLOCK_VOID) !== 0) return 'blocked';
      }
    }
    switch (part.layer) {
      case 'dach':
        return this.roofProblem(sim, part, layer, tx, ty, blueprint);
      case 'wandobjekt':
        return this.wallObjectProblem(sim, layer, tx, ty);
      default:
        break;
    }
    if (part.kind === 'leiter') return this.occupied(sim, layer, tx, ty) ? 'blocked' : this.ladderProblem(layer, tx, ty);
    if (part.kind === 'treppe') return this.occupied(sim, layer, tx, ty) ? 'blocked' : this.stairsProblem(layer, tx, ty, rot);
    let level = -1;
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        const problem = this.groundProblem(sim, part, layer, x, y);
        if (problem !== null) return problem;
        const l = infoLevel(grid.info(layer, x, y));
        if (level >= 0 && l !== level) return 'notLevel';
        level = l;
      }
    }
    if (!blueprint && (part.blocks & BODY_BLOCKERS) !== 0 && this.bodyOverlaps(tx, ty, w, h)) return 'blocked';
    return null;
  }

  /** Floors, structures and objects: what the ground under tile (x, y) must be. */
  private groundProblem(sim: Simulation, part: PartDef, layer: Layer, x: number, y: number): BuildRejectReason | null {
    const info = this.collision.grid.info(layer, x, y);
    const chunk = this.collision.chunks.get(layer, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
    if (chunk === undefined) return 'blocked';
    const i = ((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK);
    if ((info & (GROUND_BLOCKERS | BLOCK_WALL)) !== 0) return 'blocked';
    if (chunk.object[i] !== 0 || ((chunk.flags[i] as number) & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) !== 0) return 'blocked';
    // The other of the two standing layers (the part's own layer is empty – or, finishing a blueprint, the part itself).
    const li = part.layerIndex;
    const own = (li !== STRUCTURE && this.structures.cell(layer, STRUCTURE, x, y) !== 0) || (li !== OBJECT && this.structures.cell(layer, OBJECT, x, y) !== 0);
    const foreign = this.occupied(sim, layer, x, y);
    // An object bit neither the buildings nor another system explain: a large world object reaching over the tile.
    if ((info & BLOCK_OBJECT) !== 0 && !own && !foreign) return 'blocked';
    const water = ((chunk.water[i] as number) & WATER_DEPTH_MASK) !== 0;
    if (part.kind === 'steg') return water ? null : 'needsWater';
    if (part.layer === 'boden') return water ? 'blocked' : null;
    // Structures and objects: nothing else of the two layers or of other systems on the tile, dry land or a finished jetty.
    if (own || foreign) return 'blocked';
    if (water && !this.deckAt(layer, x, y)) return 'blocked';
    return null;
  }

  /** Whether another system placed something on the tile. */
  private occupied(sim: Simulation, layer: Layer, x: number, y: number): boolean {
    for (let k = 0; k < this.occupancy.length; k++) if ((this.occupancy[k] as OccupancyProvider)(sim, layer, x, y)) return true;
    return false;
  }

  /** A roof tile: no rock or blocking world object under it, a support in reach (§16.3). */
  private roofProblem(sim: Simulation, part: PartDef, layer: Layer, tx: number, ty: number, blueprint: boolean): BuildRejectReason | null {
    const grid = this.collision.grid;
    const info = grid.info(layer, tx, ty);
    const chunk = this.collision.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) return 'blocked';
    const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
    const rock = chunk.solid[i] !== 0 || ((grid.tables.ground[chunk.ground[i] as number] ?? 0) & BLOCK_SOLID) !== 0;
    const builtHere = this.structures.cell(layer, STRUCTURE, tx, ty) !== 0 || this.structures.cell(layer, OBJECT, tx, ty) !== 0 || this.occupied(sim, layer, tx, ty);
    if (rock || (!builtHere && (info & BLOCK_OBJECT) !== 0)) return 'blocked';
    return roofSupportDistance(this.roofGrid(layer, blueprint, tx, ty, part.roofReach), tx, ty) < 0 ? 'noSupport' : null;
  }

  /**
   * Wall furniture hangs on a wall, rock or cliff face north of its tile, the tile itself is open and holds no light
   * or station: a torch, camp fire, standing lamp or station there keeps it off (a wall lamp over another light would
   * be a lamp without light – the light system keeps one light per tile – and the lights and stations of other
   * systems share no tile with the grid).
   */
  private wallObjectProblem(sim: Simulation, layer: Layer, tx: number, ty: number): BuildRejectReason | null {
    const grid = this.collision.grid;
    if ((grid.info(layer, tx, ty) & (GROUND_BLOCKERS | BLOCK_WALL)) !== 0) return 'blocked';
    if (this.occupied(sim, layer, tx, ty)) return 'blocked';
    const northCell = this.structures.cell(layer, STRUCTURE, tx, ty - 1);
    const builtWall = northCell !== 0 && !cellBlueprint(northCell) && this.catalog.byRuntimeId(cellPart(northCell))?.kind === 'wand';
    if (builtWall) return null;
    const north = grid.info(layer, tx, ty - 1);
    return (north & (BLOCK_SOLID | BLOCK_WALL)) !== 0 && northCell === 0 ? null : 'needsWall';
  }

  /** A ladder leans against a cliff face (it stands on the face tile, §11.4). */
  private ladderProblem(layer: Layer, tx: number, ty: number): BuildRejectReason | null {
    const grid = this.collision.grid;
    const info = grid.info(layer, tx, ty);
    if ((info & GROUND_BLOCKERS) !== 0 || this.structures.cell(layer, OBJECT, tx, ty) !== 0) return 'blocked';
    if ((info & BLOCK_WALL) === 0 || infoWallTop(info) <= infoLevel(info)) return 'needsCliff';
    return null;
  }

  /**
   * Stairs lead up one height level in their direction `rot` (0 north, 1 east, 2 south, 3 west): northwards they
   * stand on the face of a cliff one level high, sideways on a tile next to a tile one level higher (§11.4
   * "hinauf nur über Rampen, Treppen …").
   */
  private stairsProblem(layer: Layer, tx: number, ty: number, rot: number): BuildRejectReason | null {
    const grid = this.collision.grid;
    const info = grid.info(layer, tx, ty);
    const ux = tx + (ROT_DX[rot] as number);
    const uy = ty + (ROT_DY[rot] as number);
    const upper = grid.info(layer, ux, uy);
    if ((info & GROUND_BLOCKERS) !== 0 || (upper & (GROUND_BLOCKERS | BLOCK_OBJECT)) !== 0) return 'blocked';
    if (this.structures.cell(layer, OBJECT, tx, ty) !== 0 || (info & INFO_CONNECTOR) !== 0) return 'blocked';
    const level = infoLevel(info);
    if ((upper & BLOCK_WALL) !== 0 || infoLevel(upper) !== level + 1) return 'needsCliff';
    if ((info & BLOCK_WALL) !== 0) return rot === 0 && infoWallTop(info) === level + 1 ? null : 'needsCliff';
    return (info & BLOCK_OBJECT) !== 0 ? 'blocked' : null;
  }

  // -------------------------------------------------------------------------------------------
  // Statics
  // -------------------------------------------------------------------------------------------

  /**
   * The roof grid of `layer` for statics: finished roofs and supports (with `plans` also blueprints), and – when
   * `reach` > 0 – a candidate roof of that reach on (cx, cy). One reused grid: valid until the next call.
   */
  private roofGrid(layer: Layer, plans: boolean, cx: number, cy: number, reach: number): RoofGrid {
    return this.roofs.set(layer, plans, cx, cy, reach);
  }

  /** Brings down every finished roof tile around (tx, ty) that is no longer carried (§16.3). */
  private settle(sim: Simulation, layer: Layer, tx: number, ty: number, tick: number): void {
    const fallen = unsupportedRoofs(this.roofGrid(layer, false, tx, ty, 0), tx, ty, MAX_ROOF_REACH);
    if (fallen.length === 0) return;
    const pieces = new Map<string, number>();
    let sx = 0;
    let sy = 0;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < fallen.length; k += 2) {
      const x = fallen[k] as number;
      const y = fallen[k + 1] as number;
      const cell = this.structures.cell(layer, ROOF, x, y);
      const part = this.catalog.byRuntimeId(cellPart(cell)) as PartDef;
      this.structures.set(layer, ROOF, x, y, 0, 0);
      this.recent.delete(cellKey(layer, ROOF, x, y));
      pieces.set(part.id, (pieces.get(part.id) ?? 0) + 1);
      sim.events.push('partRemoved', { part: part.id, layer, tx: x, ty: y, ebene: 'dach', reason: 'eingestuerzt', refund: 'anteilig', material: part.material, tick });
      for (const l of this.partListeners) l.removed?.(sim, part, layer, x, y, 'eingestuerzt');
      sx += x;
      sy += y;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const n = fallen.length / 2;
    const x = centre(sx / n);
    const y = centre(sy / n);
    const rubble = this.materials.refund([...pieces].map(([part, count]) => ({ part, pieces: count })), B.refund.collapseShare);
    for (const a of rubble) this.drops(sim, newStack(this.inventory.bags.catalog.get(a.item), a.count), layer, x, y);
    sim.events.push('roofCollapsed', { layer, tiles: fallen, x, y, tick });
    this.changed(sim, layer, x0, y0, x1, y1);
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  private refuse(sim: Simulation, type: GameCommandType, tick: number, reason: BuildRejectReason | null): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  /** Fills `this.actor` with the player's layer and position; the refusal when there is none or it cannot act. */
  private actorOf(sim: Simulation): BuildRejectReason | null {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.pos)) return 'noPlayer';
    const incapacity = this.player.incapacity(sim);
    if (incapacity !== null) return incapacity;
    this.actor.layer = body.layer;
    this.actor.x = this.pos.x;
    this.actor.y = this.pos.y;
    return null;
  }

  /** Distance from world px (x, y) to the nearest point of the tile rectangle of w × h tiles at (tx, ty) [px]. */
  private distanceToRect(x: number, y: number, tx: number, ty: number, w: number, h: number): number {
    const nx = Math.max(tx * TILE_PX, Math.min(x, (tx + w) * TILE_PX));
    const ny = Math.max(ty * TILE_PX, Math.min(y, (ty + h) * TILE_PX));
    return Math.hypot(x - nx, y - ny);
  }

  /** Whether the player's body overlaps the tile rectangle (the actor filled by `actorOf`). */
  private bodyOverlaps(tx: number, ty: number, w: number, h: number): boolean {
    return this.distanceToRect(this.actor.x, this.actor.y, tx, ty, w, h) < BODY_RADIUS_PX;
  }

  /** Whether the player's body – if there is one on `layer` – overlaps the tile rectangle (no actor needed). */
  private bodyOn(sim: Simulation, layer: Layer, tx: number, ty: number, w: number, h: number): boolean {
    const body = this.player.body(sim);
    if (body === undefined || body.layer !== layer || !this.player.position(sim, this.pos)) return false;
    return this.distanceToRect(this.pos.x, this.pos.y, tx, ty, w, h) < BODY_RADIUS_PX;
  }

  /** Whether part `next` in the state of `cell` (open or closed) stops a body where part `old` did not. */
  private newlyBlocks(old: PartDef, next: PartDef, cell: number): boolean {
    const open = cellOpen(cell);
    return ((open ? next.blocksOpen : next.blocks) & BODY_BLOCKERS) !== 0 && ((open ? old.blocksOpen : old.blocks) & BODY_BLOCKERS) === 0;
  }

  /** Whether an openable part stands on tile (x, y) of build layer `li`. */
  private openableAt(layer: Layer, li: number, x: number, y: number): boolean {
    const cell = this.structures.cell(layer, li, x, y);
    return cell !== 0 && this.catalog.byRuntimeId(cellPart(cell))?.openable === true;
  }

  /** Whether a finished jetty lies on tile (x, y). */
  private deckAt(layer: Layer, x: number, y: number): boolean {
    const cell = this.structures.cell(layer, FLOOR, x, y);
    return cell !== 0 && !cellBlueprint(cell) && this.catalog.byRuntimeId(cellPart(cell))?.kind === 'steg';
  }

  /**
   * Whether something stands or hangs on the floor tile (x, y) – a jetty that is to go, a trapdoor that is to open: a
   * structure, a piece of furniture or wall furniture of the grid (blueprints too), or what another system placed there
   * (a station, a torch, a camp fire: the occupancy providers).
   */
  private carriesLoad(sim: Simulation, layer: Layer, x: number, y: number): boolean {
    const store = this.structures;
    if (store.cell(layer, STRUCTURE, x, y) !== 0 || store.cell(layer, OBJECT, x, y) !== 0 || store.cell(layer, WALL_OBJECT, x, y) !== 0) return true;
    return this.occupied(sim, layer, x, y);
  }

  /** The topmost build layer with a part on the tile (only blueprints with `blueprints`), or −1. */
  private topmost(layer: Layer, tx: number, ty: number, blueprints: boolean): number {
    for (const li of REMOVE_ORDER) {
      const cell = this.structures.cell(layer, li, tx, ty);
      if (cell !== 0 && (!blueprints || cellBlueprint(cell))) return li;
    }
    return -1;
  }

  /** Whether the item in the hand is a hammer (§16.6 "mit Hammer … fertigstellen"). */
  private hammerInHand(): boolean {
    const stack = this.inventory.selected();
    if (stack === null) return false;
    const def = this.inventory.bags.catalog.find(stack.item);
    return def?.werkzeug?.art === B.blueprintTool && (stack.haltbarkeit === undefined || stack.haltbarkeit > 0);
  }

  /** What dismantling the part of `cell` gives back now. */
  private refundKind(layer: Layer, li: number, tx: number, ty: number, cell: number, tick: number): PartRefund {
    if (cellBlueprint(cell)) return 'keine';
    const placed = this.recent.get(cellKey(layer, li, tx, ty));
    return placed !== undefined && tick - placed <= FULL_REFUND_TICKS ? 'ganz' : 'anteilig';
  }

  /** Gives the refund of a dismantled part into the bags; what does not fit lands at the player's feet. */
  private giveBack(sim: Simulation, part: PartDef, refund: PartRefund, layer: Layer): void {
    let items: ItemAmount[];
    if (refund === 'ganz') items = [{ item: part.id, count: 1 }];
    else if (refund === 'anteilig') items = this.materials.refund([{ part: part.id, pieces: 1 }], B.refund.lateShare);
    else return;
    for (const a of items) {
      const result = this.inventory.give(sim, a.item, a.count);
      if (result.rest > 0) this.drops(sim, newStack(this.inventory.bags.catalog.get(a.item), result.rest), layer, this.actor.x, this.actor.y);
    }
  }

  /** Wall furniture on the tile south of a removed wall falls off: the piece lands on its tile. */
  private dropWallFurniture(sim: Simulation, layer: Layer, tx: number, ty: number, tick: number): void {
    const y = ty + 1;
    const cell = this.structures.cell(layer, WALL_OBJECT, tx, y);
    if (cell === 0) return;
    const part = this.catalog.byRuntimeId(cellPart(cell)) as PartDef;
    this.structures.set(layer, WALL_OBJECT, tx, y, 0, 0);
    this.recent.delete(cellKey(layer, WALL_OBJECT, tx, y));
    const blueprint = cellBlueprint(cell);
    if (!blueprint) this.drops(sim, newStack(this.inventory.bags.catalog.get(part.id), 1), layer, centre(tx), centre(y));
    sim.events.push('partRemoved', { part: part.id, layer, tx, ty: y, ebene: 'wandobjekt', reason: 'abgefallen', refund: blueprint ? 'keine' : 'ganz', material: part.material, tick });
    if (!blueprint) for (const l of this.partListeners) l.removed?.(sim, part, layer, tx, y, 'abgefallen');
    this.changed(sim, layer, tx, y, tx, y);
  }

  /** Writes a part's anchor cell and its covered cells over the footprint. */
  private write(layer: Layer, li: number, tx: number, ty: number, w: number, h: number, anchor: number, hp: number): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (dx === 0 && dy === 0) this.structures.set(layer, li, tx, ty, anchor, hp);
        else this.structures.set(layer, li, tx + dx, ty + dy, coveredCell(anchor, dx, dy), 0);
      }
    }
  }

  /** Clears a part's footprint. */
  private clear(layer: Layer, li: number, tx: number, ty: number, w: number, h: number): void {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.structures.set(layer, li, tx + dx, ty + dy, 0, 0);
  }

  /** Forgets placing ticks older than the full refund window. */
  private prune(tick: number): void {
    for (const [key, placed] of this.recent) if (tick - placed > FULL_REFUND_TICKS) this.recent.delete(key);
  }

  /** Reports a change of the rectangle to the collision grid (and through it the light map) and the listeners. */
  private changed(sim: Simulation, layer: Layer, tx0: number, ty0: number, tx1: number, ty1: number): void {
    // Stairs change the tile they lead onto as well; one tile around covers them.
    for (let y = ty0 - 1; y <= ty1 + 1; y++) for (let x = tx0 - 1; x <= tx1 + 1; x++) this.collision.invalidateTile(layer, x, y);
    for (const l of this.changeListeners) l(sim, layer, tx0, ty0, tx1, ty1);
  }

  /** `[layer, buildLayer, tx, ty]` of a cell key. */
  private unkey(key: number): [number, number, number, number] {
    const tx = key % TILE_SPAN;
    const rest = (key - tx) / TILE_SPAN;
    const ty = rest % TILE_SPAN;
    const lk = (rest - ty) / TILE_SPAN;
    const li = lk % BUILD_LAYER_COUNT;
    return [(lk - li) / BUILD_LAYER_COUNT - LAYER_BIAS, li, tx, ty];
  }

  private restore(data: unknown): void {
    const parsed = snapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`building snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const store = deserializeStructures(parsed.data.structures, (id) => this.catalog.find(id)?.rid);
    const recent = new Map<number, number>();
    for (const [layer, li, tx, ty, tick] of parsed.data.recent) {
      if (layer < -LAYER_BIAS || layer > 0 || li < 0 || li >= BUILD_LAYERS.length || tx < 0 || ty < 0 || tx >= TILE_SPAN || ty >= TILE_SPAN) throw new TypeError(`building snapshot invalid: placing tick of ${layer}/${li}/${tx},${ty}`);
      if (store.cell(layer as Layer, li, tx, ty) === 0) throw new TypeError(`building snapshot invalid: placing tick of an empty cell ${layer}/${li}/${tx},${ty}`);
      recent.set(cellKey(layer as Layer, li, tx, ty), tick);
    }
    const touched = [...this.structures.chunks(), ...store.chunks()];
    this.structures.replaceWith(store);
    this.recent.clear();
    for (const [k, v] of recent) this.recent.set(k, v);
    // The collision grid and the light map forget what they derived from the old buildings; rooms start afresh.
    for (const c of touched) this.collision.invalidateChunk(c.layer, c.cx, c.cy);
    for (const l of this.restoreListeners) l();
  }
}
