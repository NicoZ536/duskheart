/**
 * Beacons and visions (docs/SPIEL.md §22 "Leuchtfeuer", MASTERPROMPT §8, §23.1; ADR-0207; strand F, collections `beacons`
 * = `leuchtfeuer_1…6` in `BEACON_BIOMES` order, `visions`). The zod schemas producing these types are strand F's.
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema, refSchema, type LocalizedText } from '../schema/common';

export interface BeaconDef {
  readonly id: string;
  readonly nummer: 1 | 2 | 3 | 4 | 5 | 6;
  readonly biom: string;
  readonly boss: string;
  readonly glutkern: string;
  readonly freischaltungen: readonly string[];
  readonly vision: string;
  /**
   * Additive (F): `true` when the beacon is playable – its boss, ember core and vision exist –, else the task that brings
   * them (LF2 M8-44 …); the validator rule `boss` checks the references of exactly the playable ones.
   */
  readonly umgesetzt: true | { readonly task: string };
  /** Additive (F): name of the beacon (travel screen, map, chronicle). */
  readonly name: LocalizedText;
}
export interface VisionDef {
  readonly id: string;
  readonly bilder: readonly { readonly sprite: string; readonly zeilen: readonly LocalizedText[]; readonly sekunden: number }[];
}

/** A task id (`M8-44`). */
const taskSchema = z.string().regex(/^M\d+-\d+[a-z]?$/, { message: 'a task id like M8-44' });

export const beaconSchema = z
  .object({
    id: idSchema,
    nummer: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
    biom: refSchema,
    boss: idSchema,
    glutkern: idSchema,
    freischaltungen: z.array(refSchema).min(1),
    vision: idSchema,
    umgesetzt: z.union([z.literal(true), z.object({ task: taskSchema }).strict()]),
    name: localizedTextSchema,
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.id !== `leuchtfeuer_${b.nummer}`) ctx.addIssue({ code: 'custom', path: ['id'], message: `beacon ${b.nummer} is leuchtfeuer_${b.nummer}` });
    if (b.glutkern !== `glutkern_${b.nummer}`) ctx.addIssue({ code: 'custom', path: ['glutkern'], message: `beacon ${b.nummer} gives glutkern_${b.nummer} (BALANCE.hearth.coreItems)` });
  }) satisfies z.ZodType<BeaconDef>;
/** One beacon as written in the content files. */
export type BeaconInput = z.input<typeof beaconSchema>;

/** Most lines of a still (the vision screen shows them under the picture). */
const VISION_LINES_MAX = 3;

export const visionSchema = z
  .object({
    id: idSchema,
    bilder: z
      .array(
        z
          .object({
            /** The pixel still (`vision_<n>_<k>`, assets-src/sprites/visionen/). */
            sprite: idSchema,
            zeilen: z.array(localizedTextSchema).min(1).max(VISION_LINES_MAX),
            /** How long it shows before the next one [s]. */
            sekunden: z.number().positive(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict() satisfies z.ZodType<VisionDef>;
/** One vision as written in the content files. */
export type VisionInput = z.input<typeof visionSchema>;
