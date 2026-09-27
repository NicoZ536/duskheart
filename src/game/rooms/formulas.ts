/**
 * Rooms as pure functions (MASTERPROMPT §16.4; M4-15 … M4-18; tests/unit/game/raumklima.test.ts,
 * raumtypen.test.ts, behaglichkeit.test.ts).
 *
 * - **Insulation** of a room [0–1]: the walls' share (`BALANCE.rooms.climate.wallWeight`) × the mean insulation of
 *   its boundary faces (each wall, door, gate or window face towards the room once; rock and cliff faces insulate
 *   like earth) + the roof's share × the mean roof insulation over its tiles (an open tile keeps nothing).
 * - **Climate** (§16.4 "Temperatur nach Dämmwert der Wände Richtung 18 °C gedämpft"): T = T_out + (18 − T_out) ×
 *   insulation, plus the heat of the sources inside – each its core heat × `heatShare`, in a room larger than
 *   `referenceTiles` by `referenceTiles / size` (a fire heats a hut, not a hall); cold sources count negative.
 * - **Type** (§16.4, src/content/roomTypes.ts): the first type by rank whose conditions the contents meet.
 * - **Comfort 0–20** (§16.4 "aus einzigartigen Möbelkategorien, Licht, Wärme, Raumgröße und Deko"): +1 per unique
 *   furniture category (at most 8), light (+2 for one, +3 for more), warmth (+3 in the snug band 16–24 °C, +1 in
 *   12–28 °C), size (+1 from 6 tiles, +2 from 12, +3 from 24), decoration (+1 each, at most 4), a trophy hall +3.
 */
import { BALANCE } from '../../content/balance';
import type { BuildMaterial } from '../../content/balance/building';
import type { FurnitureCategory } from '../../content/buildParts';
import { ROOM_TYPES, type RoomTypeDef } from '../../content/roomTypes';

const R = BALANCE.rooms;
const C = R.comfort;

/** The id of the trophy hall (its comfort, §16.4). */
export const TROPHY_HALL_TYPE = 'trophaeenhalle';
/** The id of the bedroom (Ausgeruht ×1,5, §16.4). */
export const BEDROOM_TYPE = 'schlafraum';
/** The id of the workshop (+15 % crafting tempo, §16.4). */
export const WORKSHOP_TYPE = 'werkstatt';

/** Insulation of a room from its boundary faces and roof tiles. */
export function roomInsulation(wallFaces: number, wallInsulationSum: number, tiles: number, roofInsulationSum: number): number {
  const walls = wallFaces > 0 ? wallInsulationSum / wallFaces : 0;
  const roof = tiles > 0 ? roofInsulationSum / tiles : 0;
  return R.climate.wallWeight * walls + (1 - R.climate.wallWeight) * roof;
}

/** Warmth a source of core heat `coreHeatC` gives the air of a room of `tiles` tiles [°C] (negative for cold). */
export function sourceRoomHeatC(coreHeatC: number, tiles: number): number {
  const share = tiles <= R.climate.referenceTiles ? 1 : R.climate.referenceTiles / tiles;
  return coreHeatC * R.climate.heatShare * share;
}

/** Temperature inside a room [°C]: the outside air pulled towards 18 °C by the insulation, plus the sources. */
export function roomTemperatureC(outsideC: number, insulation: number, sourcesC: number): number {
  const k = insulation <= 0 ? 0 : insulation >= 1 ? 1 : insulation;
  return outsideC + (R.climate.targetC - outsideC) * k + sourcesC;
}

/** What a room holds, for its type and comfort. */
export interface RoomContents {
  /** Pieces per furniture category (own furniture and wall furniture, stations and lights of other systems). */
  readonly furniture: Readonly<Partial<Record<FurnitureCategory, number>>>;
  /** Lights: lamps plus burning torches and fires in the room. */
  readonly lights: number;
  /** Room temperature [°C]. */
  readonly temperatureC: number;
  /** Roof tiles per material. */
  readonly roofs: Readonly<Partial<Record<BuildMaterial, number>>>;
  /** Roof tiles in all. */
  readonly roofTiles: number;
  /** Animals in the room. */
  readonly animals: number;
}

/** The furniture conditions of each room type as pairs, built once per type (the player's room is typed every tick). */
const FURNITURE_RULES = new WeakMap<RoomTypeDef, ReadonlyArray<readonly [FurnitureCategory, number]>>();

function furnitureRules(t: RoomTypeDef): ReadonlyArray<readonly [FurnitureCategory, number]> {
  let rules = FURNITURE_RULES.get(t);
  if (rules === undefined) {
    rules = t.moebel === undefined ? [] : (Object.entries(t.moebel) as Array<[FurnitureCategory, number]>);
    FURNITURE_RULES.set(t, rules);
  }
  return rules;
}

/** Whether `contents` meet the conditions of room type `t`. */
export function meetsRoomType(t: RoomTypeDef, contents: RoomContents): boolean {
  const rules = furnitureRules(t);
  for (let i = 0; i < rules.length; i++) {
    const [category, min] = rules[i] as readonly [FurnitureCategory, number];
    if ((contents.furniture[category] ?? 0) < min) return false;
  }
  if (t.licht !== undefined && contents.lights < t.licht) return false;
  if (t.unterC !== undefined && !(contents.temperatureC < t.unterC)) return false;
  if (t.dach !== undefined) {
    const share = contents.roofTiles > 0 ? (contents.roofs[t.dach.material] ?? 0) / contents.roofTiles : 0;
    if (share < t.dach.anteil) return false;
  }
  return t.tiere === undefined || contents.animals >= t.tiere;
}

/** The type of a room: the first type by rank whose conditions it meets, or `null`. */
export function roomTypeOf(contents: RoomContents, types: readonly RoomTypeDef[] = ROOM_TYPES): RoomTypeDef | null {
  for (const t of types) if (meetsRoomType(t, contents)) return t;
  return null;
}

/** What comfort is made of. */
export interface ComfortInput {
  /** Unique furniture categories in the room. */
  readonly categories: number;
  readonly lights: number;
  readonly temperatureC: number;
  /** Room size [tiles]. */
  readonly tiles: number;
  /** Pieces of decoration. */
  readonly decorations: number;
  /** The room is a trophy hall. */
  readonly trophyHall: boolean;
}

/** The parts of a room's comfort [points]. */
export interface ComfortParts {
  categories: number;
  light: number;
  warmth: number;
  size: number;
  decoration: number;
  trophyHall: number;
  /** Sum, clamped to 0–20. */
  total: number;
}

/** Comfort of a room and its parts (see module comment). */
export function roomComfort(input: ComfortInput, out: ComfortParts = { categories: 0, light: 0, warmth: 0, size: 0, decoration: 0, trophyHall: 0, total: 0 }): ComfortParts {
  out.categories = Math.min(C.maxCategories, input.categories) * C.perCategory;
  const lightSteps = C.light;
  out.light = input.lights <= 0 ? 0 : (lightSteps[Math.min(input.lights, lightSteps.length) - 1] as number);
  const w = C.warmth;
  const t = input.temperatureC;
  out.warmth = t >= w.snugLowC && t <= w.snugHighC ? w.snug : t >= w.tolerableLowC && t <= w.tolerableHighC ? w.tolerable : 0;
  let size = 0;
  for (const step of C.size) if (input.tiles >= step.tiles) size = step.points;
  out.size = size;
  out.decoration = Math.min(C.maxDecoration, input.decorations * C.perDecoration);
  out.trophyHall = input.trophyHall ? R.effects.trophyHallComfort : 0;
  const sum = out.categories + out.light + out.warmth + out.size + out.decoration + out.trophyHall;
  out.total = sum < 0 ? 0 : sum > C.max ? C.max : sum;
  return out;
}

/** Whether a room of comfort `comfort` makes the player "Behaglich" (§16.4, src/content/conditions.ts). */
export function isCosy(comfort: number): boolean {
  return comfort >= C.cosyFrom;
}

/** Crafting tempo a room of type `type` adds [fraction] (§16.4 "Werkstatt … +15 % Tempo"). */
export function roomCraftTempo(type: string | null): number {
  return type === WORKSHOP_TYPE ? R.effects.workshopTempo : 0;
}
