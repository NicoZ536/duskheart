/**
 * Events of the chronicle (aggregated into `SimEventMap`; docs/SPIEL.md §17 "Ereignisse zwischen Strängen"):
 * - `chronicleEntryAdded {entry, art, regel}`: a chronicle rule wrote diary entry number `entry` of kind `art` – the UI marks
 *   the chronicle as new.
 * - `knowledgeUnlocked {wissen, quelle}`: a knowledge entry's trigger held – the Wissen tab shows it, the UI announces it.
 */
import type { ChronicleKind } from '../../content/chronik/schema';

export interface ChronicleEventMap {
  chronicleEntryAdded: { readonly entry: number; readonly art: ChronicleKind; readonly regel: string; readonly tick: number };
  knowledgeUnlocked: { readonly wissen: string; readonly quelle: 'mechanik' | 'tafel' | 'vision' | 'ort'; readonly tick: number };
}

/** Event names of `ChronicleEventMap`. */
export const CHRONICLE_EVENT_TYPES = ['chronicleEntryAdded', 'knowledgeUnlocked'] as const satisfies ReadonlyArray<keyof ChronicleEventMap>;

/** Sound of new knowledge (src/content/sfx/chronik.ts). */
export const CHRONICLE_SFX = { knowledge: 'sfx_chronik_wissen' } as const;
