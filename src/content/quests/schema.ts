/**
 * Quests, dialogs and achievements (docs/SPIEL.md §23, MASTERPROMPT §23; ADR-0207; strand G – collections `quests`,
 * `dialogs`, `achievements`): main, side and onboarding quests whose steps advance by triggers (src/content/schema/trigger.ts)
 * with a hint and a map marker; dialogs of Funke, settlers and the trader (`src/content/dialoge/`; a missing EN text is a
 * schema error); the 15 local achievements of M7. The zod schemas producing these types are strand G's.
 */
import type { LocalizedText } from '../schema/common';
import type { Trigger } from '../schema/trigger';

export const QUEST_KINDS = ['haupt', 'neben', 'einstieg'] as const;
export type QuestKind = (typeof QUEST_KINDS)[number];
export type QuestMarker =
  | { readonly art: 'ort'; readonly ortstyp: string; readonly variante?: string }
  | { readonly art: 'leuchtfeuer'; readonly nummer: number }
  | { readonly art: 'boss'; readonly boss: string }
  | { readonly art: 'punkt'; readonly layer: number; readonly tx: number; readonly ty: number };
export interface QuestStepDef {
  readonly id: string;
  readonly titel: LocalizedText;
  readonly hinweis: LocalizedText;
  readonly ausloeser: Trigger;
  readonly marker?: QuestMarker;
  readonly dialog?: string;
}
export interface QuestDef {
  readonly id: string;
  readonly art: QuestKind;
  readonly titel: LocalizedText;
  readonly beschreibung: LocalizedText;
  readonly akt?: number;
  /** Starts by itself once this holds (absent: at world start). */
  readonly start?: Trigger;
  readonly schritte: readonly QuestStepDef[];
  readonly belohnung?: { readonly items?: readonly { readonly item: string; readonly anzahl: number }[]; readonly freischaltung?: string; readonly wissen?: string };
}
export const DIALOG_SPEAKERS = ['funke', 'siedler', 'haendlerin'] as const;
export type DialogSpeaker = (typeof DIALOG_SPEAKERS)[number];
/** Dialogs in src/content/dialoge/ (missing EN text ⇒ schema error). */
export interface DialogDef {
  readonly id: string;
  readonly sprecher: DialogSpeaker;
  readonly zeilen: readonly LocalizedText[];
  readonly antworten?: readonly { readonly text: LocalizedText; readonly weiter?: string }[];
}
export interface AchievementDef {
  readonly id: string;
  readonly name: LocalizedText;
  readonly beschreibung: LocalizedText;
  readonly ausloeser: Trigger;
  readonly geheim?: boolean;
}
