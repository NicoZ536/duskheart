/**
 * Foliage of the seasons (MASTERPROMPT §6.2 "Laub-Palettenzeilen je Jahreszeit mit Übergang über 2 Tage", M5-19):
 * the palette rows of the leaves change over two days around each change of season – from one day before the new
 * season begins to one day into it. Pure functions of the calendar; the object layer turns a blend into palette
 * rows and frames (`world/objects.ts`).
 */
import { SURFACE_PARAMS } from './params';

/** Number of seasons (`SEASON_IDS`). */
export const SEASONS = 4;

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
