/**
 * Saved state of the achievements (participant `achievements`, version 1; docs/SPIEL.md §27 "Erfolge"): the unlocked ones with
 * their tick and play time, in unlock order, and the counters of the open ones whose event parts already counted. A save without the
 * participant (versions 1–3) loads with every achievement open.
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';

export const achievementsSnapshotSchema = z
  .object({
    erreicht: z.array(z.object({ id: idSchema, tick: z.number().int().min(0), spielzeit: z.number().int().min(0) }).strict()),
    wartend: z.record(idSchema, z.array(z.number().int().min(0))),
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = s.erreicht.map((a) => a.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['erreicht'], message: 'every achievement is unlocked once' });
  });
/** The saved form of the achievements. */
export type AchievementsSnapshot = z.output<typeof achievementsSnapshotSchema>;
