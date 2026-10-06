/**
 * Saved state of the world events (participant `world-events`, data version 1; docs/SPIEL.md §27): one `WorldEventState`
 * per event that runs in M7 – its phase and the ticks of its current run, the start minute that identifies the run –, the
 * runs each event already handled, the console's forced runs, the minute up to which lightning and the Lumen rain have
 * drawn, and whether the running rain's meteorite has fallen. The plan itself is a pure function of seed and day
 * (formulas.ts) and is not saved.
 */
import { z } from 'zod';
import { WORLD_EVENT_PHASES, type WorldEventState } from './types';

/** "Not set" in the tick fields. */
export const NO_TICK = -1;

/** A fresh state of event `id`: at rest. */
export function newWorldEventState(id: string): WorldEventState {
  return { id, phase: 'ruhe', announceTick: NO_TICK, startTick: NO_TICK, endTick: NO_TICK };
}

const tickOrNone = z.number().int().min(NO_TICK);

export const worldEventStateSchema = z
  .object({ id: z.string().min(1), phase: z.enum(WORLD_EVENT_PHASES), announceTick: tickOrNone, startTick: tickOrNone, endTick: tickOrNone })
  .strict()
  .refine((s) => s.phase === 'ruhe' || (s.startTick >= 0 && s.endTick >= s.startTick), { message: 'an announced or running event has its start and end' });

export const worldEventsSnapshotSchema = z
  .object({
    events: z.array(worldEventStateSchema),
    /** Start minute of the run of every announced or running event [absolute game minutes] – identifies it in the plan. */
    runStarts: z.record(z.string(), z.number()),
    /** Last whole game minute lightning and the Lumen rain have drawn (−1: none yet). */
    drawnMinute: z.number().int().min(-1),
    /** Whether the running Lumen rain's meteorite has come down. */
    meteorFallen: z.boolean(),
    /** Start minute of the last run each event handled (started or skipped), so a run never starts twice. */
    handled: z.record(z.string(), z.number()),
    /** Runs started from the console: they replace the plan until they end [absolute game minutes]. */
    forced: z.array(z.object({ event: z.string().min(1), start: z.number(), end: z.number() }).strict()),
  })
  .strict();
export type WorldEventsSnapshot = z.output<typeof worldEventsSnapshotSchema>;

/** Copies a state (snapshots never share objects with the live state). */
export function copyWorldEventState(s: Readonly<WorldEventState>): WorldEventState {
  return { id: s.id, phase: s.phase, announceTick: s.announceTick, startTick: s.startTick, endTick: s.endTick };
}
