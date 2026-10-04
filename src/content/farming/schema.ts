/**
 * Crops (docs/SPIEL.md §20, MASTERPROMPT §17; ADR-0175; strand D, collection `crops`, §C "Nutzpflanzen"): what grows on a
 * field – stages, days per stage, seasons, frost hardiness, water need, yields and regrowth. The zod schema producing
 * `CropDef` is strand D's.
 */
import type { SeasonId } from '../balance';

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
