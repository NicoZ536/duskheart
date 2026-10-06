/**
 * Pure rules of farming (docs/SPIEL.md §20, MASTERPROMPT §17; M7-19, M7-20): the day of a plot at 06:00 – moisture, frost,
 * pests, growth – its harvest's quality and yield, and the dawns between two ticks. The farming system runs `plotDay` for
 * every plot of an active chunk at the dawn (`dailyTick`) and for every dawn a frozen chunk missed (`catchUp`): the same
 * function with the same inputs, so "active ≡ frozen + caught up ≡ a → b → c" holds bit for bit (tests/unit/game/wachstum.test.ts).
 *
 * Every chance is drawn from a hash of (seed, layer, tile, day, what) – never from a running stream – so the result does not
 * depend on when a chunk was active or how often the game was saved (§28 "Determinismus-Regeln").
 */
import { BALANCE, type SeasonId } from '../../content/balance';
import { ripeStage, type CropDef } from '../../content/farming/schema';
import { hash3, hashCombine, hashToUnit } from '../../engine/rng';
import { PESTS, type Pest } from './types';
import { PLOT, type FarmChunk } from './store';
import type { CropDeathCause } from './events';

const F = BALANCE.farming;
const P = F.pests;
const Q = F.quality;

/** Hash salts of the per-tile, per-day draws. */
const SALT = { crow: 0x2c1b3c6d, hare: 0x297a2d39, mildew: 0x7a5d1c3f, quality: 0x1b873593, yield: 0x5bd1e995, seeds: 0x68e31da4, worm: 0x4f6cdd1d } as const;
/** Pest indices. */
export const PEST_NONE = PESTS.indexOf('keine');
export const PEST_CROWS = PESTS.indexOf('kraehen');
export const PEST_HARES = PESTS.indexOf('hasen');
export const PEST_MILDEW = PESTS.indexOf('mehltau');

/** A draw in [0, 1) for tile (tx, ty) of `layer` on `day`, salted by `what`. */
export function farmRoll(seed: number, layer: number, tx: number, ty: number, day: number, what: number): number {
  return hashToUnit(hash3(tx, ty, day, hashCombine(hashCombine(seed, what), layer)));
}

/** Number of 06:00 dawns in the tick span (from, to]: dawn k (k ≥ 1) happens at tick k × ticksPerDay. */
export function dawnsBetween(fromTick: number, toTick: number, ticksPerDay: number): number {
  return Math.max(0, Math.floor(toTick / ticksPerDay) - Math.floor(fromTick / ticksPerDay));
}

/** Index of the first dawn after `fromTick` (dawn k begins day k + 1). */
export function firstDawnAfter(fromTick: number, ticksPerDay: number): number {
  return Math.floor(fromTick / ticksPerDay) + 1;
}

/** Drying of a plot in a day [moisture points]: `dailyDrying` × the day's warmth × the crop's water need (§20 "Temperaturfaktor"). */
export function dailyDrying(maxTemperatureC: number, crop: Pick<CropDef, 'wasserbedarf'> | null): number {
  const warmth = Math.min(F.dryingFactorMax, Math.max(F.dryingFactorMin, maxTemperatureC / F.dryingReferenceC));
  return F.dailyDrying * warmth * F.dryingByNeed[crop === null ? 'mittel' : crop.wasserbedarf];
}

/** The weather and warmth of the day a plot just lived through (its farm day, 06:00 → 06:00). */
export interface PlotDay {
  readonly seed: number;
  /** The farm day that just ended. */
  readonly day: number;
  readonly season: SeasonId;
  readonly rain: boolean;
  /** Lowest and highest air temperature of the tile that day [°C]. */
  readonly minC: number;
  readonly maxC: number;
  /** Rainy days in a row up to this one (mildew). */
  readonly rainStreak: number;
}

/** What the day did to a plot (one outcome; the farming system turns it into an event in active chunks). */
export const DAY_OUTCOMES = ['nichts', 'gewachsen', 'reif', 'gestorben', 'gefressen', 'schaedling', 'geraeumt'] as const;
export type DayOutcome = (typeof DAY_OUTCOMES)[number];

/** The outcome of `plotDay` (a held record). */
export interface PlotDayResult {
  outcome: DayOutcome;
  /** `gestorben`/`gefressen`: why; `schaedling`: which pest. */
  cause: CropDeathCause | null;
  pest: Exclude<Pest, 'keine'> | null;
}

export function createPlotDayResult(): PlotDayResult {
  return { outcome: 'nichts', cause: null, pest: null };
}

function result(out: PlotDayResult, outcome: DayOutcome, cause: CropDeathCause | null, pest: Exclude<Pest, 'keine'> | null): PlotDayResult {
  out.outcome = outcome;
  out.cause = cause;
  out.pest = pest;
  return out;
}

/** The plant on tile `i` dies: it stays as a wilted plant for `wiltedDays`. */
function die(c: FarmChunk, i: number): void {
  c.setFlag(i, PLOT.dead, true);
  c.pest[i] = PEST_NONE;
  c.pestDays[i] = 0;
}

/**
 * One day of the plot at tile index `i` (tile (tx, ty) of `c.layer`) at 06:00 (docs/SPIEL.md §20 "Wachstum um 06:00"):
 * 1. moisture: rain sets it to `wetMoisture`, else it dries by `dailyDrying` (warmth, water need); water near keeps it at
 *    `waterNearMoisture` at least. The plant lived the day on the moisture it began with (or the rain).
 * 2. a dead plant wilts away after `wiltedDays`; an empty plot is done.
 * 3. frost (T_min < 0 °C) kills a tender plant out of doors (a greenhouse shelters it).
 * 4. mildew lasting `mildewKillDays` kills; while mildewed nothing grows. A day's crows or hares are gone the next day.
 * 5. new pests: crows (no scarecrow, not in a greenhouse) eat a sown seed or peck at a ripe crop (half the yield); hares (no fence) nibble a
 *    growing plant back a stage; after `mildewRainDays` rainy days mildew may strike.
 * 6. growth: in season, T_min > 2 °C (both or in a greenhouse) and moisture > 20 the plant counts a day; after `tageJeStufe`
 *    days it reaches the next stage and banks the plot's fertility as quality points.
 */
export function plotDay(c: FarmChunk, i: number, tx: number, ty: number, crop: CropDef | null, d: PlotDay, out: PlotDayResult): PlotDayResult {
  result(out, 'nichts', null, null);
  const before = c.moisture[i] as number;
  const effective = d.rain ? F.wetMoisture : before;
  let after = d.rain ? F.wetMoisture : Math.max(0, Math.round(before - dailyDrying(d.maxC, crop)));
  if (c.flag(i, PLOT.waterNear)) after = Math.max(after, F.waterNearMoisture);
  c.moisture[i] = after;
  if (crop === null) return out;
  if (c.flag(i, PLOT.dead)) {
    const days = (c.pestDays[i] as number) + 1;
    if (days >= F.wiltedDays) {
      c.clearCrop(i);
      return result(out, 'geraeumt', null, null);
    }
    c.pestDays[i] = days;
    return out;
  }
  const sheltered = c.flag(i, PLOT.sheltered);
  if (!crop.winterhart && !sheltered && d.minC < F.frostBelowC) {
    die(c, i);
    return result(out, 'gestorben', 'frost', null);
  }
  const pest = c.pest[i] as number;
  if (pest === PEST_MILDEW) {
    const days = (c.pestDays[i] as number) + 1;
    if (days >= P.mildewKillDays) {
      die(c, i);
      return result(out, 'gestorben', 'mehltau', null);
    }
    c.pestDays[i] = days;
    return out;
  }
  if (pest !== PEST_NONE) c.pest[i] = PEST_NONE;
  const ripe = ripeStage(crop);
  const stage = c.stage[i] as number;
  const layer = c.layer;
  // Crows keep out of a greenhouse (under its roof) and away from a scarecrow.
  if (!c.flag(i, PLOT.scarecrow) && !sheltered && (stage === 0 || (stage === ripe && !c.flag(i, PLOT.pecked))) && farmRoll(d.seed, layer, tx, ty, d.day, SALT.crow) < P.crowChance) {
    if (stage === 0) {
      c.clearCrop(i);
      return result(out, 'gefressen', 'kraehen', null);
    }
    c.setFlag(i, PLOT.pecked, true);
    c.pest[i] = PEST_CROWS;
    return result(out, 'schaedling', null, 'kraehen');
  }
  if (!c.flag(i, PLOT.enclosed) && stage >= 1 && stage < ripe && farmRoll(d.seed, layer, tx, ty, d.day, SALT.hare) < P.hareChance) {
    c.stage[i] = Math.max(1, stage - 1);
    c.daysInStage[i] = 0;
    c.pest[i] = PEST_HARES;
    return result(out, 'schaedling', null, 'hasen');
  }
  if (d.rainStreak >= P.mildewRainDays && farmRoll(d.seed, layer, tx, ty, d.day, SALT.mildew) < P.mildewChance) {
    c.pest[i] = PEST_MILDEW;
    c.pestDays[i] = 0;
    return result(out, 'schaedling', null, 'mehltau');
  }
  if (stage >= ripe) return out;
  // A greenhouse grows all year (MASTERPROMPT §16 "Gewächshaus (Glasdach + Beete: ganzjährig)"): its glass roof keeps the
  // season, the frost and the cold nights out.
  const inSeason = sheltered || crop.jahreszeiten.includes(d.season);
  const warm = sheltered || d.minC > F.growthTemperatureAboveC;
  if (!inSeason || !warm || !(effective > F.growthMoistureAbove)) return out;
  const days = (c.daysInStage[i] as number) + 1;
  if (days < crop.tageJeStufe) {
    c.daysInStage[i] = days;
    return out;
  }
  c.stage[i] = stage + 1;
  c.daysInStage[i] = 0;
  c.qualityPoints[i] = (c.qualityPoints[i] as number) + (c.fertility[i] as number);
  return result(out, stage + 1 === ripe ? 'reif' : 'gewachsen', null, null);
}

/**
 * `days` debug days of good growth on tile `i` (`farm.grow`, docs/SPIEL.md §30): the plant counts each as a growth day –
 * no drying, frost or pests. A dead plant stays dead. Returns whether the stage changed.
 */
export function plotGrow(c: FarmChunk, i: number, crop: CropDef, days: number): boolean {
  if (c.flag(i, PLOT.dead)) return false;
  const ripe = ripeStage(crop);
  const from = c.stage[i] as number;
  let stage = from;
  let inStage = (c.daysInStage[i] as number) + days;
  while (stage < ripe && inStage >= crop.tageJeStufe) {
    inStage -= crop.tageJeStufe;
    stage++;
    c.qualityPoints[i] = (c.qualityPoints[i] as number) + (c.fertility[i] as number);
  }
  c.stage[i] = stage;
  c.daysInStage[i] = stage >= ripe ? 0 : inStage;
  return stage !== from;
}

/** The stage a crop's growth since its last planting or harvest started from (0, or the regrowth stage after a harvest). */
export function growthBase(crop: CropDef, harvests: number): number {
  return harvests > 0 && crop.nachwuchs !== undefined ? crop.nachwuchs.stufe : 0;
}

/**
 * Quality of a harvest [stars 1–3] (§17 "Qualität (Normal/Silber/Gold) aus Fruchtbarkeit und Skill"): the mean fertility
 * while it grew (quality points per stage) weighted with the Landwirtschaft level, spread by a hash of the tile and day.
 */
export function harvestQuality(meanFertility: number, skillLevel: number, roll: number): number {
  const score = Q.fertilityShare * meanFertility + Q.skillShare * skillLevel + (roll * 2 - 1) * Q.spread;
  return score >= Q.goldFrom ? 3 : score >= Q.silverFrom ? 2 : 1;
}

/** A count in [min, max] from a draw in [0, 1). */
export function countIn(range: readonly [number, number], roll: number): number {
  return range[0] + Math.floor(roll * (range[1] - range[0] + 1));
}

/** The salts of the harvest draws (quality, yield, seeds) and of the earthworm of a hoed tile. */
export const FARM_SALT = SALT;
