/**
 * Saved state of the beacons (docs/SPIEL.md §27 "`beacons` 1 | je Leuchtfeuer Zustand, `litTick`, Vision gezeigt"; participant
 * `beacons`, version 1): one record per beacon 1–6. A save without the participant (versions 1–3) loads with every beacon dark.
 */
import { z } from 'zod';
import { BEACON_STATES, type BeaconState } from './types';

/** No tick. */
export const NO_TICK = -1;

/** A dark beacon of a new world. */
export function createBeaconState(nummer: number): BeaconState {
  return { nummer, state: 'erloschen', ignitionTick: NO_TICK, litTick: NO_TICK, visionShown: false };
}

const tick = z.number().int().min(NO_TICK);
export const beaconRecordSchema = z
  .object({ nummer: z.number().int().min(1).max(6), state: z.enum(BEACON_STATES), ignitionTick: tick, litTick: tick, visionShown: z.boolean() })
  .strict() satisfies z.ZodType<BeaconState>;

/** The saved form (beacons 1–6 in order). */
export const beaconsSnapshotSchema = z
  .object({ beacons: z.array(beaconRecordSchema) })
  .strict()
  .superRefine((s, ctx) => {
    s.beacons.forEach((b, i) => {
      if (b.nummer !== i + 1) ctx.addIssue({ code: 'custom', path: ['beacons', i, 'nummer'], message: 'the beacons are saved in order 1–6' });
    });
  });
/** The saved form of the beacons. */
export type BeaconsSnapshot = z.output<typeof beaconsSnapshotSchema>;
