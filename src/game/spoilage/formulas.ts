/**
 * The rules of spoilage as pure functions (MASTERPROMPT §18 "Verderb: Frische 100 → 0 über die Haltbarkeit … Faktoren …
 * Stufen"; docs/SPIEL.md §21 "Verderb"; M7-29; tests/unit/game/verderb.test.ts).
 *
 * - **Loss per game hour** of a stack: `100 × factor / (shelf days × 24)` freshness points, rounded up to the grid 2^-16 – a
 *   dyadic number; every freshness lies on the same grid, so n single hours and one step of n hours subtract the same bits
 *   (|freshness| ≤ 100, at most 23 significant bits, every partial sum exact in float64). Rounded up, a stack is spoiled
 *   exactly when its shelf life has run out (bread after 120 hours, not one hour later), never earlier.
 * - **Factor** in fixed order (`BALANCE.spoilage`): container (bags, chest 1, pantry barrel 0,75) × room (store room 0,9, ice
 *   cellar 0,2) × surroundings (winter outdoors 0,5, a hot biome 1,5).
 * - **Hours** are counted from the world's start (tick 0 = 06:00 of day 1): hour `h` covers the ticks `[h × T, (h + 1) × T)`
 *   with `T` ticks per game hour; its season is the season of the day it lies in.
 */
import { BALANCE } from '../../content/balance';
import type { SeasonId } from '../../content/balance';
import { HOURS_PER_DAY } from '../../engine/time';
import { dayOfMinute, WORLD_START_MINUTE, HOUR_MINUTES } from '../../world/climate/gameTime';

const S = BALANCE.spoilage;
/** Hours per day [h]. */
const DAY_HOURS = HOURS_PER_DAY;
/** The winter season (the factor "Winter im Freien"). */
const WINTER: SeasonId = 'winter';
const HOT: ReadonlySet<string> = new Set(S.hotBiomes);

/** Cells of the freshness grid per point (2^`gridBits`). */
const GRID = 2 ** S.gridBits;

/** Freshness points one stack of an item with shelf life `days` [game days] loses in one hour at `factor` [points per hour, on the grid, rounded up]. */
export function lossPerHour(days: number, factor: number): number {
  return Math.ceil(((100 * factor) / (days * DAY_HOURS)) * GRID) / GRID;
}

/** Whether `biome` is a hot biome (§18 "heißes Biom ×1,5"). */
export function isHotBiome(biome: string | null): boolean {
  return biome !== null && HOT.has(biome);
}

/** Factor of a container kind [×] (`BALANCE.spoilage.containers`). */
export function containerFactor(kind: keyof typeof S.containers): number {
  return S.containers[kind];
}

/** Factor of a room type [×] (`BALANCE.spoilage.rooms`; 1 without a room or for other types). */
export function roomFactor(roomType: string | null): number {
  return roomType !== null && Object.hasOwn(S.rooms, roomType) ? (S.rooms[roomType] as number) : 1;
}

/** Factor of the surroundings [×]: winter outdoors 0,5 × hot biome 1,5. */
export function surroundingsFactor(winterOutdoors: boolean, hot: boolean): number {
  return (winterOutdoors ? S.winterOutdoors : 1) * (hot ? S.hotBiome : 1);
}

/**
 * Where a stack lies, as spoilage reads it: `base` = container factor × room factor (computed in the active zone, kept while
 * frozen), whether it lies in a hot biome and whether outdoors (winter's factor applies only there).
 */
export interface SpoilagePlace {
  base: number;
  hot: boolean;
  outdoors: boolean;
}

/** The factor of `place` in season `season` [×] (container × room × surroundings, in this order). */
export function placeFactor(place: Readonly<SpoilagePlace>, season: SeasonId): number {
  return place.base * surroundingsFactor(season === WINTER && place.outdoors, place.hot);
}

/** The game hour of tick `tick` [hours since 06:00 of day 1]. */
export function hourOfTick(tick: number, ticksPerHour: number): number {
  return Math.floor(tick / ticksPerHour);
}

/** The first tick of game hour `hour`. */
export function hourStartTick(hour: number, ticksPerHour: number): number {
  return hour * ticksPerHour;
}

/** The day number (from 1, changing at midnight) of game hour `hour`. */
export function dayOfHour(hour: number): number {
  return dayOfMinute(WORLD_START_MINUTE + hour * HOUR_MINUTES);
}

/** The first game hour of day `day + 1` (its midnight): day `d` covers the minutes `[(d − 1) × 1440, d × 1440)`. */
export function nextDayHour(day: number): number {
  return (day * DAY_HOURS * HOUR_MINUTES - WORLD_START_MINUTE) / HOUR_MINUTES;
}

/** A season of a day (the calendar). */
export interface SeasonSource {
  seasonOfDay(day: number): SeasonId;
}

/**
 * Freshness points a stack with shelf life `days` loses in the hours `[from, to)` at `place`: the hours split by the season
 * of their day (winter outdoors spoils slower), each part `n × loss` (exact on the grid, docs/SPIEL.md §21).
 */
export function lossOver(days: number, place: Readonly<SpoilagePlace>, from: number, to: number, seasons: SeasonSource): number {
  let total = 0;
  let h = from;
  while (h < to) {
    const day = dayOfHour(h);
    // The hours of this day within [h, to): up to the first hour of the next day (its midnight).
    const next = nextDayHour(day);
    const end = next < to ? next : to;
    total += (end - h) * lossPerHour(days, placeFactor(place, seasons.seasonOfDay(day)));
    h = end;
  }
  return total;
}

/** Freshness after losing `loss` points [percent, never below 0]; 0 means spoiled. */
export function spoiledFreshness(freshness: number, loss: number): number {
  const f = freshness - loss;
  return f > 0 ? f : 0;
}
