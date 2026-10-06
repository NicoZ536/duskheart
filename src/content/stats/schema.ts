/**
 * Statistics, their sources and the milestones (docs/SPIEL.md §17, §23; ADR-0207): the data of the observer `stats`
 * (strand G).
 *
 * - A **statistic** (`stats`) is a counter – per key when `geschluesselt` (kills per creature, harvested per crop) – in pieces,
 *   ticks or tiles; G defines the statistics of §29 (`spielzeit`, `tage`, `kills` …).
 * - A **statistic source** (`statSources`) adds to a statistic for every matching event: 1, or the payload field `wert`;
 *   `schluessel` names the payload field that keys a keyed statistic. Whoever introduces an event adds the source where it
 *   should be counted, in its own file `src/content/stats/<bereich>.ts`.
 * - A **milestone** (`milestones`) records the first tick its trigger holds (first camp fire, first bronze, the Borkenvater,
 *   LF1 …) for the pacing measurement (`zielStunden`, docs/BALANCE.md).
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema, type LocalizedText } from '../schema/common';
import { eventNameSchema, triggerFilterSchema, triggerSchema, type Trigger, type TriggerFilter } from '../schema/trigger';

/** Units of a statistic. */
export const STAT_UNITS = ['anzahl', 'ticks', 'kacheln'] as const;
export interface StatDef {
  readonly id: string;
  readonly name: LocalizedText;
  readonly einheit: 'anzahl' | 'ticks' | 'kacheln';
  /** Counted per key (kills per creature, harvested per crop). */
  readonly geschluesselt: boolean;
}
/** Event → counter (`schluessel`: payload field that keys the counter; `wert`: payload field added instead of 1). */
export interface StatSourceDef {
  readonly id: string;
  readonly statistik: string;
  readonly ereignis: string;
  readonly wo?: TriggerFilter;
  readonly schluessel?: string;
  readonly wert?: string;
}
/** First tick of a milestone (pacing, §23.1, docs/BALANCE.md). */
export interface MilestoneDef {
  readonly id: string;
  readonly name: LocalizedText;
  readonly ausloeser: Trigger;
  readonly zielStunden?: number;
}

export const statSchema = z
  .object({ id: idSchema, name: localizedTextSchema, einheit: z.enum(STAT_UNITS), geschluesselt: z.boolean() })
  .strict() satisfies z.ZodType<StatDef>;
/** One statistic as written in the content files. */
export type StatInput = z.input<typeof statSchema>;

export const statSourceSchema = z
  .object({
    id: idSchema,
    statistik: idSchema,
    ereignis: eventNameSchema,
    wo: triggerFilterSchema.optional(),
    schluessel: eventNameSchema.optional(),
    wert: eventNameSchema.optional(),
  })
  .strict() satisfies z.ZodType<StatSourceDef>;
/** One statistic source as written in the content files. */
export type StatSourceInput = z.input<typeof statSourceSchema>;

export const milestoneSchema = z
  .object({ id: idSchema, name: localizedTextSchema, ausloeser: triggerSchema, zielStunden: z.number().positive().optional() })
  .strict() satisfies z.ZodType<MilestoneDef>;
/** One milestone as written in the content files. */
export type MilestoneInput = z.input<typeof milestoneSchema>;
