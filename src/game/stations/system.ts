/**
 * Station system (MASTERPROMPT §15.1, §15.2, §15.4, §16.1; docs/SPIEL.md §3, §8; M4-03 … M4-06).
 *
 * - **Placed stations** (`station.place`, `station.remove`): the station items T0–T1 set up on the tiles of
 *   their footprint (src/content/stations.ts `groesse`) in build reach, on free ground – no rock, wall, tree,
 *   water or other station (`addOccupancy`: placed lights, build parts), not where the player stands; mirrored with
 *   the build menu's F (`gespiegelt`). A placed station stands in the way (`collisionOverlay`, §16.1 "Objekte").
 *   Taking one down follows the build rule (§16.6 "Abbauen (100 % zurück in den ersten 30 s, danach 60 %)",
 *   `BALANCE.building.refund`): within the window after setting it up the item comes back whole, later 60 % of the
 *   materials of every stage it went through (Werkbank II: the recipes of Werkbank I and of the upgrade; rounded like
 *   build parts, `MaterialBook.refund`) – an upgraded station never comes back as an item, so Werkbank II only
 *   arises in place (`nurAufwerten`). Everything in its slots comes along. A station at which a crafting order is
 *   worked stays (`inUse`; with a station part of the build grid, `builtIn`, the public `removalProblem` that the build
 *   mode's ghost asks too). The building grid (M4-11) may own station parts instead: it reports them with
 *   `attach`/`detach` and mirrors upgrades (`addUpgradeListener`). The campfire is placed, fuelled and lit through
 *   the light system; its station side is src/game/stations/campfire.ts.
 * - **Building experience** (§23.2 Handwerk `station_gebaut`): a station set up by the player gives it once it has
 *   stood past the full refund window (`gesetzt`, saved) – or when it is upgraded or taken down after that window –,
 *   never for a placement taken back whole: setting a station up and taking it back teaches nothing, and every
 *   experience costs the 40 % of materials a late dismantling loses.
 * - **Crafting at stations** (the crafting system's hooks): `stationAtHand` finds the best placed hand
 *   station within reach that can make a recipe's station – same line, same or higher stage – with its tempo
 *   and quality points (§15.1 "Stationsstufen erhöhen Qualität, Tempo und verfügbare Rezepte"); an upgrade
 *   recipe turns the station it was made at into the next stage in place (`upgrade`, Werkbank I → II; only exactly the
 *   next stage of its line).
 * - **Processing stations** (drying rack, charcoal kiln, clay oven, smelting furnace): input, fuel and output
 *   slots (`station.put`, `station.take`, `station.takeAll`), batches run on their own (formulas.ts): stations
 *   in active chunks advance every tick with events, those in frozen chunks catch up by their timestamp when
 *   the chunk activates – silently, to exactly the state of a ticking station (§15.1). A station with a skill of its
 *   own (its `erfahrung` belongs to it: Schmieden at the smelting furnace, §23.2 "je Stufe +0,5 % Wirkung im
 *   Bereich") works at the pace of the player who loaded it last, and every processing station in a workshop 15 %
 *   faster (§16.4, the room it stands in): `station.put` takes both bonuses then (`tempoBonus`), so a frozen
 *   station catches up exactly.
 * - **Knowing stations** (§15.1 "die Station bekannt ist"): once a world tick, every station within
 *   `BALANCE.stations.discoverTiles` of the player on its layer is met (`CraftingSystem.meetStation`).
 * - **Repair** (src/game/repair): `repairStationAtHand` names a station within reach that mends an item.
 * - `station.use` opens a station for the UI (`stationOpened`).
 *
 * A dead or sleeping player works no station (every command refused with the reason). Chunk-bound (catch-up
 * registry). Save participant `stations` (version 1).
 */
import { BALANCE } from '../../content/balance';
import type { ItemDef } from '../../content/schema/item';
import type { StationDef } from '../../content/stations';
import { NULL_ENTITY } from '../../engine/ecs';
import { BLOCK_DEEP_WATER, BLOCK_HAZARD, BLOCK_OBJECT, BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL, type CollisionOverlay } from '../../world/collision/tiles';
import { WATER_DEPTH_MASK } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import { MaterialBook, type ItemAmount } from '../building/materials';
import type { CommandOfType, GameCommandType } from '../commands';
import type { CraftingSystem } from '../crafting/system';
import type { StationAtHand, SpillItems } from '../crafting/sources';
import type { RecipeBook } from '../crafting/recipes';
import { isValidRef, slotAt, withSlot } from '../inventory/bags';
import type { InventoryRejectReason } from '../inventory/events';
import { discard } from '../inventory/ops';
import type { InventorySystem } from '../inventory/system';
import { newStack, withCount, type ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { StationCatalog } from './catalog';
import type { StationArea } from './commands';
import type { StationRejectReason } from './events';
import {
  acceptsFuel,
  addToSlots,
  advanceProcessing,
  batchTicks,
  distanceToFootprint,
  footprintPx,
  footprintsOverlap,
  fuelHeatTicks,
  revalidateBatch,
  roomIn,
  slotForbidden,
  type ProcessingContext,
  type ProcessingListener,
  type ProcessRecipe,
} from './formulas';
import { copyStationsState, createStationsState, emptyProcessing, stationsSnapshotSchema, type PlacedStation, type ProcessingState, type StationStopReason, type StationsState } from './state';

/** Experience source of setting up a station (src/content/skills.ts, Handwerk). */
export const STATION_BUILT_XP_SOURCE = 'station_gebaut';
/** Id of the station system and its save participant. */
export const STATIONS_SYSTEM_ID = 'stations';
/** Data version of the `stations` participant. */
export const STATIONS_SAVE_VERSION = 1;

const S = BALANCE.stations;
const REACH_PX = S.reachTiles * TILE_PX;
const PLACE_REACH_PX = S.placeReachTiles * TILE_PX;
const DISCOVER_PX = S.discoverTiles * TILE_PX;
/** Ticks after setting a station up in which taking it down gives it back whole (§16.6, like build parts). */
const FULL_REFUND_TICKS = BALANCE.building.refund.fullSeconds * BALANCE.time.tickHz;
/** Collision categories no station can stand on. */
const PLACE_BLOCKERS = BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD | BLOCK_DEEP_WATER | BLOCK_WALL | BLOCK_VOID;
/** Radius of the player's body [px]: a station is not set up onto it (it stands in the way). */
const BODY_RADIUS_PX = BALANCE.player.movement.colliderRadiusPx;
/** Bits per axis of a tile key (tile coordinates of every world size stay below 2^16). */
const TILE_KEY_BITS = 16;
/** Tile keys: span per axis and the bias that makes layers non-negative. */
const TILE_KEY_SPAN = 1 << TILE_KEY_BITS;
const LAYER_BIAS = 3;

/** Key of tile (tx, ty) of `layer`. */
function tileKey(layer: Layer, tx: number, ty: number): number {
  return ((layer + LAYER_BIAS) * TILE_KEY_SPAN + ty) * TILE_KEY_SPAN + tx;
}

/** Whether a chunk is in the active zone (its stations tick; the others catch up). */
export interface StationEnvironment {
  active(sim: Simulation, layer: Layer, cx: number, cy: number): boolean;
}

/** The environment of the simulation's own world: the active zone. */
export function worldStationEnvironment(): StationEnvironment {
  return { active: (sim, layer, cx, cy) => sim.world.materialized && sim.world.zone.isActive(layer, cx, cy) };
}

/** Something else standing on a tile (a placed light) that keeps a station off it. */
export type StationOccupancy = (sim: Simulation, layer: Layer, tx: number, ty: number) => boolean;

/** Dependencies of the station system. */
export interface StationSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly collision: WorldCollision;
  /** Recipes, stations, visibility; the system registers its station provider and upgrader there. */
  readonly crafting: CraftingSystem;
  /** Where what does not fit into the bags goes (the drop system). */
  readonly spill: SpillItems;
  /** Default: `worldStationEnvironment()`. */
  readonly environment?: StationEnvironment;
}

type Refusal = StationRejectReason | InventoryRejectReason | null;

/** Footprint of a placed station [tiles]: its own (turned by the building grid) or its station's. */
function sizeOf(st: Pick<PlacedStation, 'groesse'>, def: StationDef): { readonly b: number; readonly t: number } {
  return st.groesse ?? def.groesse;
}

/** Centre of a footprint [px] into `out`. */
function centreOf(st: PlacedStation, def: StationDef, out: { x: number; y: number }): { x: number; y: number } {
  const size = sizeOf(st, def);
  out.x = (st.tx + size.b / 2) * TILE_PX;
  out.y = (st.ty + size.t / 2) * TILE_PX;
  return out;
}

/** Whether a placed station is a part of the build grid (taken down there, `build.remove`, not with `station.remove`). */
export type StationBuiltIn = (station: Readonly<PlacedStation>) => boolean;

/** Hears a station turn into its next stage (the building grid swaps its part). */
export type StationUpgradeListener = (sim: Simulation, station: Readonly<PlacedStation>, from: string, to: string) => void;

export class StationSystem implements SimSystem {
  readonly id = STATIONS_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  readonly stations: StationCatalog;
  readonly recipes: RecipeBook;

  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly collision: WorldCollision;
  private readonly crafting: CraftingSystem;
  private readonly spill: SpillItems;
  private readonly env: StationEnvironment;
  private stateValue: StationsState = createStationsState();
  private readonly occupancy: StationOccupancy[] = [];
  private readonly upgradeListeners: StationUpgradeListener[] = [];
  private readonly builtIn: StationBuiltIn[] = [];
  /** Every tile of every placed station's footprint → the station. */
  private readonly byTile = new Map<number, PlacedStation>();
  private readonly contexts = new Map<string, ProcessingContext>();
  /** Materials of the station items from their recipes (built on first use; the late refund). */
  private book: MaterialBook | null = null;
  private readonly at = { x: 0, y: 0 };
  private readonly centre = { x: 0, y: 0 };
  private readonly rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  // The station a listener reports for (set before each loud advance; no closure per tick).
  private loudSim: Simulation | null = null;
  private loudStation: PlacedStation | null = null;
  private readonly listener: ProcessingListener = {
    started: (recipe, ticks) => {
      const b = this.eventBase();
      if (b !== null) b.sim.events.push('stationBatchStarted', { ...b.base, recipe, ticks });
    },
    produced: (recipe, product) => {
      const b = this.eventBase();
      if (b !== null) b.sim.events.push('stationProduced', { ...b.base, recipe, item: product.item, count: product.count });
    },
    stopped: (reason) => {
      const b = this.eventBase();
      if (b !== null) b.sim.events.push('stationStopped', { ...b.base, reason });
    },
  };

  constructor(deps: StationSystemDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.collision = deps.collision;
    this.crafting = deps.crafting;
    this.spill = deps.spill;
    this.env = deps.environment ?? worldStationEnvironment();
    this.recipes = deps.crafting.recipes;
    this.stations = deps.crafting.recipes.stations;
    this.crafting.addStations((_sim, layer, x, y, radiusPx, station, exact) => this.stationAtHand(layer, x, y, radiusPx, station, exact));
    this.crafting.addUpgrader((sim, platz, to) => this.upgrade(sim, platz, to));
    this.commands = {
      'station.place': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.place(sim, cmd, tick)),
      'station.remove': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.remove(sim, cmd.station, tick)),
      'station.use': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.use(sim, cmd.station, tick)),
      'station.put': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.put(sim, cmd, tick)),
      'station.take': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.take(sim, cmd.station, cmd.bereich, cmd.index, cmd.count, tick)),
      'station.takeAll': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.takeAll(sim, cmd.station, tick)),
    };
    this.save = {
      id: STATIONS_SYSTEM_ID,
      version: STATIONS_SAVE_VERSION,
      // Saves from before stations (save version 1, M3) have none placed.
      migrations: [{ from: 0, migrate: () => copyStationsState(createStationsState()) }],
      serialize: () => copyStationsState(this.stateValue),
      deserialize: (data) => this.restore(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  /** Every placed station (read-only for callers). */
  get placed(): readonly Readonly<PlacedStation>[] {
    return this.stateValue.placed;
  }

  /** The placed station `id`, or `undefined`. */
  station(id: number): Readonly<PlacedStation> | undefined {
    return this.stateValue.placed.find((p) => p.id === id);
  }

  /** The placed station covering tile (tx, ty) of `layer`, or `undefined`. */
  stationAt(layer: Layer, tx: number, ty: number): Readonly<PlacedStation> | undefined {
    return this.byTile.get(tileKey(layer, tx, ty));
  }

  /** Footprint of a placed station [tiles]: as the building grid turned it, else its station's. */
  footprintOf(p: Readonly<PlacedStation>): { readonly b: number; readonly t: number } {
    return sizeOf(p, this.stations.get(p.station));
  }

  /**
   * The placed stations as a collision overlay of the world (§16.1 "Objekte (1×1 bis 4×4)"): every tile of a
   * footprint stands in the way like furniture. The campfire station is the light system's camp fire.
   */
  collisionOverlay(): CollisionOverlay {
    return { overlayAt: (layer, tx, ty) => (this.byTile.has(tileKey(layer, tx, ty)) ? BLOCK_OBJECT : 0) };
  }

  /**
   * The skill whose bonus speeds work at station `station` (§23.2 "je Stufe +0,5 % Wirkung im Bereich"): the skill of
   * its experience source (`erfahrung`: Schmieden at the anvil and the smelting furnace), or `null` (then Handwerk
   * speeds hand work and processing runs at the station's own pace).
   */
  skillOf(station: string): string | null {
    return this.stations.skill(station);
  }

  /** Progress of the batch of processing station `id` [0–1] (0 without a batch). */
  progress(id: number): number {
    const p = this.station(id)?.proc;
    return p === null || p === undefined || p.dauer === 0 ? 0 : p.fortschritt / p.dauer;
  }

  /** Glow left of the burning fuel piece of station `id` [0–1] (0 when none burns). */
  glow(id: number): number {
    const p = this.station(id)?.proc;
    return p === null || p === undefined || p.glutVoll === 0 ? 0 : p.glut / p.glutVoll;
  }

  /** Items that may go into the input slots of station `station` (ingredients of the recipes it runs). */
  inputItems(station: string): ReadonlySet<string> {
    const items = new Set<string>();
    for (const r of this.processingContext(station).recipes) for (const z of r.ingredients) for (const i of z.items) items.add(i);
    return items;
  }

  /**
   * The best placed hand station within `radiusPx` of (x, y) on `layer` that can make recipes of `station` – with `exact`
   * only a station `station` itself (the stage an upgrade recipe turns into the next) –, or `null`.
   */
  stationAtHand(layer: Layer, x: number, y: number, radiusPx: number, station: string, exact = false): StationAtHand | null {
    let best: PlacedStation | null = null;
    let bestDef: StationDef | null = null;
    for (const p of this.stateValue.placed) {
      if (p.layer !== layer || (exact ? p.station !== station : !this.stations.satisfies(station, p.station))) continue;
      const def = this.stations.get(p.station);
      const size = sizeOf(p, def);
      if (def.art !== 'handwerk' || distanceToFootprint(x, y, footprintPx(p, size.b, size.t, this.rect)) > radiusPx) continue;
      if (bestDef === null || def.stufe > bestDef.stufe) {
        best = p;
        bestDef = def;
      }
    }
    if (best === null) return null;
    const stage = this.stations.stage(best.station);
    return { station: best.station, platz: best.id, tx: best.tx, ty: best.ty, tempo: stage.tempo, qualitaet: stage.qualitaet };
  }

  /**
   * Why `station.remove` would leave the placed station `p` standing – apart from the player (dead, asleep, out of
   * reach) – or `null`: a station part of the build grid comes down with its part in build mode (`builtIn`; its item is
   * the grid's refund), and a station at which a crafting order is worked stays (`inUse`: an upgrade would find its
   * station gone; the order is cancelled first). Read-only – the build mode's ghost asks it before the click (M5-36).
   */
  removalProblem(p: Readonly<PlacedStation>): 'builtIn' | 'inUse' | null {
    if (this.builtIn.some((rule) => rule(p))) return 'builtIn';
    return this.crafting.orders.some((o) => o.platz === p.id) ? 'inUse' : null;
  }

  /**
   * A placed station within reach of the player that mends `def` (§13.1: its `reparatur` names the item's
   * category and a tier at least the item's), or `null`. The best stage wins.
   */
  repairStationAtHand(sim: Simulation, def: Pick<ItemDef, 'kategorie' | 'stufe'>): string | null {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.at)) return null;
    let best: StationDef | null = null;
    for (const p of this.stateValue.placed) {
      if (p.layer !== body.layer) continue;
      const d = this.stations.get(p.station);
      const r = d.reparatur;
      if (r === undefined || r.bisStufe < def.stufe || !(r.kategorien as readonly string[]).includes(def.kategorie)) continue;
      const size = sizeOf(p, d);
      if (distanceToFootprint(this.at.x, this.at.y, footprintPx(p, size.b, size.t, this.rect)) > REACH_PX) continue;
      if (best === null || d.stufe > best.stufe) best = d;
    }
    return best?.id ?? null;
  }

  // -------------------------------------------------------------------------------------------
  // API of other systems
  // -------------------------------------------------------------------------------------------

  /** Adds something that keeps stations off a tile (placed lights). */
  addOccupancy(o: StationOccupancy): void {
    this.occupancy.push(o);
  }

  /**
   * Sets up station `station` with its footprint's north-west corner on (tx, ty) of `layer` (`mirror`: mirrored)
   * without taking it from the bags (tests); returns the id, or the refusal when the ground is not free.
   * No item was spent, so it has no full refund window and gives no building experience (`station.place` adds both).
   */
  placeAt(sim: Simulation, station: string, layer: Layer, tx: number, ty: number, mirror = false): number | StationRejectReason {
    return this.setUp(sim, station, layer, tx, ty, mirror, false);
  }

  /** `placeAt`; `byPlayer`: the player spent the item – the full refund window starts now (`gesetzt`). */
  private setUp(sim: Simulation, station: string, layer: Layer, tx: number, ty: number, mirror: boolean, byPlayer: boolean): number | StationRejectReason {
    const def = this.stations.find(station);
    if (def === undefined) return 'notAStation';
    if (def.brennt === true) return 'placedElsewhere';
    const blocked = this.groundProblem(sim, def, layer, tx, ty);
    if (blocked !== null) return blocked;
    const p: PlacedStation = {
      id: this.stateValue.nextId++,
      station,
      layer,
      tx,
      ty,
      proc: def.verarbeitung === undefined ? null : emptyProcessing(def.verarbeitung.eingang, def.verarbeitung.ausgang),
      bis: sim.tick,
      ...(byPlayer ? { gesetzt: sim.tick } : {}),
      ...(mirror ? { gespiegelt: true as const } : {}),
    };
    this.insert(p);
    centreOf(p, def, this.centre);
    sim.events.push('stationPlaced', { id: p.id, station, layer, tx, ty, x: this.centre.x, y: this.centre.y, tick: sim.eventTick });
    this.crafting.meetStation(sim, station);
    return p.id;
  }

  /**
   * A station part the building grid set up (it checked the ground; §16.1 objects 1×1 – 4×4): the station starts
   * working there. `groesse` is its footprint when the grid turned it. Returns the id, or `null` when `station` is
   * no station of this system (a campfire, furniture) or one is anchored there already.
   */
  attach(sim: Simulation, station: string, layer: Layer, tx: number, ty: number, groesse?: { b: number; t: number }): number | null {
    const def = this.stations.find(station);
    if (def === undefined || def.brennt === true) return null;
    if (this.stateValue.placed.some((p) => p.layer === layer && p.tx === tx && p.ty === ty)) return null;
    const turned = groesse === undefined || (groesse.b === def.groesse.b && groesse.t === def.groesse.t) ? null : { b: groesse.b, t: groesse.t };
    const p: PlacedStation = {
      id: this.stateValue.nextId++,
      station,
      layer,
      tx,
      ty,
      ...(turned === null ? {} : { groesse: turned }),
      proc: def.verarbeitung === undefined ? null : emptyProcessing(def.verarbeitung.eingang, def.verarbeitung.ausgang),
      bis: sim.tick,
    };
    this.insert(p);
    centreOf(p, def, this.centre);
    sim.events.push('stationPlaced', { id: p.id, station, layer, tx, ty, x: this.centre.x, y: this.centre.y, tick: sim.eventTick });
    this.crafting.meetStation(sim, station);
    return p.id;
  }

  /**
   * The station part anchored at (tx, ty) left the building grid (removed, destroyed or replaced): what lies in its
   * slots goes into the bags, the rest to its place. The part item itself is the grid's. False when none stands there.
   */
  detach(sim: Simulation, layer: Layer, tx: number, ty: number): boolean {
    const p = this.stateValue.placed.find((s) => s.layer === layer && s.tx === tx && s.ty === ty);
    if (p === undefined) return false;
    this.unplace(p);
    centreOf(p, this.stations.get(p.station), this.centre);
    const x = this.centre.x;
    const y = this.centre.y;
    sim.events.push('stationRemoved', { id: p.id, station: p.station, layer, x, y, tick: sim.eventTick });
    if (p.proc !== null) for (const s of [...p.proc.eingang, p.proc.brennstoff, ...p.proc.ausgang]) if (s !== null) this.deliver(sim, s, layer, x, y);
    return true;
  }

  /** Adds a rule naming the stations that are parts of the build grid: `station.remove` refuses them (`builtIn`). */
  addBuiltIn(rule: StationBuiltIn): void {
    this.builtIn.push(rule);
  }

  /** Adds a listener for stations turned into their next stage by an upgrade recipe. */
  addUpgradeListener(listener: StationUpgradeListener): void {
    this.upgradeListeners.push(listener);
  }

  /**
   * Turns the placed station `id` into `to` (an upgrade recipe, same footprint anchor); false when it is gone or `to` is
   * not exactly the next stage of its line (nothing is upgraded twice, nothing into itself). An upgraded station stands
   * for good: its building experience is due now and it never comes back whole.
   */
  upgrade(sim: Simulation, id: number, to: string): boolean {
    const p = this.stateValue.placed.find((s) => s.id === id);
    const def = this.stations.find(to);
    if (p === undefined || def === undefined) return false;
    const now = this.stations.get(p.station);
    if (def.linie !== now.linie || def.stufe !== now.stufe + 1) return false;
    this.settle(sim, p, true);
    const from = p.station;
    p.station = to;
    if (def.verarbeitung === undefined) p.proc = null;
    else if (p.proc === null) p.proc = emptyProcessing(def.verarbeitung.eingang, def.verarbeitung.ausgang);
    centreOf(p, def, this.centre);
    sim.events.push('stationUpgraded', { id, from, to, layer: p.layer, x: this.centre.x, y: this.centre.y, tick: sim.eventTick });
    this.crafting.meetStation(sim, to);
    for (const l of this.upgradeListeners) l(sim, p, from, to);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    const to = sim.tick + 1;
    const placed = this.stateValue.placed;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i] as PlacedStation;
      if (p.gesetzt !== undefined) this.settle(sim, p, false);
      if (p.proc === null) continue;
      if (!this.env.active(sim, p.layer, p.tx >> CHUNK_SHIFT, p.ty >> CHUNK_SHIFT)) continue;
      this.advance(sim, p, to);
    }
  }

  /** World tick: the player meets the stations around. */
  worldTick(sim: Simulation): void {
    if (sim.player === NULL_ENTITY) return;
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.at)) return;
    for (const p of this.stateValue.placed) {
      if (p.layer !== body.layer || this.crafting.knowsStation(p.station)) continue;
      const size = sizeOf(p, this.stations.get(p.station));
      if (distanceToFootprint(this.at.x, this.at.y, footprintPx(p, size.b, size.t, this.rect)) <= DISCOVER_PX) this.crafting.meetStation(sim, p.station);
    }
  }

  /** A frozen chunk activates: its processing stations work from their timestamp to `toTick` (analytic, no events). */
  catchUp(chunk: { readonly layer: Layer; readonly cx: number; readonly cy: number }, _fromTick: number, toTick: number): void {
    for (const p of this.stateValue.placed) {
      if (p.proc === null || p.layer !== chunk.layer || p.tx >> CHUNK_SHIFT !== chunk.cx || p.ty >> CHUNK_SHIFT !== chunk.cy) continue;
      this.advance(null, p, toTick);
    }
  }

  /** Advances processing station `p` to tick `to`; with `sim` its events are raised. */
  private advance(sim: Simulation | null, p: PlacedStation, to: number): void {
    const n = to - p.bis;
    if (n <= 0 || p.proc === null) return;
    const ctx = this.processingContext(p.station, p.tempoBonus ?? 0);
    if (sim === null) advanceProcessing(p.proc, ctx, n);
    else {
      this.loudSim = sim;
      this.loudStation = p;
      advanceProcessing(p.proc, ctx, n, this.listener);
      this.loudSim = null;
      this.loudStation = null;
    }
    p.bis = to;
  }

  /**
   * The processing context of station `station`: the recipes it runs (its line up to its stage, book order,
   * with batch ticks and products) and the heat of its fuels; built once per skill bonus. Empty recipes for hand
   * stations. `bonus` is the skill bonus a station works with (`tempoBonus`, §23.2): batches take `1 + bonus` times
   * less time.
   */
  processingContext(station: string, bonus = 0): ProcessingContext {
    const key = bonus === 0 ? station : `${station}@${bonus}`;
    let ctx = this.contexts.get(key);
    if (ctx !== undefined) return ctx;
    const def = this.stations.get(station);
    const stage = this.stations.stage(station);
    const catalog = this.recipes.catalog;
    const recipes: ProcessRecipe[] =
      def.art !== 'verarbeitung'
        ? []
        : this.recipes
            .recipesAt(station)
            .filter((r) => this.recipes.isProcessing(r))
            .map((r) => ({
              recipe: r,
              ingredients: this.recipes.ingredients(r.id),
              ticks: batchTicks(BALANCE.crafting.durationSeconds[r.dauer], stage.tempo * (1 + bonus)),
              product: newStack(catalog.get(r.ergebnis.item), r.ergebnis.anzahl),
            }));
    const fuel = this.stations.fuel(station);
    ctx = {
      recipes,
      heat: fuel === null ? null : (item) => fuelHeatTicks(catalog.get(item).brennwert ?? 0, fuel.burnRate),
      stackSize: (item) => catalog.get(item).stapel,
    };
    this.contexts.set(key, ctx);
    return ctx;
  }

  /** The simulation and the common event fields of the station being advanced loudly, or `null`. */
  private eventBase(): { sim: Simulation; base: { id: number; station: string; layer: number; x: number; y: number; tick: number } } | null {
    const sim = this.loudSim;
    const p = this.loudStation;
    if (sim === null || p === null) return null;
    centreOf(p, this.stations.get(p.station), this.centre);
    return { sim, base: { id: p.id, station: p.station, layer: p.layer, x: this.centre.x, y: this.centre.y, tick: sim.eventTick } };
  }

  // -------------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------------

  private refuse(sim: Simulation, type: GameCommandType, tick: number, reason: Refusal): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  /** Whether the player can act (exists, lives, awake); the refusal otherwise. Fills `this.at`. */
  private able(sim: Simulation): Refusal {
    if (sim.player === NULL_ENTITY || this.player.body(sim) === undefined || !this.player.position(sim, this.at)) return 'noPlayer';
    return this.player.incapacity(sim);
  }

  /** The placed station `id` within reach of the player (call after `able`), or the refusal. */
  private reachable(sim: Simulation, id: number): PlacedStation | StationRejectReason {
    const p = this.stateValue.placed.find((s) => s.id === id);
    if (p === undefined) return 'unknownStation';
    const layer = this.player.body(sim)?.layer;
    const size = sizeOf(p, this.stations.get(p.station));
    if (p.layer !== layer || distanceToFootprint(this.at.x, this.at.y, footprintPx(p, size.b, size.t, this.rect)) > REACH_PX) return 'outOfReach';
    return p;
  }

  private place(sim: Simulation, cmd: CommandOfType<'station.place'>, tick: number): Refusal {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const bags = this.inventory.state;
    if (!isValidRef(bags, cmd.from)) return 'invalidSlot';
    const stack = slotAt(bags, cmd.from);
    if (stack === null) return 'slotEmpty';
    const def = this.stations.find(stack.item);
    if (def === undefined) return 'notAStation';
    if (def.brennt === true) return 'placedElsewhere';
    const layer = this.player.body(sim)?.layer ?? 0;
    this.rect.x0 = cmd.tx * TILE_PX;
    this.rect.y0 = cmd.ty * TILE_PX;
    this.rect.x1 = (cmd.tx + def.groesse.b) * TILE_PX;
    this.rect.y1 = (cmd.ty + def.groesse.t) * TILE_PX;
    if (distanceToFootprint(this.at.x, this.at.y, this.rect) > PLACE_REACH_PX) return 'outOfReach';
    const ground = this.groundProblem(sim, def, layer, cmd.tx, cmd.ty);
    if (ground !== null) return ground;
    // A station stands in the way: not onto the player's own body.
    if (distanceToFootprint(this.at.x, this.at.y, this.rect) < BODY_RADIUS_PX) return 'standingThere';
    const consumed = discard(bags, this.inventory.bags.catalog, cmd.from, 1);
    if (!consumed.ok) return consumed.reason;
    this.inventory.bags.replace(consumed.state);
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    // The building experience follows once the station has stood past the full refund window (`settle`).
    this.setUp(sim, def.id, layer, cmd.tx, cmd.ty, cmd.mirror === true, true);
    return null;
  }

  /**
   * The building experience of station `p` (§23.2 `station_gebaut`) once its full refund window has passed – or now
   * (`force`: an upgrade makes it stand for good); nothing for a station placed by the grid or settled already.
   */
  private settle(sim: Simulation, p: PlacedStation, force: boolean): void {
    if (p.gesetzt === undefined || (!force && sim.tick - p.gesetzt <= FULL_REFUND_TICKS)) return;
    delete p.gesetzt;
    this.crafting.award(sim, STATION_BUILT_XP_SOURCE);
  }

  /**
   * What taking station `station` down late gives back (§16.6 "danach 60 %"): the share `BALANCE.building.refund.lateShare`
   * of the materials of every stage of its line up to its own (an upgraded station was built from each), rounded like
   * build parts (`MaterialBook.refund`).
   */
  private lateRefund(station: string): ItemAmount[] {
    const def = this.stations.get(station);
    const stages = this.stations.list.filter((d) => d.linie === def.linie && d.stufe <= def.stufe).map((d) => ({ part: d.id, pieces: 1 }));
    this.book ??= new MaterialBook(
      this.recipes.list.map((r) => ({
        id: r.id,
        product: r.ergebnis.item,
        pieces: r.ergebnis.anzahl,
        // A group ingredient ("any wood") comes back as its first member, like the materials of build parts.
        inputs: this.recipes.ingredients(r.id).map((z) => ({ item: z.items[0] as string, count: z.anzahl })),
      })),
    );
    return this.book.refund(stages, BALANCE.building.refund.lateShare);
  }

  /** Why the footprint of `def` at (tx, ty) cannot take a station, or `null`. */
  private groundProblem(sim: Simulation, def: StationDef, layer: Layer, tx: number, ty: number): StationRejectReason | null {
    const w = def.groesse.b;
    const d = def.groesse.t;
    for (const p of this.stateValue.placed) {
      if (p.layer !== layer) continue;
      const o = sizeOf(p, this.stations.get(p.station));
      if (footprintsOverlap(tx, ty, w, d, p.tx, p.ty, o.b, o.t)) return 'tileTaken';
    }
    this.collision.ensureTiles(layer, tx, ty, tx + w - 1, ty + d - 1);
    for (let y = ty; y < ty + d; y++) {
      for (let x = tx; x < tx + w; x++) {
        if ((this.collision.grid.tileInfo(layer, x, y) & PLACE_BLOCKERS) !== 0) return 'tileBlocked';
        const chunk = this.collision.chunks.get(layer, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
        if (chunk === undefined || ((chunk.water[((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK)] as number) & WATER_DEPTH_MASK) !== 0) return 'tileBlocked';
        if (this.occupancy.some((o) => o(sim, layer, x, y))) return 'tileTaken';
      }
    }
    return null;
  }

  private remove(sim: Simulation, id: number, tick: number): Refusal {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const p = this.reachable(sim, id);
    if (typeof p === 'string') return p;
    const kept = this.removalProblem(p);
    if (kept !== null) return kept;
    const def = this.stations.get(p.station);
    // Past the window its building experience is due (a station that stood); within it the item comes back whole.
    this.settle(sim, p, false);
    const whole = p.gesetzt !== undefined && tick - p.gesetzt <= FULL_REFUND_TICKS;
    this.unplace(p);
    centreOf(p, def, this.centre);
    const x = this.centre.x;
    const y = this.centre.y;
    sim.events.push('stationRemoved', { id, station: p.station, layer: p.layer, x, y, tick });
    const catalog = this.recipes.catalog;
    const give: ItemStack[] = whole ? [newStack(catalog.get(p.station), 1)] : this.lateRefund(p.station).map((a) => newStack(catalog.get(a.item), a.count));
    if (p.proc !== null) {
      for (const s of [...p.proc.eingang, p.proc.brennstoff, ...p.proc.ausgang]) if (s !== null) give.push(s);
    }
    for (const s of give) this.deliver(sim, s, p.layer, x, y);
    return null;
  }

  private use(sim: Simulation, id: number, tick: number): Refusal {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const p = this.reachable(sim, id);
    if (typeof p === 'string') return p;
    sim.events.push('stationOpened', { id, station: p.station, tick });
    return null;
  }

  private put(sim: Simulation, cmd: CommandOfType<'station.put'>, tick: number): Refusal {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const p = this.reachable(sim, cmd.station);
    if (typeof p === 'string') return p;
    const proc = p.proc;
    if (proc === null) return 'noSlots';
    const bags = this.inventory.state;
    if (!isValidRef(bags, cmd.from)) return 'invalidSlot';
    const stack = slotAt(bags, cmd.from);
    if (stack === null) return 'slotEmpty';
    const catalog = this.recipes.catalog;
    const def = catalog.get(stack.item);
    if (slotForbidden(def)) return 'wrongItem';
    const want = Math.min(cmd.count ?? stack.count, stack.count);
    let moved: number;
    if (cmd.bereich === 'brennstoff') {
      const rules = this.stations.fuel(p.station);
      if (rules === null) return 'noSlots';
      if (def.brennwert === undefined) return 'notFuel';
      if (!acceptsFuel(rules, def.brennwert)) return 'weakFuel';
      const slot = [proc.brennstoff];
      moved = Math.min(want, roomIn(slot, stack, def.stapel));
      if (moved < 1) return 'stationFull';
      addToSlots(slot, withCount(stack, moved), def.stapel);
      proc.brennstoff = slot[0] ?? null;
    } else {
      if (!this.inputItems(p.station).has(stack.item)) return 'wrongItem';
      moved = Math.min(want, roomIn(proc.eingang, stack, def.stapel));
      if (moved < 1) return 'stationFull';
      addToSlots(proc.eingang, withCount(stack, moved), def.stapel);
    }
    const next = moved === stack.count ? null : withCount(stack, stack.count - moved);
    this.inventory.bags.replace(withSlot(bags, cmd.from, next));
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    // The station's own skill (Schmieden at the smelting furnace) and the workshop it stands in (§16.4 "+15 %"): its next
    // batches run at the pace of this loading, so a frozen station catches up exactly.
    const skill = this.stations.skill(p.station);
    const bonus = (skill === null ? 0 : this.crafting.skillBonus(skill)) + this.crafting.workshopTempoAt(sim, p.layer, p.tx, p.ty);
    if (bonus > 0) p.tempoBonus = bonus;
    else delete p.tempoBonus;
    this.loaded(sim, p, 'stationLoaded', cmd.bereich, stack.item, moved, tick);
    return null;
  }

  private take(sim: Simulation, id: number, bereich: StationArea, index: number, count: number | undefined, tick: number): Refusal {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const p = this.reachable(sim, id);
    if (typeof p === 'string') return p;
    const proc = p.proc;
    if (proc === null) return 'noSlots';
    const slots = bereich === 'brennstoff' ? null : proc[bereich];
    if (slots === null ? index !== 0 : index >= slots.length) return 'invalidSlot';
    const stack = slots === null ? proc.brennstoff : (slots[index] ?? null);
    if (stack === null) return 'slotEmpty';
    const want = Math.min(count ?? stack.count, stack.count);
    const { added } = this.inventory.giveStack(sim, withCount(stack, want));
    if (added < 1) return 'bagsFull';
    const rest = stack.count > added ? withCount(stack, stack.count - added) : null;
    if (slots === null) proc.brennstoff = rest;
    else slots[index] = rest;
    if (bereich === 'eingang') revalidateBatch(proc, this.processingContext(p.station, p.tempoBonus ?? 0));
    if (bereich === 'ausgang') this.rewardProducts(sim, p, added);
    this.loaded(sim, p, 'stationTaken', bereich, stack.item, added, tick);
    return null;
  }

  private takeAll(sim: Simulation, id: number, tick: number): Refusal {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const p = this.reachable(sim, id);
    if (typeof p === 'string') return p;
    const proc = p.proc;
    if (proc === null) return 'noSlots';
    if (proc.ausgang.every((s) => s === null)) return 'slotEmpty';
    let any = false;
    for (let i = 0; i < proc.ausgang.length; i++) {
      const stack = proc.ausgang[i] ?? null;
      if (stack === null) continue;
      const { added } = this.inventory.giveStack(sim, stack);
      if (added < 1) continue;
      any = true;
      proc.ausgang[i] = stack.count > added ? withCount(stack, stack.count - added) : null;
      this.rewardProducts(sim, p, added);
      this.loaded(sim, p, 'stationTaken', 'ausgang', stack.item, added, tick);
    }
    return any ? null : 'bagsFull';
  }

  /** The experience of taking `count` products out of station `p` (its `erfahrung`, e.g. smelting). */
  private rewardProducts(sim: Simulation, p: PlacedStation, count: number): void {
    const source = this.stations.get(p.station).erfahrung;
    if (source !== undefined) this.crafting.award(sim, source, count);
  }

  private loaded(sim: Simulation, p: PlacedStation, type: 'stationLoaded' | 'stationTaken', bereich: StationArea, item: string, count: number, tick: number): void {
    centreOf(p, this.stations.get(p.station), this.centre);
    sim.events.push(type, { id: p.id, station: p.station, bereich, item, count, layer: p.layer, x: this.centre.x, y: this.centre.y, tick });
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  /** Adds a placed station: its footprint enters the tile index and collides from now on. */
  private insert(p: PlacedStation): void {
    this.stateValue.placed.push(p);
    this.indexTiles(p, true);
  }

  /** Takes a placed station off its tiles. */
  private unplace(p: PlacedStation): void {
    this.stateValue.placed.splice(this.stateValue.placed.indexOf(p), 1);
    this.indexTiles(p, false);
  }

  /** Enters (`on`) or clears the footprint of `p` in the tile index and reports the tiles to the collision grid. */
  private indexTiles(p: PlacedStation, on: boolean): void {
    const size = sizeOf(p, this.stations.get(p.station));
    for (let dy = 0; dy < size.t; dy++) {
      for (let dx = 0; dx < size.b; dx++) {
        const key = tileKey(p.layer, p.tx + dx, p.ty + dy);
        if (on) this.byTile.set(key, p);
        else if (this.byTile.get(key) === p) this.byTile.delete(key);
        this.collision.invalidateTile(p.layer, p.tx + dx, p.ty + dy);
      }
    }
  }

  /** Puts `stack` into the bags; what does not fit lands at the station. */
  private deliver(sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number): void {
    const { rest } = this.inventory.giveStack(sim, stack);
    if (rest > 0) this.spill(sim, withCount(stack, rest), layer, x, y);
  }

  private restore(data: unknown): void {
    const parsed = stationsSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`stations snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const catalog = this.recipes.catalog;
    const placed: PlacedStation[] = parsed.data.placed.map((raw) => {
      const def = this.stations.find(raw.station);
      if (def === undefined) throw new TypeError(`stations snapshot invalid: station ${raw.id} is the unknown station "${raw.station}"`);
      const slots = def.verarbeitung;
      if ((slots === undefined) !== (raw.proc === null)) throw new TypeError(`stations snapshot invalid: station ${raw.id} ("${raw.station}") ${slots === undefined ? 'has no slots' : 'needs its slots'}`);
      let proc: ProcessingState | null = null;
      if (raw.proc !== null && slots !== undefined) {
        if (raw.proc.eingang.length !== slots.eingang || raw.proc.ausgang.length !== slots.ausgang) throw new TypeError(`stations snapshot invalid: station ${raw.id} has the wrong number of slots`);
        if (raw.proc.brennstoff !== null && !slots.brennstoff) throw new TypeError(`stations snapshot invalid: station ${raw.id} has no fuel slot`);
        for (const s of [...raw.proc.eingang, raw.proc.brennstoff, ...raw.proc.ausgang]) {
          if (s !== null && !catalog.has(s.item)) throw new TypeError(`stations snapshot invalid: station ${raw.id} holds the unknown item "${s.item}"`);
        }
        if (raw.proc.rezept !== null && !this.processingContext(raw.station).recipes.some((r) => r.recipe.id === raw.proc?.rezept)) {
          throw new TypeError(`stations snapshot invalid: station ${raw.id} works on "${raw.proc.rezept}", which it cannot make`);
        }
        proc = {
          eingang: raw.proc.eingang.map((s) => (s === null ? null : { ...s })),
          brennstoff: raw.proc.brennstoff === null ? null : { ...raw.proc.brennstoff },
          ausgang: raw.proc.ausgang.map((s) => (s === null ? null : { ...s })),
          glut: raw.proc.glut,
          glutVoll: raw.proc.glutVoll,
          rezept: raw.proc.rezept,
          fortschritt: raw.proc.fortschritt,
          dauer: raw.proc.dauer,
          laeuft: raw.proc.laeuft,
          halt: raw.proc.halt as StationStopReason | null,
        };
      }
      return {
        id: raw.id,
        station: raw.station,
        layer: raw.layer as Layer,
        tx: raw.tx,
        ty: raw.ty,
        ...(raw.groesse === undefined ? {} : { groesse: { ...raw.groesse } }),
        ...(raw.tempoBonus === undefined ? {} : { tempoBonus: raw.tempoBonus }),
        ...(raw.gesetzt === undefined ? {} : { gesetzt: raw.gesetzt }),
        ...(raw.gespiegelt === true ? { gespiegelt: true as const } : {}),
        proc,
        bis: raw.bis,
      };
    });
    const seen = new Set<number>();
    for (const p of placed) {
      const size = sizeOf(p, this.stations.get(p.station));
      for (let dy = 0; dy < size.t; dy++) {
        for (let dx = 0; dx < size.b; dx++) {
          const key = tileKey(p.layer, p.tx + dx, p.ty + dy);
          if (seen.has(key)) throw new TypeError(`stations snapshot invalid: two stations on tile ${p.layer}:${p.tx + dx}:${p.ty + dy}`);
          seen.add(key);
        }
      }
    }
    for (const p of this.stateValue.placed) this.indexTiles(p, false);
    this.byTile.clear();
    this.stateValue = { placed, nextId: parsed.data.nextId };
    for (const p of placed) this.indexTiles(p, true);
  }
}
