/**
 * The trigger language (docs/SPIEL.md §17 "Auslöser-Sprache", ADR-0207): one way for quest steps, achievements, Funke and
 * context hints, knowledge entries, milestones and the mechanics register to say "when".
 *
 * - `ereignis`: a simulation event (`ereignis` = an event name of `SIM_EVENT_TYPES`, checked by the validator – the
 *   content layer does not import the game) whose payload matches the flat filter `wo` (every listed field equal),
 *   `anzahl` times (default 1), counted from the moment the trigger is armed (a step active, an achievement open).
 * - State-like triggers, checked on the world tick (1 Hz) and after every matching event: `statistik` (a statistic, per
 *   key, at least), `besitz` (pieces in bags and equipment), `zustand` (a condition active), `uhr` (day, before/from an
 *   hour), `lichtstufe` (light stage at the player), `raum` (indoors, room type), `freischaltung` (granted),
 *   `aufgabe` (a quest or step active or done), `ort` (places of a type discovered).
 * - Combinations `alle`, `eines`, `nicht`.
 * The evaluator lives in src/game/triggers/ (strand G); content ids inside triggers are checked by the validator rule
 * `ausloeser`.
 */
import { z } from 'zod';
import { idSchema } from './common';

/** Flat payload filter of an event trigger: every listed field must be equal. */
export type TriggerFilter = Readonly<Record<string, string | number | boolean>>;

/** The one trigger language of quests, achievements, hints, knowledge, milestones and the mechanics register (docs/SPIEL.md §17). */
export type Trigger =
  | { readonly art: 'ereignis'; readonly ereignis: string; readonly wo?: TriggerFilter; readonly anzahl?: number }
  | { readonly art: 'statistik'; readonly statistik: string; readonly schluessel?: string; readonly mindestens: number }
  | { readonly art: 'besitz'; readonly item: string; readonly anzahl: number }
  | { readonly art: 'zustand'; readonly zustand: string }
  | { readonly art: 'uhr'; readonly tag?: number; readonly vorStunde?: number; readonly abStunde?: number }
  | { readonly art: 'lichtstufe'; readonly hoechstens?: number; readonly mindestens?: number }
  | { readonly art: 'raum'; readonly innen?: boolean; readonly raumtyp?: string }
  | { readonly art: 'freischaltung'; readonly freischaltung: string }
  | { readonly art: 'aufgabe'; readonly aufgabe: string; readonly schritt?: string; readonly status: 'aktiv' | 'erledigt' }
  | { readonly art: 'ort'; readonly ortstyp: string; readonly anzahl?: number }
  | { readonly art: 'alle'; readonly von: readonly Trigger[] }
  | { readonly art: 'eines'; readonly von: readonly Trigger[] }
  | { readonly art: 'nicht'; readonly von: Trigger };
/** Trigger kinds (the discriminator values above). */
export const TRIGGER_KINDS = ['ereignis', 'statistik', 'besitz', 'zustand', 'uhr', 'lichtstufe', 'raum', 'freischaltung', 'aufgabe', 'ort', 'alle', 'eines', 'nicht'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/** Hours of a day (`uhr`: `vorStunde`, `abStunde` lie in 0 … 24). */
const HOURS_PER_DAY = 24;
/** Event names and payload fields are lowerCamelCase identifiers (`placeDiscovered`, `ortstyp`). */
const EVENT_NAME = /^[a-z][a-zA-Z0-9]*$/;

/** An event name or payload field (lowerCamelCase); event names are checked against `SIM_EVENT_TYPES` by the validator. */
export const eventNameSchema = z.string().regex(EVENT_NAME, { message: 'event name must be lowerCamelCase (an event of SIM_EVENT_TYPES)' });
const countSchema = z.number().int().min(1);

/** Schema of a payload filter: field → the value it must equal. */
export const triggerFilterSchema = z.record(eventNameSchema, z.union([z.string(), z.number(), z.boolean()]));

const hourSchema = z.number().min(0).max(HOURS_PER_DAY);

/** Schema of a trigger (recursive through `alle`, `eines`, `nicht`). */
export const triggerSchema: z.ZodType<Trigger> = z.lazy(() =>
  z.discriminatedUnion('art', [
    z.object({ art: z.literal('ereignis'), ereignis: eventNameSchema, wo: triggerFilterSchema.optional(), anzahl: countSchema.optional() }).strict(),
    z.object({ art: z.literal('statistik'), statistik: idSchema, schluessel: z.string().min(1).optional(), mindestens: z.number().min(0) }).strict(),
    z.object({ art: z.literal('besitz'), item: idSchema, anzahl: countSchema }).strict(),
    z.object({ art: z.literal('zustand'), zustand: idSchema }).strict(),
    z
      .object({ art: z.literal('uhr'), tag: countSchema.optional(), vorStunde: hourSchema.optional(), abStunde: hourSchema.optional() })
      .strict()
      .refine((t) => t.tag !== undefined || t.vorStunde !== undefined || t.abStunde !== undefined, { message: 'uhr needs tag, vorStunde or abStunde' }),
    z
      .object({ art: z.literal('lichtstufe'), hoechstens: z.number().min(0).optional(), mindestens: z.number().min(0).optional() })
      .strict()
      .refine((t) => t.hoechstens !== undefined || t.mindestens !== undefined, { message: 'lichtstufe needs hoechstens or mindestens' }),
    z
      .object({ art: z.literal('raum'), innen: z.boolean().optional(), raumtyp: idSchema.optional() })
      .strict()
      .refine((t) => t.innen !== undefined || t.raumtyp !== undefined, { message: 'raum needs innen or raumtyp' }),
    z.object({ art: z.literal('freischaltung'), freischaltung: idSchema }).strict(),
    z.object({ art: z.literal('aufgabe'), aufgabe: idSchema, schritt: idSchema.optional(), status: z.enum(['aktiv', 'erledigt']) }).strict(),
    z.object({ art: z.literal('ort'), ortstyp: idSchema, anzahl: countSchema.optional() }).strict(),
    z.object({ art: z.literal('alle'), von: z.array(triggerSchema).min(1) }).strict(),
    z.object({ art: z.literal('eines'), von: z.array(triggerSchema).min(1) }).strict(),
    z.object({ art: z.literal('nicht'), von: triggerSchema }).strict(),
  ]),
);

/** Calls `visit` for `trigger` and every trigger nested in it (depth first, the outer one first) – the validator's walk. */
export function forEachTrigger(trigger: Trigger, visit: (t: Trigger) => void): void {
  visit(trigger);
  if (trigger.art === 'alle' || trigger.art === 'eines') for (const t of trigger.von) forEachTrigger(t, visit);
  else if (trigger.art === 'nicht') forEachTrigger(trigger.von, visit);
}
