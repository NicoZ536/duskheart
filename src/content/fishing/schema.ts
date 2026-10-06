/**
 * Fish (docs/SPIEL.md §20 "Angeln"; ADR-0207; strand D, collection `fish`, §C "Fischarten"): where and when a fish bites,
 * how it fights on the line and whether a fish trap catches it. The zod schema producing `FishDef` is strand D's. (The day
 * phases here are the fish's three, not the calendar's four `DAY_PHASES` of src/world/calendar.ts.)
 */
import type { SeasonId } from '../balance';
import type { WeatherStateId } from '../weather';

export const FISH_WATERS = ['fluss', 'see', 'meer', 'eis'] as const;
export type FishWater = (typeof FISH_WATERS)[number];
export const DAY_PHASES = ['tag', 'daemmerung', 'nacht'] as const;
export type DayPhase = (typeof DAY_PHASES)[number];
/** One fish (`id` = the raw item). */
export interface FishDef {
  readonly id: string;
  readonly biome: readonly string[];
  readonly gewaesser: readonly FishWater[];
  readonly tageszeit: readonly DayPhase[];
  readonly jahreszeiten: readonly SeasonId[];
  readonly wetter?: readonly WeatherStateId[];
  readonly koeder?: readonly string[];
  /** Relative weight among the fish that fit. */
  readonly gewicht: number;
  /** Fight in the mini-game: pull force, endurance [s], jumps per minute. */
  readonly kampf: { readonly kraft: number; readonly ausdauer: number; readonly spruenge: number };
  /** Can be caught in a fish trap. */
  readonly reuse: boolean;
}
