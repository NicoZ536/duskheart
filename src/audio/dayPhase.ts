/**
 * The calendar as the audio hears it (M7-78; MASTERPROMPT §30 "keine Allokationen in Hot-Loops"): the day phase and the season
 * of a simulation's world, asked of the calendar once per game minute and shared by the ambience and the music probes.
 *
 * The calendar computes the phase from the fractional hour of the day; called from presentation code that is not optimised,
 * each question boxes a few numbers. Night falls over game hours and the ambience and the music change with hysteresis, so a
 * minute's delay is not heard; the cache key (day and minute of the day) is a whole number compared without allocation.
 */
import { MINUTES_PER_DAY } from '../engine/time';
import type { Simulation } from '../game/sim';
import type { SimWorld } from '../game/world';
import type { DayPhase, Season } from '../world/calendar';

/** The calendar of one simulation at one game minute. */
class CalendarMinute {
  /** Day · minutes per day + minute of the day (−1: not read yet). */
  key = -1;
  phase: DayPhase = 'tag';
  season: Season = 'fruehling';
}

const minutes = new WeakMap<Simulation, CalendarMinute>();

/** The day phase and season of `world` (the world of `sim`) at the current game minute, read once per minute. */
export function calendarMinute(sim: Simulation, world: SimWorld): Readonly<CalendarMinute> {
  let c = minutes.get(sim);
  if (c === undefined) {
    c = new CalendarMinute();
    minutes.set(sim, c);
  }
  const clock = sim.clock;
  const key = clock.day * MINUTES_PER_DAY + clock.minuteOfDay;
  if (key !== c.key) {
    c.key = key;
    c.phase = world.calendar.dayPhase;
    c.season = world.calendar.season;
  }
  return c;
}
