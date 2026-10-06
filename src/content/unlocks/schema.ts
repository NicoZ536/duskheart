/**
 * The unlock registry (docs/SPIEL.md §22 "Freischaltungen", MASTERPROMPT §23.1; ADR-0207; strand F, collection `unlocks`
 * = every row of §23.1, each `umgesetzt` or with the task that builds it). The zod schema producing `UnlockDef` is strand F's.
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema, type LocalizedText } from '../schema/common';

export const UNLOCK_KINDS = ['station', 'rezept', 'bauteil', 'licht', 'item', 'mechanik'] as const;
export type UnlockKind = (typeof UNLOCK_KINDS)[number];
export interface UnlockDef {
  /** `lf<n>_<ziel>` for beacon unlocks; `bp_<ziel>` for blueprint unlocks (C). */
  readonly id: string;
  readonly leuchtfeuer: 1 | 2 | 3 | 4 | 5 | 6 | null;
  readonly art: UnlockKind;
  /** Content id it unlocks (station, recipe, part, light kind, item) or the mechanic name. */
  readonly ziel: string;
  readonly name: LocalizedText;
  readonly umgesetzt: true | { readonly task: string };
}
// src/content/recipes/schema.ts (F, additive): freischaltung?: string – the recipe is shown and allowed only after this unlock.

/** A task id (`M11-14`). */
const taskSchema = z.string().regex(/^M\d+-\d+[a-z]?$/, { message: 'a task id like M11-14' });

export const unlockSchema = z
  .object({
    id: idSchema,
    leuchtfeuer: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.null()]),
    art: z.enum(UNLOCK_KINDS),
    ziel: idSchema,
    name: localizedTextSchema,
    umgesetzt: z.union([z.literal(true), z.object({ task: taskSchema }).strict()]),
  })
  .strict()
  .superRefine((u, ctx) => {
    if (u.leuchtfeuer !== null && !u.id.startsWith(`lf${u.leuchtfeuer}_`)) ctx.addIssue({ code: 'custom', path: ['id'], message: `an unlock of beacon ${u.leuchtfeuer} is named lf${u.leuchtfeuer}_<ziel>` });
  }) satisfies z.ZodType<UnlockDef>;
/** One unlock as written in the content files. */
export type UnlockInput = z.input<typeof unlockSchema>;
