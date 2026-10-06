/**
 * Pure rules of the world events (docs/SPIEL.md §18 "Weltereignisse"; M7-38 … M7-40): the plan of an event for a day from
 * `hash(seed, 'weltereignis', id, day)` – no running random stream, so jumping in time or loading never changes it –, the
 * eclipse's daylight curve, and the draws of lightning (`hash(seed, 'blitz', region, minute)`), of the Lumen rain's shards
 * and of its meteorite. All in absolute game minutes (src/world/climate/gameTime.ts: day 1 06:00 = minute 360).
 */
import { BALANCE, type SeasonId as Season } from '../../content/balance';
import type { WorldEventDef } from '../../content/worldEvents/schema';
import { hashCombine, hashString, hashToUnit } from '../../engine/rng';
import { dayTimes, isFinstermondPhase, moonPhaseOfNight } from '../../world/calendar';
import { minuteOf } from '../../world/climate/gameTime';

const W = BALANCE.worldEvents;
const PLAN_SALT = hashString('weltereignis');
const STRIKE_SALT = hashString('blitz');
const SHARD_SALT = hashString('lumenregen');

/** One planned run of an event [absolute game minutes]. */
export interface Occurrence {
  announce: number;
  start: number;
  end: number;
}

export function emptyOccurrence(): Occurrence {
  return { announce: 0, start: 0, end: 0 };
}

/** The `k`-th draw [0, 1) of event `id` on `day` – the whole plan of an event comes from these. */
export function planDraw(seed: number, id: string, day: number, k: number): number {
  return hashToUnit(hashCombine(hashCombine(hashCombine(hashCombine(seed >>> 0, PLAN_SALT), hashString(id)), day), k));
}

/** Whether a day of `season` qualifies for an event with the season filter `jahreszeiten` (absent: every season). */
function seasonFits(def: WorldEventDef, season: Season): boolean {
  const j = def.planung.jahreszeiten;
  return j === undefined || j.includes(season);
}

/**
 * The run of `def` planned for `day` into `out` (true), or false when none: `mond` – the night that begins on the evening of
 * `day` if it is a Finstermond (from the end of dusk to the start of the next dawn); `naechtlich`/`taeglich` – with
 * `planung.chance` a run starting in the night/day window, lasting `dauerMinuten`. `wetter` and `basis` are not planned by the
 * calendar (the weather of the player's region decides, the base's events come with later milestones).
 */
export function occurrenceOn(def: WorldEventDef, seed: number, day: number, seasonOfDay: (day: number) => Season, out: Occurrence): boolean {
  const p = def.planung;
  const season = seasonOfDay(day);
  if (!seasonFits(def, season)) return false;
  switch (p.art) {
    case 'mond': {
      if (!isFinstermondPhase(moonPhaseOfNight(day))) return false;
      out.start = minuteOf(day, dayTimes(season).duskEnd);
      out.end = minuteOf(day + 1, dayTimes(seasonOfDay(day + 1)).dawnStart);
      break;
    }
    case 'naechtlich':
    case 'taeglich': {
      if (planDraw(seed, def.id, day, 0) >= p.chance) return false;
      const window = p.art === 'naechtlich' ? W.nightWindowHours : W.dayWindowHours;
      const h0 = window[0] as number;
      const h1 = window[1] as number;
      out.start = Math.floor(minuteOf(day, h0 + planDraw(seed, def.id, day, 1) * (h1 - h0)));
      const [d0, d1] = def.dauerMinuten;
      out.end = out.start + d0 + Math.floor(planDraw(seed, def.id, day, 2) * (d1 - d0 + 1));
      break;
    }
    default:
      return false;
  }
  out.announce = out.start - def.ankuendigung.vorlaufMinuten;
  return true;
}

/** Whether `day` is one of the event's weather days (`wetter`: the season fits and the day's draw is below the chance). */
export function weatherDay(def: WorldEventDef, seed: number, day: number, season: Season): boolean {
  return def.planung.art === 'wetter' && seasonFits(def, season) && planDraw(seed, def.id, day, 0) < def.planung.chance;
}

/** Duration [game minutes] of a weather event's run that starts on `day` (`dauerMinuten`, drawn). */
export function weatherDuration(def: WorldEventDef, seed: number, day: number): number {
  const [d0, d1] = def.dauerMinuten;
  return d0 + Math.floor(planDraw(seed, def.id, day, 2) * (d1 - d0 + 1));
}

/**
 * Daylight factor of an eclipse running from `start` to `end` at `minute` [0–1]: 1 outside, darkening over
 * `BALANCE.worldEvents.eclipseRampMinutes` after the start, full night, brightening over the ramp before the end.
 */
export function eclipseFactor(minute: number, start: number, end: number): number {
  if (minute <= start || minute >= end) return 1;
  const ramp = Math.min(W.eclipseRampMinutes, (end - start) / 2);
  if (minute < start + ramp) return 1 - (minute - start) / ramp;
  if (minute > end - ramp) return (minute - (end - ramp)) / ramp;
  return 0;
}

/** The `k`-th draw [0, 1) of lightning in weather `region` in game minute `minute` (whole minute). */
export function strikeDraw(seed: number, region: number, minute: number, k: number): number {
  return hashToUnit(hashCombine(hashCombine(hashCombine(hashCombine(seed >>> 0, STRIKE_SALT), region), minute), k));
}

/** The `k`-th draw [0, 1) of the Lumen rain in game minute `minute` (shards, meteorite). */
export function shardDraw(seed: number, minute: number, k: number): number {
  return hashToUnit(hashCombine(hashCombine(hashCombine(seed >>> 0, SHARD_SALT), minute), k));
}

/** A point at distance [min, max] tiles from (x, y) in direction and distance of two draws (into `out`, tiles). */
export function pointAround(x: number, y: number, range: readonly number[], a: number, b: number, out: { x: number; y: number }): { x: number; y: number } {
  const angle = a * Math.PI * 2;
  const r0 = range[0] as number;
  const d = r0 + b * ((range[1] as number) - r0);
  out.x = Math.floor(x + Math.cos(angle) * d);
  out.y = Math.floor(y + Math.sin(angle) * d);
  return out;
}
