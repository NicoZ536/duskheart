/**
 * Chronicle rules and knowledge entries (docs/SPIEL.md §17, §23; ADR-0175): the data of the observer `chronicle` (strand G).
 *
 * - A **chronicle rule** turns a simulation event (`ereignis`, an event of `SIM_EVENT_TYPES` – checked by the validator) whose
 *   payload matches `wo` into a diary entry of kind `art`; its text names payload fields as `{feld}`, and `platzhalter` says
 *   which of them are content ids the UI names in the current language (an item, a creature, a place …). The entry stores
 *   only the rule and the values – the text is built in the UI (language switch without restart).
 * - A **knowledge entry** (Wissen tab) unlocks by a trigger: a mechanic met for the first time, a tablet read, a vision seen,
 *   a place discovered.
 * Each strand writes its rules into its own file `src/content/chronik/<bereich>.ts` and its knowledge into
 * `src/content/wissen/<bereich>.ts`; the collections are `chronicleRules` and `knowledge` (src/content/index.ts).
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema, type LocalizedText } from '../schema/common';
import { eventNameSchema, triggerFilterSchema, triggerSchema, type Trigger, type TriggerFilter } from '../schema/trigger';

export const CHRONICLE_KINDS = ['tagebuch', 'entdeckung', 'kampf', 'handwerk', 'welt', 'wissen'] as const;
export type ChronicleKind = (typeof CHRONICLE_KINDS)[number];
/** Placeholder kinds: content ids are named by the UI in the current language. */
export const CHRONICLE_VALUE_KINDS = ['item', 'kreatur', 'ort', 'boss', 'ereignis', 'rezept', 'zahl'] as const;
export type ChronicleValueKind = (typeof CHRONICLE_VALUE_KINDS)[number];
export interface ChronicleRuleDef {
  readonly id: string;
  readonly ereignis: string;
  readonly wo?: TriggerFilter;
  readonly art: ChronicleKind;
  /** Text with `{feld}` placeholders from the payload. */
  readonly text: LocalizedText;
  readonly platzhalter?: Readonly<Record<string, ChronicleValueKind>>;
  /** At most once per world. */
  readonly einmalig?: boolean;
}
/** Where a knowledge entry comes from. */
export const KNOWLEDGE_SOURCES = ['mechanik', 'tafel', 'vision', 'ort'] as const;
/** Knowledge entry (Wissen tab): mechanics, tablets, visions. */
export interface KnowledgeDef {
  readonly id: string;
  readonly titel: LocalizedText;
  readonly text: LocalizedText;
  readonly quelle: 'mechanik' | 'tafel' | 'vision' | 'ort';
  readonly freischaltung: Trigger;
}

/** `{feld}` placeholders of a text. */
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/** The placeholder names of `text`, sorted and unique. */
export function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as string))].sort();
}

export const chronicleRuleSchema = z
  .object({
    id: idSchema,
    ereignis: eventNameSchema,
    wo: triggerFilterSchema.optional(),
    art: z.enum(CHRONICLE_KINDS),
    text: localizedTextSchema,
    platzhalter: z.record(eventNameSchema, z.enum(CHRONICLE_VALUE_KINDS)).optional(),
    einmalig: z.boolean().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const de = placeholdersOf(r.text.de);
    const en = placeholdersOf(r.text.en);
    if (de.join(',') !== en.join(',')) ctx.addIssue({ code: 'custom', path: ['text'], message: `DE and EN name the same placeholders (de: ${de.join(', ')}; en: ${en.join(', ')})` });
    for (const key of Object.keys(r.platzhalter ?? {})) {
      if (!de.includes(key)) ctx.addIssue({ code: 'custom', path: ['platzhalter', key], message: `placeholder {${key}} does not occur in the text` });
    }
  }) satisfies z.ZodType<ChronicleRuleDef>;
/** One chronicle rule as written in the content files. */
export type ChronicleRuleInput = z.input<typeof chronicleRuleSchema>;

export const knowledgeSchema = z
  .object({
    id: idSchema,
    titel: localizedTextSchema,
    text: localizedTextSchema,
    quelle: z.enum(KNOWLEDGE_SOURCES),
    freischaltung: triggerSchema,
  })
  .strict() satisfies z.ZodType<KnowledgeDef>;
/** One knowledge entry as written in the content files. */
export type KnowledgeInput = z.input<typeof knowledgeSchema>;
