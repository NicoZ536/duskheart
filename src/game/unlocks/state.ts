/**
 * Saved state of the unlock registry (participant `unlocks`, version 1; docs/SPIEL.md §27 "freigeschaltete Ids mit Tick und
 * Quelle"): the grants in the order they came. A save without the participant (versions 1–3) loads with none.
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';
import type { UnlockGrant, UnlockSource } from './types';

/** Pattern of a grant's source (`UnlockSource`). */
export const UNLOCK_SOURCE_PATTERN = /^(?:leuchtfeuer:[1-6]|bauplan:[a-z][a-z0-9_]*|forschung:[a-z][a-z0-9_]*|haendlerin|debug)$/;

/** Whether `value` is a well formed grant source. */
export function isUnlockSource(value: unknown): value is UnlockSource {
  return typeof value === 'string' && UNLOCK_SOURCE_PATTERN.test(value);
}

const grantSchema = z
  .object({ id: idSchema, tick: z.number().int().min(0), source: z.custom<UnlockSource>(isUnlockSource, { message: 'source must be leuchtfeuer:<n>, bauplan:<item>, forschung:<relikt>, haendlerin or debug' }) })
  .strict() satisfies z.ZodType<UnlockGrant>;

/** The saved form: every grant in grant order, each id once. */
export const unlocksSnapshotSchema = z
  .object({ granted: z.array(grantSchema) })
  .strict()
  .superRefine((s, ctx) => {
    const ids = s.granted.map((g) => g.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['granted'], message: 'every unlock is granted once' });
  });
/** The saved form of the registry. */
export type UnlocksSnapshot = z.output<typeof unlocksSnapshotSchema>;
