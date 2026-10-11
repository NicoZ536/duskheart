/**
 * The kitchen as crafting sees it (MASTERPROMPT §16.4 "Küche (Kessel + Vorrat + Tisch): +20 % Kochtempo, +10 %
 * Mahlzeitwirkung", §18 "Kessel (Suppen, Eintopf)"; docs/SPIEL.md §21 "Koch-Stationen"; M7-25, M7-26):
 * - `kitchenFireCheck`: the fire a station with `feuer` cooks over (the cauldron) – a burning camp fire or fireplace (a placed
 *   light with a lit fire, the light system) or a burning hearth fire within one tile of the station's footprint
 *   (`CraftingSystem.useFire`).
 * - `kitchenProductMark`: food and remedies made at a cooking station (`BALANCE.meals.cookingStations`) standing in a kitchen
 *   carry `daten.kueche = true` – the meals system gives them 10 % more nutrition, comfort and condition time
 *   (`CraftingSystem.useProductMark`; the station system marks the batches taken from a station the same way).
 * - The rooms as the kitchen reads them (`kitchenRoomTypeAt`, `diningHallCheck`, §16.4): the room type of a tile, whether the
 *   player eats in a dining hall; `cookingPlaceFurniture` reports the cauldron and the oven as the kitchen's cooking place
 *   (furniture `kochstelle`, `RoomsSystem.addFurniture`).
 * Pure adapters over read-only queries: no state, nothing to save.
 */
import { BALANCE } from '../../content/balance';
import type { Layer } from '../../world/model/coords';
import type { FurnitureCategory } from '../../content/buildParts';
import type { FireCheck, ProductMark } from '../crafting/sources';
import type { ItemCatalog } from '../items/catalog';
import type { ItemStack } from '../items/stack';
import { KITCHEN_TYPE } from '../rooms/formulas';
import type { Simulation } from '../sim';
import { KITCHEN_DATA_KEY } from './formulas';
import type { DiningHallCheck } from './system';

/** The dining hall (§16.4 "Speisesaal … Essen senkt Furcht zusätzlich"). */
export const DINING_HALL_TYPE = 'speisesaal';

/** A room as the kitchen reads it (`RoomInfo` of the rooms system). */
export interface KitchenRoom {
  readonly type: { readonly id: string } | null;
  readonly region: { readonly interior: boolean };
}

/** The rooms system as the kitchen reads it. */
export interface KitchenRooms {
  roomAt(sim: Simulation, layer: Layer, tx: number, ty: number): KitchenRoom | null;
  playerRoom(sim: Simulation): KitchenRoom | null;
}

/** The fires as the kitchen reads them: a placed light's fire on a tile, a hearth covering a tile and whether it burns. */
export interface KitchenFires {
  /** Whether a placed light with a burning fire (camp fire, fireplace) covers tile (tx, ty) of `layer`. */
  fireLit(layer: Layer, tx: number, ty: number): boolean;
  /** Whether a burning hearth fire covers tile (tx, ty) of `layer`. */
  hearthLit(sim: Simulation, layer: Layer, tx: number, ty: number): boolean;
}

/**
 * Whether a fire burns within one tile of the footprint `w` × `h` with its top-left tile (tx, ty) (`w`/`h` 0: around the tile
 * itself): every tile of the ring and the footprint is asked once, north to south, west to east.
 */
export function kitchenFireCheck(fires: KitchenFires): FireCheck {
  return (sim, layer, tx, ty, w, h) => {
    const x1 = tx + Math.max(1, w);
    const y1 = ty + Math.max(1, h);
    for (let y = ty - 1; y <= y1; y++) {
      for (let x = tx - 1; x <= x1; x++) {
        if (fires.fireLit(layer, x, y) || fires.hearthLit(sim, layer, x, y)) return true;
      }
    }
    return false;
  };
}

/** The room type of tile (tx, ty) of `layer` (`null` outside a room). */
export type RoomTypeAt = (sim: Simulation, layer: Layer, tx: number, ty: number) => string | null;

/** The room type of a tile from the rooms system. */
export function kitchenRoomTypeAt(rooms: KitchenRooms): RoomTypeAt {
  return (sim, layer, tx, ty) => rooms.roomAt(sim, layer, tx, ty)?.type?.id ?? null;
}

/** Whether the player's room is a dining hall (the meals system's `diningHall`). */
export function diningHallCheck(rooms: KitchenRooms): DiningHallCheck {
  return (sim) => rooms.playerRoom(sim)?.type?.id === DINING_HALL_TYPE;
}

/** A placed station as the cooking place reads it. */
export interface CookingPlaceStations {
  readonly placed: readonly { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly station: string }[];
}

/** The furniture category of a cooking place. */
const KOCHSTELLE: FurnitureCategory = 'kochstelle';

/**
 * The cauldron and the oven as a kitchen's cooking place (`BALANCE.meals.cookingPlaces`, furniture `kochstelle`): a furniture
 * source of the rooms system on the stations' anchor tiles.
 */
export function cookingPlaceFurniture(stations: CookingPlaceStations): (sim: Simulation, layer: Layer, visit: (category: FurnitureCategory, tx: number, ty: number) => void) => void {
  const places: readonly string[] = BALANCE.meals.cookingPlaces;
  return (_sim, layer, visit) => {
    const placed = stations.placed;
    for (let i = 0; i < placed.length; i++) {
      const st = placed[i] as CookingPlaceStations['placed'][number];
      if (st.layer === layer && places.includes(st.station)) visit(KOCHSTELLE, st.tx, st.ty);
    }
  };
}

/** Whether `stack` comes from a kitchen (`daten.kueche`). */
function marked(stack: ItemStack): boolean {
  return stack.daten?.[KITCHEN_DATA_KEY] === true;
}

/**
 * The mark of a kitchen's food: a stack of something eaten or drunk (`essbar` or `trank`) made at a cooking station whose tile
 * lies in a kitchen carries `daten.kueche = true`; anything else stays as it is.
 */
export function kitchenProductMark(catalog: ItemCatalog, roomTypeAt: RoomTypeAt): ProductMark {
  const cooking = BALANCE.meals.cookingStations;
  return (sim, stack, station, layer, tx, ty) => {
    if (marked(stack) || !cooking.includes(station)) return stack;
    const def = catalog.get(stack.item);
    if (def.essbar === undefined && def.trank === undefined) return stack;
    if (roomTypeAt(sim, layer, tx, ty) !== KITCHEN_TYPE) return stack;
    return { ...stack, daten: { ...stack.daten, [KITCHEN_DATA_KEY]: true } };
  };
}
