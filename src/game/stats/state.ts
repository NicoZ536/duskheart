/**
 * Saved state of the statistics (participant `stats`, version 1; docs/SPIEL.md §27 "Zähler/Meilensteine"): every counter
 * that is not 0 (its sum and, for a keyed statistic, the value per key), the play time [ticks of play] every milestone was
 * reached at, the
 * counters of the milestones still waiting, and the player's last position for the walked distance. A save without the
 * participant (versions 1–3) loads with everything at 0.
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';

const counterSchema = z
  .object({
    summe: z.number().min(0),
    schluessel: z.record(z.string().min(1), z.number().min(0)).optional(),
  })
  .strict();

/** The saved form of the statistics. */
export const statsSnapshotSchema = z
  .object({
    werte: z.record(idSchema, counterSchema),
    meilensteine: z.record(idSchema, z.number().int().min(0)),
    wartend: z.record(idSchema, z.array(z.number().int().min(0))),
    letzte: z.object({ x: z.number(), y: z.number(), layer: z.number().int() }).strict().nullable(),
  })
  .strict();
/** The saved form of the statistics. */
export type StatsSnapshot = z.output<typeof statsSnapshotSchema>;

/** Statistics of a world that has none yet. */
export function emptyStatsSnapshot(): StatsSnapshot {
  return { werte: {}, meilensteine: {}, wartend: {}, letzte: null };
}
