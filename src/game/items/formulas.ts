/**
 * Pure item formulas (MASTERPROMPT §13.1, §D, §18; tests/unit/game/items-formeln.test.ts).
 *
 * - Quality 1–3 stars: +0 %, +10 %, +20 % on stats and durability (`BALANCE.items.quality.bonus`).
 * - Durability of a new piece = base durability × quality factor, rounded to whole uses.
 * - Wear: durability drops by the uses, never below 0; 0 means broken (unusable, never destroyed).
 * - Freshness when two stacks are joined: mean weighted by count (§13.1 "Frische beim Zusammenlegen
 *   gewichtet gemittelt"), rounded to the freshness grid 2^-16 (`quantizeFreshness`, M7-29).
 */
import { BALANCE } from '../../content/balance';
import { pexp2 } from '../../engine/portableMath';

/** Lowest quality [stars]. */
export const QUALITY_MIN = 1;
/** Highest quality [stars] (one bonus value per star, §13.1 "1–3 Sterne"). */
export const QUALITY_MAX = BALANCE.items.quality.bonus.length;
/** Freshness of a new stack [percent] (§18 "Frische 100 → 0"). */
export const FRESHNESS_MAX = BALANCE.items.freshnessMax;

/** Multiplier on stats and durability of a piece of `quality` stars. Throws `RangeError` outside 1–3. */
export function qualityFactor(quality: number): number {
  const bonus = BALANCE.items.quality.bonus[quality - QUALITY_MIN];
  if (!Number.isInteger(quality) || bonus === undefined) throw new RangeError(`quality must be an integer ${QUALITY_MIN}–${QUALITY_MAX}, got ${quality}`);
  return 1 + bonus;
}

/** Durability of a new piece [uses]: base × quality factor, rounded (60 uses at 2 stars → 66). */
export function maxDurability(base: number, quality: number): number {
  return Math.round(base * qualityFactor(quality));
}

/** Durability after `uses` more uses [uses]; never below 0. */
export function wornDurability(current: number, uses: number): number {
  const left = current - uses;
  return left > 0 ? left : 0;
}

/** Steps of the freshness grid per percent point: 2^16 (docs/SPIEL.md §21 "Exakt und zerlegbar", `BALANCE.spoilage.gridBits`). */
const FRESHNESS_GRID = pexp2(BALANCE.spoilage.gridBits);

/**
 * `value` rounded to the freshness grid 2^-16 [percent] (M7-29, docs/SPIEL.md §21): every freshness and every hourly loss
 * lies on it, so |value| ≤ 100 needs at most 23 bits and every sum or product of whole hours is exact in float64 – n single
 * hours of spoilage and one step of n hours give the same bits.
 */
export function quantizeFreshness(value: number): number {
  return Math.round(value * FRESHNESS_GRID) / FRESHNESS_GRID;
}

/** Count-weighted mean of two freshness values [percent], on the freshness grid (`quantizeFreshness`). */
export function weightedFreshness(freshA: number, countA: number, freshB: number, countB: number): number {
  return quantizeFreshness((freshA * countA + freshB * countB) / (countA + countB));
}
