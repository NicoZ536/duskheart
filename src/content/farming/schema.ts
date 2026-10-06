/**
 * Crops (docs/SPIEL.md §20, MASTERPROMPT §17; ADR-0207; strand D, collection `crops`, §C "Nutzpflanzen"): what grows on a
 * field – stages, days per stage, seasons, frost hardiness, water need, yields and regrowth. The zod schema producing
 * `CropDef` is strand D's.
 *
 * Rules of a crop record (`cropSchema`):
 * - `id` is the harvest item, `saat` the seed item `saat_<id>` (both in src/content/items/feld.ts); the sprite
 *   `feldfrucht_<id>` carries one frame per stage (stage 0 = the sown seed) and `feldfrucht_<id>_welk`.
 * - `stufen` 4–6 stages; the last one is ripe (harvestable). `tageJeStufe` whole days per stage at good conditions (§17
 *   "Wachstum täglich um 06:00": a stage grows at a dawn).
 * - `jahreszeiten`: the seasons it grows in (outside a greenhouse); `winterhart`: frost (T_min < 0 °C) does not kill it.
 * - `wasserbedarf`: how fast it dries its plot (`BALANCE.farming.dryingByNeed`).
 * - `ertrag`, `saatErtrag`: pieces of the harvest item and of its seed per harvest [min, max].
 * - `nachwuchs`: it carries again – after a harvest it falls back to stage `stufe` (≥ 1, below the ripe stage), at most
 *   `ernten` harvests in all.
 */
import { z } from 'zod';
import { SEASON_IDS, type SeasonId } from '../balance';
import { deepFreeze } from '../freeze';
import { idSchema } from '../schema/common';

export const WATER_NEEDS = ['gering', 'mittel', 'hoch'] as const;
export type WaterNeed = (typeof WATER_NEEDS)[number];
/** One crop (`id` = the harvest item; sprite `feldfrucht_<id>` with one frame per stage + `_welk`). */
export interface CropDef {
  readonly id: string;
  readonly saat: string;
  readonly stufen: 4 | 5 | 6;
  /** Days per stage at good conditions. */
  readonly tageJeStufe: number;
  readonly jahreszeiten: readonly SeasonId[];
  /** Survives frost outdoors. */
  readonly winterhart: boolean;
  readonly wasserbedarf: WaterNeed;
  readonly ertrag: readonly [number, number];
  readonly saatErtrag: readonly [number, number];
  /** Carries again: falls back to `stufe` after a harvest, at most `ernten` times (absent = one harvest). */
  readonly nachwuchs?: { readonly stufe: number; readonly ernten: number };
}

/** Prefix of the seed items (`saat_<crop>`, docs/SPIEL.md §29). */
export const SEED_PREFIX = 'saat_';
/** Prefix of the crop sprites (`feldfrucht_<crop>`, docs/SPIEL.md §29). */
export const CROP_SPRITE_PREFIX = 'feldfrucht_';
/** Suffix of the wilted crop sprite (`feldfrucht_<crop>_welk`). */
export const CROP_WILTED_SUFFIX = '_welk';
/** Fewest and most growth stages of a crop (§17 "4–6 Wachstumsstufen-Sprites"). */
export const CROP_STAGES_MIN = 4;
export const CROP_STAGES_MAX = 6;
/** Longest stage [days]: a stage that takes longer than a week reads as a stuck plant. */
export const CROP_STAGE_DAYS_MAX = 7;
/** Most pieces one harvest yields [pieces]. */
const YIELD_MAX = 12;
/** Most harvests of a crop that carries again. */
const HARVESTS_MAX = 10;

/** The sprite of crop `id` (`feldfrucht_<id>`). */
export function cropSpriteId(id: string): string {
  return `${CROP_SPRITE_PREFIX}${id}`;
}

/** The sprite of wilted crop `id` (`feldfrucht_<id>_welk`). */
export function cropWiltedSpriteId(id: string): string {
  return `${CROP_SPRITE_PREFIX}${id}${CROP_WILTED_SUFFIX}`;
}

const yieldSchema = z
  .tuple([z.number().int().min(0).max(YIELD_MAX), z.number().int().min(1).max(YIELD_MAX)])
  .refine(([min, max]) => min <= max, { message: 'yield is [min, max] with min ≤ max' });

/** Schema of one crop. */
export const cropSchema = z
  .object({
    id: idSchema,
    saat: idSchema,
    stufen: z.union([z.literal(4), z.literal(5), z.literal(6)]),
    tageJeStufe: z.number().int().min(1).max(CROP_STAGE_DAYS_MAX),
    jahreszeiten: z.array(z.enum(SEASON_IDS)).min(1),
    winterhart: z.boolean(),
    wasserbedarf: z.enum(WATER_NEEDS),
    ertrag: yieldSchema,
    saatErtrag: yieldSchema,
    nachwuchs: z
      .object({ stufe: z.number().int().min(1), ernten: z.number().int().min(2).max(HARVESTS_MAX) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if (c.saat !== `${SEED_PREFIX}${c.id}`) issue('saat', `the seed of ${c.id} is ${SEED_PREFIX}${c.id}`);
    if (new Set(c.jahreszeiten).size !== c.jahreszeiten.length) issue('jahreszeiten', 'seasons must be unique');
    if (c.nachwuchs !== undefined && c.nachwuchs.stufe >= c.stufen - 1) issue('nachwuchs', 'a crop that carries again falls back below its ripe stage');
  }) satisfies z.ZodType<CropDef>;

/** Crop data as written in the content files. */
export type CropInput = z.input<typeof cropSchema>;
/** A parsed crop (the zod output: what the registry stores; it satisfies `CropDef`). */
export type CropRecord = z.output<typeof cropSchema>;

/** Error in the crop content. */
export class CropContentError extends Error {
  override readonly name = 'CropContentError';
}

/** Validates the crops (schema, unique ids) and freezes them. */
export function defineCrops(records: readonly CropInput[]): readonly CropRecord[] {
  const seen = new Set<string>();
  const parsed = records.map((raw, index) => {
    const r = cropSchema.safeParse(raw);
    if (!r.success) throw new CropContentError(`Crop [${index}] "${raw.id}" invalid: ${r.error.issues.map((i) => `${i.path.map(String).join('.') || '(crop)'}: ${i.message}`).join('; ')}`);
    if (seen.has(r.data.id)) throw new CropContentError(`duplicate crop "${r.data.id}"`);
    seen.add(r.data.id);
    return r.data;
  });
  deepFreeze(parsed);
  return parsed;
}

/** The ripe stage of a crop (its last stage). */
export function ripeStage(crop: Pick<CropDef, 'stufen'>): number {
  return crop.stufen - 1;
}
