/**
 * Absolute game time for the climate systems (M2-25, M2-26).
 *
 * Weather periods last game hours (§10 "Dauer 1–8 Spielstunden"), so the weather counts in game
 * minutes since midnight before day 1 instead of ticks: a change of the day length (§29, 12–48 real
 * minutes) then keeps every running period at its length in game time. The world starts at 06:00 of
 * day 1 = minute 360. Only + − × ÷ and `Math.floor`, so the values are bit-identical everywhere.
 */
import { DAWN_MINUTE, HOURS_PER_DAY, MINUTES_PER_DAY, MINUTES_PER_HOUR, type GameClock } from '../../engine/time';

/** Game minutes of one game day. */
export const DAY_MINUTES = MINUTES_PER_DAY;
/** Game minutes of one game hour. */
export const HOUR_MINUTES = MINUTES_PER_HOUR;
/** Absolute game minute at which every world starts (06:00 of day 1). */
export const WORLD_START_MINUTE = DAWN_MINUTE;

/** Continuous absolute game minute of the clock (fractional within the current tick's minute). */
export function clockMinute(clock: GameClock): number {
  return DAWN_MINUTE + clock.dawns * MINUTES_PER_DAY + (clock.dayTick * MINUTES_PER_DAY) / clock.ticksPerDay;
}

/** Game minutes that pass per simulation tick at the clock's current day length. */
export function minutesPerTick(clock: GameClock): number {
  return MINUTES_PER_DAY / clock.ticksPerDay;
}

/** Day number (from 1) of an absolute game minute. */
export function dayOfMinute(minute: number): number {
  return Math.floor(minute / MINUTES_PER_DAY) + 1;
}

/** Continuous hour of the day in [0, 24) of an absolute game minute. */
export function hourOfMinute(minute: number): number {
  const m = minute - Math.floor(minute / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  return (m / MINUTES_PER_DAY) * HOURS_PER_DAY;
}

/** Absolute game minute of `hour` (may be fractional) on `day`. */
export function minuteOf(day: number, hour: number): number {
  return (day - 1) * MINUTES_PER_DAY + hour * MINUTES_PER_HOUR;
}
