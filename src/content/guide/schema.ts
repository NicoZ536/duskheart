/**
 * Funke comments and context hints (docs/SPIEL.md §17, §23; ADR-0207): the data of the observer `guide` (strand G).
 *
 * A hint speaks on its channel – `funke` (the lantern spirit, at most two lines in its box: validator rule `funke`) or
 * `hinweis` (the context line) – when its trigger holds; priority 3 (danger, world event announcements) goes before
 * everything else, `einmalig` hints speak once per world, the others again after `abklingSekunden`. Whoever introduces a
 * mechanic or an event that should be explained adds its hint in its own file `src/content/guide/<bereich>.ts`.
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema, type LocalizedText } from '../schema/common';
import { triggerSchema, type Trigger } from '../schema/trigger';

export const GUIDE_CHANNELS = ['funke', 'hinweis'] as const;
export type GuideChannel = (typeof GUIDE_CHANNELS)[number];
export interface GuideHintDef {
  readonly id: string;
  readonly kanal: GuideChannel;
  /** At most 2 lines in the Funke box (validator rule `funke`, measured with the pixel font). */
  readonly text: LocalizedText;
  readonly ausloeser: Trigger;
  /** 3 = danger and event announcements, before everything else. */
  readonly prioritaet: 1 | 2 | 3;
  readonly einmalig: boolean;
  readonly abklingSekunden?: number;
}

export const guideHintSchema = z
  .object({
    id: idSchema,
    kanal: z.enum(GUIDE_CHANNELS),
    text: localizedTextSchema,
    ausloeser: triggerSchema,
    prioritaet: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    einmalig: z.boolean(),
    abklingSekunden: z.number().positive().optional(),
  })
  .strict()
  .refine((h) => h.einmalig || h.abklingSekunden !== undefined, { message: 'a hint that speaks again needs abklingSekunden', path: ['abklingSekunden'] })
  .refine((h) => !h.einmalig || h.abklingSekunden === undefined, { message: 'a hint that speaks once has no abklingSekunden', path: ['abklingSekunden'] }) satisfies z.ZodType<GuideHintDef>;
/** One hint as written in the content files. */
export type GuideHintInput = z.input<typeof guideHintSchema>;
