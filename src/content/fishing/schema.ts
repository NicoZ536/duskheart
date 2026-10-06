/**
 * Fish (docs/SPIEL.md §20 "Angeln"; ADR-0207; strand D, collection `fish`, §C "Fischarten"): where and when a fish bites,
 * how it fights on the line and whether a fish trap catches it. The zod schema producing `FishDef` is strand D's. (The day
 * phases here are the fish's three, not the calendar's four `DAY_PHASES` of src/world/calendar.ts.)
 *
 * Rules of a fish record (`fishSchema`): `id` is the raw item (src/content/items/fang.ts) and its icon `icon_<id>`; it bites
 * in one of its biomes, waters, day phases and seasons (all four lists non-empty, unique), in one of its weathers when it
 * names some, and prefers its baits (`koeder`: the bait items whose `koeder.fische` name it raise its weight further);
 * `gewicht` > 0 is its share among the fish that fit; `kampf.kraft` 0–1 is its pull, `ausdauer` [s] how long it fights
 * at full strength, `spruenge` [per minute] how often it leaps (a leap jerks the line).
 */
import { z } from 'zod';
import { SEASON_IDS, type SeasonId } from '../balance';
import { deepFreeze } from '../freeze';
import { idSchema } from '../schema/common';
import { WEATHER_STATE_IDS, type WeatherStateId } from '../weather';

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

/** Longest fight at full strength [s]: beyond half a minute the mini-game turns into a chore. */
const MAX_ENDURANCE_S = 30;
/** Most leaps per minute [1/min]: a fish that leaps every few seconds reads as a trout gone wild. */
const MAX_LEAPS_PER_MIN = 8;

function unique<T>(list: readonly T[]): boolean {
  return new Set(list).size === list.length;
}

/** Schema of one fish. */
export const fishSchema = z
  .object({
    id: idSchema,
    biome: z.array(idSchema).min(1),
    gewaesser: z.array(z.enum(FISH_WATERS)).min(1),
    tageszeit: z.array(z.enum(DAY_PHASES)).min(1),
    jahreszeiten: z.array(z.enum(SEASON_IDS)).min(1),
    wetter: z.array(z.enum(WEATHER_STATE_IDS)).min(1).optional(),
    koeder: z.array(idSchema).min(1).optional(),
    gewicht: z.number().positive(),
    kampf: z
      .object({ kraft: z.number().gt(0).max(1), ausdauer: z.number().positive().max(MAX_ENDURANCE_S), spruenge: z.number().min(0).max(MAX_LEAPS_PER_MIN) })
      .strict(),
    reuse: z.boolean(),
  })
  .strict()
  .superRefine((f, ctx) => {
    for (const key of ['biome', 'gewaesser', 'tageszeit', 'jahreszeiten', 'wetter', 'koeder'] as const) {
      const list = f[key];
      if (list !== undefined && !unique(list)) ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be unique` });
    }
  }) satisfies z.ZodType<FishDef>;

/** Fish data as written in the content files. */
export type FishInput = z.input<typeof fishSchema>;
/** A parsed fish (the zod output: what the registry stores; it satisfies `FishDef`). */
export type FishRecord = z.output<typeof fishSchema>;

/** Error in the fish content. */
export class FishContentError extends Error {
  override readonly name = 'FishContentError';
}

/** Validates the fish (schema, unique ids) and freezes them. */
export function defineFish(records: readonly FishInput[]): readonly FishRecord[] {
  const seen = new Set<string>();
  const parsed = records.map((raw, index) => {
    const r = fishSchema.safeParse(raw);
    if (!r.success) throw new FishContentError(`Fish [${index}] "${raw.id}" invalid: ${r.error.issues.map((i) => `${i.path.map(String).join('.') || '(fish)'}: ${i.message}`).join('; ')}`);
    if (seen.has(r.data.id)) throw new FishContentError(`duplicate fish "${r.data.id}"`);
    seen.add(r.data.id);
    return r.data;
  });
  deepFreeze(parsed);
  return parsed;
}
