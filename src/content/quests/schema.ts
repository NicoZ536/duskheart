/**
 * Quests, dialogs and achievements (docs/SPIEL.md §23, MASTERPROMPT §23; ADR-0207; strand G – collections `quests`,
 * `dialogs`, `achievements`): main, side and onboarding quests whose steps advance by triggers (src/content/schema/trigger.ts)
 * with a hint and a map marker; dialogs of Funke, settlers and the trader (`src/content/dialoge/`; a missing EN text is a
 * schema error); the 15 local achievements of M7. The zod schemas producing these types are strand G's (below).
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema, type LocalizedText } from '../schema/common';
import { triggerSchema, type Trigger } from '../schema/trigger';

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

/** Deepest world layer a point marker may name (docs/WORLD.md §1: surface 0, caves −1 … −3). */
const LAYER_MIN = -3;
/** Beacons of §23.1 (one per biome). */
const BEACON_COUNT = 6;

export const questMarkerSchema = z.discriminatedUnion('art', [
  z.object({ art: z.literal('ort'), ortstyp: idSchema, variante: idSchema.optional() }).strict(),
  z.object({ art: z.literal('leuchtfeuer'), nummer: z.number().int().min(1).max(BEACON_COUNT) }).strict(),
  z.object({ art: z.literal('boss'), boss: idSchema }).strict(),
  z.object({ art: z.literal('punkt'), layer: z.number().int().min(LAYER_MIN).max(0), tx: z.number().int().min(0), ty: z.number().int().min(0) }).strict(),
]) satisfies z.ZodType<QuestMarker>;

export const questStepSchema = z
  .object({
    id: idSchema,
    titel: localizedTextSchema,
    hinweis: localizedTextSchema,
    ausloeser: triggerSchema,
    marker: questMarkerSchema.optional(),
    dialog: idSchema.optional(),
  })
  .strict() satisfies z.ZodType<QuestStepDef>;

export const questSchema = z
  .object({
    id: idSchema,
    art: z.enum(QUEST_KINDS),
    titel: localizedTextSchema,
    beschreibung: localizedTextSchema,
    akt: z.number().int().min(1).optional(),
    start: triggerSchema.optional(),
    schritte: z.array(questStepSchema).min(1),
    belohnung: z
      .object({
        items: z.array(z.object({ item: idSchema, anzahl: z.number().int().min(1) }).strict()).min(1).optional(),
        freischaltung: idSchema.optional(),
        wissen: idSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    const ids = q.schritte.map((s) => s.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['schritte'], message: 'every step id once' });
    if (q.art === 'haupt' && q.akt === undefined) ctx.addIssue({ code: 'custom', path: ['akt'], message: 'a main quest names its act' });
  }) satisfies z.ZodType<QuestDef>;
/** One quest as written in the content files. */
export type QuestInput = z.input<typeof questSchema>;

export const dialogSchema = z
  .object({
    id: idSchema,
    sprecher: z.enum(DIALOG_SPEAKERS),
    zeilen: z.array(localizedTextSchema).min(1),
    antworten: z.array(z.object({ text: localizedTextSchema, weiter: idSchema.optional() }).strict()).min(1).optional(),
  })
  .strict() satisfies z.ZodType<DialogDef>;
/** One dialog as written in the content files. */
export type DialogInput = z.input<typeof dialogSchema>;

export const achievementSchema = z
  .object({ id: idSchema, name: localizedTextSchema, beschreibung: localizedTextSchema, ausloeser: triggerSchema, geheim: z.boolean().optional() })
  .strict() satisfies z.ZodType<AchievementDef>;
/** One achievement as written in the content files. */
export type AchievementInput = z.input<typeof achievementSchema>;

/** Sprite id of an achievement's symbol (`erfolg_<id>`, docs/SPIEL.md §23). */
export function achievementIconId(id: string): string {
  return `erfolg_${id}`;
}
