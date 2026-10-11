/**
 * Saved state of the guide (participant `guide`, version 1; docs/SPIEL.md §27 "gegebene Hinweise, Abklingzeiten, Schalter"): the
 * one-time hints given, the hints cooling down until a tick, the counters of the hints waiting, the queue of each channel, what
 * shows now (a comment, a dialog's line, a hint) and when each channel last spoke, the switches. A save without the participant
 * (versions 1–3) loads with nothing said and both channels on.
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';
import { GUIDE_CHANNELS } from '../../content/guide/schema';

const tickSchema = z.number().int().min(0);

export const guideSnapshotSchema = z
  .object({
    gesagt: z.array(idSchema),
    abklingen: z.record(idSchema, tickSchema),
    wartend: z.record(idSchema, z.array(z.number().int().min(0))),
    warteschlange: z.array(z.object({ hint: idSchema, kanal: z.enum(GUIDE_CHANNELS), seit: tickSchema, dialog: z.boolean() }).strict()),
    funke: z.object({ id: idSchema, zeile: z.number().int().min(-1), bis: tickSchema }).strict().nullable(),
    hinweis: z.object({ id: idSchema, bis: tickSchema }).strict().nullable(),
    zuletzt: z.object({ funke: z.number().int(), hinweis: z.number().int() }).strict(),
    schalter: z.object({ funke: z.boolean(), hints: z.boolean() }).strict(),
  })
  .strict();
/** The saved form of the guide. */
export type GuideSnapshot = z.output<typeof guideSnapshotSchema>;

/** Last speaking tick of a channel that never spoke (far enough back that the first comment may come at once). */
export const NEVER_SPOKE = -1_000_000_000;

/** The guide of a world that has said nothing yet. */
export function emptyGuideSnapshot(): GuideSnapshot {
  return { gesagt: [], abklingen: {}, wartend: {}, warteschlange: [], funke: null, hinweis: null, zuletzt: { funke: NEVER_SPOKE, hinweis: NEVER_SPOKE }, schalter: { funke: true, hints: true } };
}
