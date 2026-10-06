/**
 * The unlock registry (docs/SPIEL.md §22 "Freischaltungen", MASTERPROMPT §23.1; ADR-0207; strand F, collection `unlocks`
 * = every row of §23.1, each `umgesetzt` or with the task that builds it). The zod schema producing `UnlockDef` is strand F's.
 */
import type { LocalizedText } from '../schema/common';

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
