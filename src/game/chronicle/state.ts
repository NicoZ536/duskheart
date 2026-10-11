/**
 * Saved state of the chronicle (participant `chronicle`, version 1; docs/SPIEL.md §27 "Einträge/Wissen"): the diary's entries
 * (the youngest `BALANCE.quests.chronicleMaxEntries`) and the next entry number, the one-time rules that have written, the
 * unlocked knowledge with its tick and the counters of the knowledge entries still waiting. A save without the participant
 * (versions 1–3) loads with an empty diary.
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';

const entrySchema = z
  .object({
    nr: z.number().int().min(1),
    tick: z.number().int().min(0),
    day: z.number().int().min(1),
    rule: idSchema,
    values: z.record(z.string().min(1), z.union([z.string(), z.number()])),
  })
  .strict();

export const chronicleSnapshotSchema = z
  .object({
    eintraege: z.array(entrySchema),
    naechste: z.number().int().min(1),
    einmalig: z.array(idSchema),
    wissen: z.array(z.object({ id: idSchema, tick: z.number().int().min(0) }).strict()),
    wartend: z.record(idSchema, z.array(z.number().int().min(0))),
  })
  .strict()
  .superRefine((s, ctx) => {
    for (let i = 1; i < s.eintraege.length; i++) {
      if ((s.eintraege[i] as { nr: number }).nr <= (s.eintraege[i - 1] as { nr: number }).nr) ctx.addIssue({ code: 'custom', path: ['eintraege', i], message: 'entries in ascending order' });
    }
    const last = s.eintraege[s.eintraege.length - 1];
    if (last !== undefined && s.naechste <= last.nr) ctx.addIssue({ code: 'custom', path: ['naechste'], message: 'the next number follows the last entry' });
  });
/** The saved form of the chronicle. */
export type ChronicleSnapshot = z.output<typeof chronicleSnapshotSchema>;

/** The chronicle of a world that has none yet. */
export function emptyChronicleSnapshot(): ChronicleSnapshot {
  return { eintraege: [], naechste: 1, einmalig: [], wissen: [], wartend: {} };
}
