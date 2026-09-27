/**
 * Pure rules of the fire simulation (MASTERPROMPT §16.2 "Brennbar", §10 "Wind … Feuerausbreitung", "Feuer löschen";
 * M4-28; values `BALANCE.fire`): how hard a fire bites a part, how soon it reaches a neighbour with the wind, and the
 * climate runs a frozen fire reads. Everything is in whole world seconds, so a fire burned second by second in an
 * active chunk and one caught up after its chunk was frozen take the same steps.
 */
import { BALANCE } from '../../content/balance';
import { hash3, hashString } from '../../engine/rng';

const F = BALANCE.fire;
/** Ticks per world tick (§3.3: the world tick runs at 1 Hz). */
export const TICKS_PER_WORLD_SECOND = BALANCE.time.tickHz / BALANCE.time.worldTickHz;

/** Column offset of each neighbour direction (N, NE, E, SE, S, SW, W, NW). */
export const DIR_DX: readonly number[] = [0, 1, 1, 1, 0, -1, -1, -1];
/** Row offset of each neighbour direction. */
export const DIR_DY: readonly number[] = [-1, -1, 0, 1, 1, 1, 0, -1];
/** Number of directions. */
const DIRECTIONS = DIR_DX.length;
/**
 * How well a direction lines up with the wind, by the difference of the two in eighths of a turn: 1 downwind, the
 * cosine of 45° half beside it, 0 across, −1 upwind (a table, no trigonometry at run time).
 */
const ALIGNMENT: readonly number[] = [1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2, 0, Math.SQRT1_2];
/** Salt of the wind directions. */
const WIND_SALT = hashString('wind');

/** Bit of a climate code: rain that puts fires out is falling. */
const WET_BIT = 1;
/** Shift and mask of the wind class in a climate code. */
const CLASS_SHIFT = 1;
const CLASS_MASK = 0b11;
/** Shift and mask of the wind direction in a climate code. */
const DIR_SHIFT = 3;
const DIR_MASK = 0b111;

/** World second of tick `tick` (the world tick at tick 60 s burns second s). */
export function worldSecond(tick: number): number {
  return Math.floor(tick / TICKS_PER_WORLD_SECOND);
}

/** Wind class (0 calm … 3 storm) of wind strength `wind` [0–1] (`BALANCE.fire.windClassFrom`). */
export function windClass(wind: number): number {
  let c = 0;
  for (const from of F.windClassFrom) if (wind >= from) c++;
  return c;
}

/**
 * Direction the wind blows towards in weather period `period` of region `region` (0 north … 7 north-west): fixed per
 * period from the world seed, so it turns when the weather changes and never within a period.
 */
export function windDirection(seed: number, region: number, period: number): number {
  return hash3(region, period, WIND_SALT, seed) & DIR_MASK;
}

/** The climate of one region in one second as a code: rain that puts fires out, wind class, wind direction. */
export function climateCode(rain: number, wind: number, direction: number): number {
  return (rain >= F.rainFromPrecipitation ? WET_BIT : 0) | (windClass(wind) << CLASS_SHIFT) | ((direction & DIR_MASK) << DIR_SHIFT);
}

/** Whether rain that puts fires out falls in climate `code`. */
export function codeWet(code: number): boolean {
  return (code & WET_BIT) !== 0;
}

/** Wind class of climate `code`. */
export function codeWindClass(code: number): number {
  return (code >>> CLASS_SHIFT) & CLASS_MASK;
}

/** Wind direction of climate `code`. */
export function codeWindDirection(code: number): number {
  return (code >>> DIR_SHIFT) & DIR_MASK;
}

/** How much faster the fire spreads in direction `dir` under climate `code` [factor] (§10 "Wind begünstigt"). */
export function windFactor(dir: number, code: number): number {
  const boost = F.windBoost[codeWindClass(code)] ?? 0;
  const align = ALIGNMENT[(dir - codeWindDirection(code) + DIRECTIONS) % DIRECTIONS] as number;
  return Math.max(F.minWindFactor, 1 + boost * align);
}

/**
 * Seconds until a burning tile reaches its neighbour in direction `dir` whose most flammable thing has
 * `flammability`, under climate `code` [s, ≥ 1]; `NO_SPREAD` (−1) when nothing there burns.
 */
export function spreadDelay(flammability: number, dir: number, code: number): number {
  if (!(flammability > 0)) return -1;
  const diagonal = (dir & 1) === 1 ? F.diagonalFactor : 1;
  return Math.max(1, Math.ceil((F.spreadSeconds * diagonal) / (flammability * windFactor(dir, code))));
}

/** Hit points a fire takes per second from a part of `flammability` [HP/s]: 0 when it does not burn, else at least 1. */
export function burnDamage(flammability: number): number {
  if (!(flammability > 0)) return 0;
  return Math.max(1, Math.round(F.damagePerSecond * flammability));
}

/**
 * The climate code of second `s` from runs `[second, code, …]` (ascending): the code of the last run that began at or
 * before `s`; the first run's code before it, 0 (dry, calm) without runs.
 */
export function climateAt(runs: readonly number[], s: number): number {
  if (runs.length === 0) return 0;
  let lo = 0;
  let hi = runs.length / 2 - 1;
  if ((runs[0] as number) > s) return runs[1] as number;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((runs[mid * 2] as number) <= s) lo = mid;
    else hi = mid - 1;
  }
  return runs[lo * 2 + 1] as number;
}

/** Appends the code of second `s` to `runs` when it differs from the last run. */
export function recordClimate(runs: number[], s: number, code: number): void {
  const n = runs.length;
  if (n > 0 && runs[n - 1] === code) return;
  runs.push(s, code);
}

/**
 * Drops what a lookup at second `s` or later no longer needs: the runs before the one in force at `s`, which then
 * starts at `s` – so two logs that agree from `s` on are equal, however long each was kept before (a ticking and a
 * caught-up fire end with the same state).
 */
export function pruneClimate(runs: number[], s: number): void {
  let keep = 0;
  for (let k = 0; k + 2 < runs.length && (runs[k + 2] as number) <= s; k += 2) keep = k + 2;
  if (keep > 0) runs.splice(0, keep);
  if (runs.length > 0 && (runs[0] as number) < s) runs[0] = s;
}
