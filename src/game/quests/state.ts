/**
 * Saved state of the quests (participant `quests`, version 1; docs/SPIEL.md §27 "Aufgaben/Schritte/Zähler/verfolgt/Einstieg an"):
 * every started quest with its status, current step and the counters of that step's trigger, its start tick and whether it is
 * tracked; the counters of the start triggers still waiting; the world's onboarding switch. A save without the participant
 * (versions 1–3) loads with no quest started and the onboarding on – the quests begin at the next step.
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';
import { QUEST_STATUS } from './types';

const questSchema = z
  .object({
    quest: idSchema,
    status: z.enum(QUEST_STATUS),
    step: z.number().int().min(0),
    counts: z.array(z.number().int().min(0)),
    startedTick: z.number().int().min(0),
    tracked: z.boolean(),
  })
  .strict();

export const questsSnapshotSchema = z
  .object({
    aufgaben: z.array(questSchema),
    startWartend: z.record(idSchema, z.array(z.number().int().min(0))),
    einstieg: z.boolean(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = s.aufgaben.map((q) => q.quest);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['aufgaben'], message: 'every quest once' });
  });
/** The saved form of the quests. */
export type QuestsSnapshot = z.output<typeof questsSnapshotSchema>;

/** The quests of a world that has none yet: nothing started, onboarding on. */
export function emptyQuestsSnapshot(): QuestsSnapshot {
  return { aufgaben: [], startWartend: {}, einstieg: true };
}
