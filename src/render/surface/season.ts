/**
 * Foliage of the seasons (MASTERPROMPT §6.2 "Laub-Palettenzeilen je Jahreszeit mit Übergang über 2 Tage", M5-19):
 * the palette rows of the leaves change over two days around each change of season – from one day before the new
 * season begins to one day into it. Pure functions of the calendar; the object layer turns a blend into palette
 * rows and frames (`world/objects.ts`).
 */
import { SURFACE_PARAMS } from './params';

/** Number of seasons (`SEASON_IDS`). */
export const SEASONS = 4;
/** The transition's length [days] as a module constant (read per tick without an import's lookup, §30). */
const TRANSITION_DAYS = SURFACE_PARAMS.seasons.transitionDays;

/** A blend of two seasons: `to` = −1 when no change is under way (then `from` is the season shown). */
export interface SeasonBlend {
  from: number;
  to: number;
  /** 0 = all `from` … 1 = all `to`. */
  progress: number;
}

/**
 * Foliage blend on day `dayOfSeason` (1…`lengthDays`) of season `season` (0 spring … 3 winter) at `dayFraction`
 * (0…1) of that day, with a transition of `transitionDays` centred on the season change. Writes into `out`.
 */
export function foliageBlend(season: number, dayOfSeason: number, dayFraction: number, lengthDays: number, out: SeasonBlend, transitionDays: number = SURFACE_PARAMS.seasons.transitionDays): SeasonBlend {
  const half = Math.min(transitionDays / 2, lengthDays / 2);
  const s = ((Math.floor(season) % SEASONS) + SEASONS) % SEASONS;
  const into = dayOfSeason - 1 + Math.min(1, Math.max(0, dayFraction));
  const left = lengthDays - into;
  if (half > 0 && into < half) {
    // The first half day(s) of a season: the previous one is still fading out.
    out.from = (s + SEASONS - 1) % SEASONS;
    out.to = s;
    out.progress = 0.5 + (0.5 * into) / half;
  } else if (half > 0 && left < half) {
    // The last half day(s): the next one is fading in.
    out.from = s;
    out.to = (s + 1) % SEASONS;
    out.progress = 0.5 - (0.5 * left) / half;
  } else {
    out.from = s;
    out.to = -1;
    out.progress = 0;
  }
  return out;
}

/**
 * Whether the blend on day `dayOfSeason` of a season `lengthDays` long is the same at every fraction of the day: the day
 * lies wholly outside the transition of `transitionDays` around both of its season's changes (`foliageBlend` then shows
 * the season alone). Whole numbers in, so a caller can skip the blend for a tick that stays on such a day.
 */
export function foliageSteadyOn(dayOfSeason: number, lengthDays: number, transitionDays: number = TRANSITION_DAYS): boolean {
  const a = transitionDays / 2;
  const b = lengthDays / 2;
  const half = a < b ? a : b;
  if (!(half > 0)) return true;
  // The day spans `into` ∈ [dayOfSeason − 1, dayOfSeason]: steady when its start is past `half` and its end `half` before the season's.
  return dayOfSeason - 1 >= half && lengthDays - dayOfSeason >= half;
}
