/**
 * Rooms system (MASTERPROMPT §16.4 "Räume"; M4-15 … M4-18): what the buildings make of the tiles around the player.
 *
 * - **Detection** (src/game/rooms/detect.ts): regions and rooms, cached per tile, dropped where the buildings
 *   (the building system's change listener) or the terrain (the collision's change reports) change.
 * - **Climate** (M4-16): an interior pulls the outside air towards 18 °C by its insulation; fires and ovens inside
 *   heat it, cold sources cool it (`addHeatSources`). The player's felt temperature gets the difference as the
 *   room value (§11.2 "+ Raumwert (§16.4)"), and under a roof no rain falls on the player (`modifierSource`).
 * - **Types** (M4-17): the first matching room type of src/content/roomTypes.ts; furniture of other systems
 *   (stations, burning lights – a lamp counts only while it burns) and animals come through `addFurniture` and
 *   `addAnimals`. Effects wired here: the bedroom makes "Ausgeruht" last ×1,5 (`sleepPlaces`: the bed reports its
 *   room), the workshop adds 15 % crafting tempo to the work in it (`craftTempoAt`: the room of the station, the
 *   crafting system's `useWorkshops`), the trophy hall adds comfort; the kitchen, store room, dining hall,
 *   greenhouse, stable and ice cellar are read by cooking, spoilage, farming and animals (M7, M8) through `roomAt`.
 * - **Comfort** (M4-18): 0–20 from unique furniture categories, light, warmth, size and decoration; it lengthens
 *   "Ausgeruht" (the bed's sleeping place), calms fear up to −1,5/s (`fearSurroundings`) and, from
 *   `BALANCE.rooms.comfort.cosyFrom`, makes the player "Behaglich" (renewed every world tick while inside).
 *
 * Global (the player's surroundings; the buildings do not change by themselves). No state of its own: everything is
 * derived from the buildings and the world, so there is no save participant. The player's room is described once per
 * tick into one kept record (`playerRoom`, no allocation per tick); `roomAt` gives a new record callers may keep.
 */
import { BALANCE } from '../../content/balance';
import { FURNITURE_CATEGORIES, type FurnitureCategory } from '../../content/buildParts';
import type { RoomTypeDef } from '../../content/roomTypes';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { PartDef } from '../../world/structures/catalog';
import { BUILD_LAYER_INDEX, cellBlueprint, cellCovered, cellDx, cellDy, cellPart, cellRot, rotatedSize } from '../../world/structures/cells';
import type { BuildingSystem } from '../building/system';
import type { ConditionsSystem } from '../conditions/system';
import type { FearSurroundingsProvider } from '../fear/system';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { SimSystem, Simulation } from '../sim';
import type { SleepPlace } from '../sleep/state';
import type { SleepPlaceProvider } from '../sleep/system';
import type { HeatSourceProvider, PlayerModifierSource } from '../survival/modifiers';
import { RoomMap, keyTx, keyTy, roomTileKey, type RoomRegion } from './detect';
import { BEDROOM_TYPE, TROPHY_HALL_TYPE, isCosy, roomComfort, roomCraftTempo, roomInsulation, roomTemperatureC, roomTypeOf, sourceRoomHeatC, type ComfortInput, type ComfortParts, type RoomContents } from './formulas';

/** Id of the rooms system. */
export const ROOMS_SYSTEM_ID = 'rooms';

const R = BALANCE.rooms;
const OBJECT = BUILD_LAYER_INDEX.objekt;
/** The condition of a cosy room (src/content/conditions.ts). */
export const COSY_CONDITION = 'behaglich';
/** The furniture category of lights (the light system reports the burning ones). */
const LIGHT_CATEGORY: FurnitureCategory = 'licht';

/** Air temperature outside at a tile [°C] (the world's temperature field). */
export type OutsideTemperature = (sim: Simulation, layer: Layer, tx: number, ty: number) => number;
/** Visits the furniture another system placed on `layer` (a station counts as `station`, a burning light as `licht`). */
export type FurnitureSource = (sim: Simulation, layer: Layer, visit: (category: FurnitureCategory, tx: number, ty: number) => void) => void;
/** Visits the animals on `layer` by their tile (M7). */
export type AnimalSource = (sim: Simulation, layer: Layer, visit: (tx: number, ty: number) => void) => void;

/** A room as the game reads it: region, climate, contents, type and comfort. */
export interface RoomInfo {
  readonly region: RoomRegion;
  /** Outside air at the room [°C]. */
  readonly outsideC: number;
  /** Insulation of walls and roof [0–1] (interiors; 0 otherwise). */
  readonly insulation: number;
  /** Heat of the sources inside [°C] (interiors). */
  readonly sourcesC: number;
  /** Room temperature [°C] (the outside air for rooms that are no interior). */
  readonly temperatureC: number;
  readonly contents: RoomContents;
  /** Type of an interior, or `null`. */
  readonly type: RoomTypeDef | null;
  /** Comfort of an interior (all zero for other rooms). */
  readonly comfort: Readonly<ComfortParts>;
}

/** Dependencies of the rooms system. */
export interface RoomsSystemDeps {
  readonly building: BuildingSystem;
  readonly collision: WorldCollision;
  readonly player: PlayerSystem;
  /** Default: the world's temperature field. */
  readonly outside?: OutsideTemperature;
}

/** What a room holds, as the rooms system fills it (every category present, 0 when none). */
interface ContentsRecord {
  furniture: Record<FurnitureCategory, number>;
  lights: number;
  temperatureC: number;
  roofs: RoomContents['roofs'];
  roofTiles: number;
  animals: number;
}

/** A `RoomInfo` as the rooms system fills it. */
interface RoomInfoRecord {
  region: RoomRegion;
  outsideC: number;
  insulation: number;
  sourcesC: number;
  temperatureC: number;
  contents: ContentsRecord;
  type: RoomTypeDef | null;
  comfort: ComfortParts;
}

/** A record for a room of `region`, to be filled by `describe`. */
function newRoomInfo(region: RoomRegion): RoomInfoRecord {
  const furniture = {} as Record<FurnitureCategory, number>;
  for (const c of FURNITURE_CATEGORIES) furniture[c] = 0;
  return {
    region,
    outsideC: 0,
    insulation: 0,
    sourcesC: 0,
    temperatureC: 0,
    contents: { furniture, lights: 0, temperatureC: 0, roofs: region.roofs, roofTiles: 0, animals: 0 },
    type: null,
    comfort: { categories: 0, light: 0, warmth: 0, size: 0, decoration: 0, trophyHall: 0, total: 0 },
  };
}

export class RoomsSystem implements SimSystem {
  readonly id = ROOMS_SYSTEM_ID;
  readonly timeScope = 'global';
  /** The regions and rooms (cached per tile). */
  readonly map: RoomMap;

  private readonly building: BuildingSystem;
  private readonly player: PlayerSystem;
  private readonly outside: OutsideTemperature;
  private readonly heatProviders: HeatSourceProvider[] = [];
  private readonly furnitureSources: FurnitureSource[] = [];
  private readonly animalSources: AnimalSource[] = [];
  private conditions: ConditionsSystem | null = null;
  private readonly pos = { x: 0, y: 0 };
  /** The player's room of the current tick (and the tick and store revision it was computed for). */
  private playerInfo: RoomInfo | null = null;
  /** The record the player's room is described into (kept between ticks). */
  private playerRecord: RoomInfoRecord | null = null;
  /** The room being described and what the visitors of the other systems add to it (no closure per room). */
  private scan: RoomInfoRecord | null = null;
  private readonly comfortInput: { -readonly [K in keyof ComfortInput]: ComfortInput[K] } = { categories: 0, lights: 0, temperatureC: 0, tiles: 0, decorations: 0, trophyHall: false };
  private readonly visitFurniture = (category: FurnitureCategory, tx: number, ty: number): void => {
    const out = this.scan;
    if (out === null || !this.inside(out.region, tx, ty)) return;
    out.contents.furniture[category]++;
    if (category === LIGHT_CATEGORY) out.contents.lights++;
  };
  private readonly visitAnimal = (tx: number, ty: number): void => {
    const out = this.scan;
    if (out !== null && this.inside(out.region, tx, ty)) out.contents.animals++;
  };
  private playerTick = -1;
  private playerRevision = -1;
  private playerKey = Number.NaN;
  /** Region id the player was in at the last update (0: none), for `playerRoomChanged`. */
  private lastRoom = -1;

  constructor(deps: RoomsSystemDeps) {
    this.building = deps.building;
    this.player = deps.player;
    this.outside = deps.outside ?? ((sim, layer, tx, ty) => sim.world.temperature.temperatureAt(layer, tx, ty));
    const collision = deps.collision;
    this.map = new RoomMap({
      store: deps.building.structures,
      catalog: deps.building.catalog,
      beginQuery: () => collision.grid.beginQuery(),
      info: (layer, tx, ty) => collision.grid.info(layer, tx, ty),
    });
    deps.building.onChange((_sim, layer, x0, y0, x1, y1) => this.map.invalidate(layer, x0, y0, x1, y1));
    deps.building.onRestore(() => this.map.clear());
    collision.addChangeListener({
      invalidateTile: (layer, tx, ty) => this.map.invalidate(layer, tx, ty, tx, ty),
      invalidateChunk: (layer, cx, cy) => this.map.invalidateChunk(layer, cx, cy),
    });
  }

  // -------------------------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------------------------

  /** Adds sources of heat or cold whose centre in a room warms (or cools) its air (fires, ovens, ice). */
  addHeatSources(provider: HeatSourceProvider): void {
    this.heatProviders.push(provider);
  }

  /** Adds furniture other systems place (stations, burning lights). */
  addFurniture(source: FurnitureSource): void {
    this.furnitureSources.push(source);
  }

  /** Adds the animals of a system (the stable, M7). */
  addAnimals(source: AnimalSource): void {
    this.animalSources.push(source);
  }

  /** Connects the conditions (the cosy room's "Behaglich"). */
  useConditions(conditions: ConditionsSystem): void {
    this.conditions = conditions;
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  /**
   * The room around tile (tx, ty) of `layer` with climate, contents, type and comfort, or `null` outdoors and on walls –
   * a new record the caller may keep.
   */
  roomAt(sim: Simulation, layer: Layer, tx: number, ty: number): RoomInfo | null {
    const region = this.map.regionAt(layer, tx, ty);
    if (region === null || !region.room) return null;
    return this.describe(sim, region, newRoomInfo(region));
  }

  /**
   * The room the player stands in, computed once per tick (and again after a change of the buildings) into one kept
   * record: read it within the tick, the next one fills it anew.
   */
  playerRoom(sim: Simulation): RoomInfo | null {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.pos)) return null;
    const tx = Math.floor(this.pos.x / TILE_PX);
    const ty = Math.floor(this.pos.y / TILE_PX);
    const key = roomTileKey(body.layer, tx, ty);
    const revision = this.building.structures.revision;
    if (this.playerTick !== sim.tick || this.playerRevision !== revision || this.playerKey !== key) {
      const region = this.map.regionAt(body.layer, tx, ty);
      if (region === null || !region.room) this.playerInfo = null;
      else {
        this.playerRecord ??= newRoomInfo(region);
        this.playerInfo = this.describe(sim, region, this.playerRecord);
      }
      this.playerTick = sim.tick;
      this.playerRevision = revision;
      this.playerKey = key;
    }
    return this.playerInfo;
  }

  /** The player is inside: in an interior or under a finished roof (§16.4 "kein Niederschlag"). */
  playerIndoors(sim: Simulation): boolean {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.pos)) return false;
    if (this.building.roofed(body.layer, Math.floor(this.pos.x / TILE_PX), Math.floor(this.pos.y / TILE_PX))) return true;
    return this.playerRoom(sim)?.region.interior === true;
  }

  /** Crafting tempo the player's room adds [fraction] (§16.4 "Werkstatt … +15 %"). */
  craftTempo(sim: Simulation): number {
    const room = this.playerRoom(sim);
    return room === null ? 0 : roomCraftTempo(room.type?.id ?? null);
  }

  /**
   * Crafting tempo the room around tile (tx, ty) of `layer` adds to the work there [fraction] (§16.4 "Werkstatt … +15 %
   * Tempo"): the room a station stands in speeds the pieces made and the batches run at it (the crafting system's
   * `useWorkshops`), wherever the player stands.
   */
  craftTempoAt(sim: Simulation, layer: Layer, tx: number, ty: number): number {
    const room = this.roomAt(sim, layer, tx, ty);
    return room === null ? 0 : roomCraftTempo(room.type?.id ?? null);
  }

  // -------------------------------------------------------------------------------------------
  // Effects on the player
  // -------------------------------------------------------------------------------------------

  /** Modifier source (`PlayerInfluences`): indoors (no rain, dries slowly) and the room value of the felt temperature. */
  modifierSource(): PlayerModifierSource {
    return (sim, _player, out) => {
      if (!this.playerIndoors(sim)) return;
      out.indoors = true;
      const room = this.playerRoom(sim);
      if (room !== null && room.region.interior) out.roomTemperatureC += room.temperatureC - room.outsideC;
    };
  }

  /** Fear surroundings (§12.3 "behaglicher Raum bis −1,5/s (skaliert mit Behaglichkeit)"). */
  fearSurroundings(): FearSurroundingsProvider {
    return (sim, _player, out) => {
      const room = this.playerRoom(sim);
      if (room !== null && room.region.interior) out.roomComfort = room.comfort.total;
    };
  }

  /**
   * Sleeping places of the placed beds (the sleep system's `addSleepPlaces`): E on a tile of a finished bed lies
   * down in it, with the comfort of its room and whether that room is a bedroom (§11.5, §16.4).
   */
  sleepPlaces(): SleepPlaceProvider {
    return (sim, layer, tx, ty) => {
      const bed = this.bedAt(layer, tx, ty);
      if (bed === null) return null;
      const room = this.roomAt(sim, layer, bed.tx, bed.ty);
      const interior = room !== null && room.region.interior;
      const place: SleepPlace = {
        kind: bed.part.sleepKind as SleepPlace['kind'],
        x: bed.x,
        y: bed.y,
        layer,
        comfort: interior ? room.comfort.total : 0,
        bedroom: interior && room.type?.id === BEDROOM_TYPE,
      };
      return place;
    };
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    const e = sim.player;
    if (e === NULL_ENTITY) {
      this.lastRoom = -1;
      return;
    }
    const room = this.playerRoom(sim);
    const id = room === null ? 0 : room.region.id;
    if (id === this.lastRoom) return;
    this.lastRoom = id;
    const body = this.player.body(sim);
    sim.events.push('playerRoomChanged', {
      layer: body?.layer ?? 0,
      room: id,
      interior: room?.region.interior === true,
      type: room?.type?.id ?? null,
      comfort: room?.comfort.total ?? 0,
      tick: sim.eventTick,
    });
  }

  worldTick(sim: Simulation): void {
    if (this.conditions === null || !this.alive(sim, sim.player)) return;
    const room = this.playerRoom(sim);
    if (room !== null && room.region.interior && isCosy(room.comfort.total)) this.conditions.apply(sim, COSY_CONDITION, R.comfort.cosySeconds);
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  private alive(sim: Simulation, e: Entity): boolean {
    return e !== NULL_ENTITY && this.player.incapacity(sim) !== 'dead';
  }

  /** Whether tile (tx, ty) belongs to `region` (its bounding box first, then the cached region of the tile). */
  private inside(region: RoomRegion, tx: number, ty: number): boolean {
    return tx >= region.x0 && tx <= region.x1 && ty >= region.y0 && ty <= region.y1 && this.map.regionAt(region.layer, tx, ty) === region;
  }

  /** Climate, contents, type and comfort of the room `region`, written into `out` (no allocation of its own). */
  private describe(sim: Simulation, region: RoomRegion, out: RoomInfoRecord): RoomInfo {
    // The outside air at the room's first tile (a room is small next to the temperature field's gradients).
    const outsideC = this.outside(sim, region.layer, keyTx(region.id), keyTy(region.id));
    const contents = out.contents;
    const furniture = contents.furniture;
    for (let i = 0; i < FURNITURE_CATEGORIES.length; i++) {
      const c = FURNITURE_CATEGORIES[i] as FurnitureCategory;
      furniture[c] = region.furniture[c] ?? 0;
    }
    out.region = region;
    contents.lights = 0;
    contents.animals = 0;
    const before = this.scan;
    this.scan = out;
    for (let i = 0; i < this.furnitureSources.length; i++) (this.furnitureSources[i] as FurnitureSource)(sim, region.layer, this.visitFurniture);
    for (let i = 0; i < this.animalSources.length; i++) (this.animalSources[i] as AnimalSource)(sim, region.layer, this.visitAnimal);
    this.scan = before;
    let insulation = 0;
    let sourcesC = 0;
    let temperatureC = outsideC;
    if (region.interior) {
      insulation = roomInsulation(region.wallFaces, region.wallInsulationSum, region.size, region.roofInsulationSum);
      for (let i = 0; i < this.heatProviders.length; i++) {
        const heat = (this.heatProviders[i] as HeatSourceProvider)(sim);
        for (let k = 0; k < heat.length; k++) {
          const s = heat[k] as (typeof heat)[number];
          if (s.layer === region.layer && this.inside(region, Math.floor(s.x / TILE_PX), Math.floor(s.y / TILE_PX))) sourcesC += sourceRoomHeatC(s.coreHeatC, region.size);
        }
      }
      temperatureC = roomTemperatureC(outsideC, insulation, sourcesC);
    }
    out.outsideC = outsideC;
    out.insulation = insulation;
    out.sourcesC = sourcesC;
    out.temperatureC = temperatureC;
    contents.temperatureC = temperatureC;
    contents.roofs = region.roofs;
    contents.roofTiles = region.roofed;
    const type = region.interior ? roomTypeOf(contents) : null;
    out.type = type;
    if (region.interior) {
      let categories = 0;
      for (let i = 0; i < FURNITURE_CATEGORIES.length; i++) if (furniture[FURNITURE_CATEGORIES[i] as FurnitureCategory] > 0) categories++;
      const input = this.comfortInput;
      input.categories = categories;
      input.lights = contents.lights;
      input.temperatureC = temperatureC;
      input.tiles = region.size;
      input.decorations = region.decorations;
      input.trophyHall = type?.id === TROPHY_HALL_TYPE;
      roomComfort(input, out.comfort);
    } else {
      const c = out.comfort;
      c.categories = 0;
      c.light = 0;
      c.warmth = 0;
      c.size = 0;
      c.decoration = 0;
      c.trophyHall = 0;
      c.total = 0;
    }
    return out;
  }

  /** The finished bed covering tile (tx, ty): its part, anchor and the centre of its footprint [px]. */
  private bedAt(layer: Layer, tx: number, ty: number): { part: PartDef; tx: number; ty: number; x: number; y: number } | null {
    const store = this.building.structures;
    const cell = store.cell(layer, OBJECT, tx, ty);
    if (cell === 0 || cellBlueprint(cell)) return null;
    const part = this.building.catalog.byRuntimeId(cellPart(cell));
    if (part === undefined || part.sleepKind === null) return null;
    const ax = cellCovered(cell) ? tx - cellDx(cell) : tx;
    const ay = cellCovered(cell) ? ty - cellDy(cell) : ty;
    const size = rotatedSize(part.w, part.h, cellRot(cell));
    return { part, tx: ax, ty: ay, x: (ax + size.w / 2) * TILE_PX, y: (ay + size.h / 2) * TILE_PX };
  }
}
