/**
 * Commands of the beacons (aggregated by src/game/commands.ts; docs/SPIEL.md §22, §30 "Debug: `beacon <n>`"):
 * - `beacon.ignite {beacon}`: E at a beacon ready to be lit (its boss defeated): the ignition sequence begins.
 * - `beacon.visionSeen {beacon}`: the vision of a lit beacon was shown (its screen closed) – it does not open again.
 * - `beacon.debug {beacon, aktion}`: console – `bereit` (as if its boss fell), `entzuenden` (lit at once, with everything that
 *   follows), `loeschen` (dark again, unlocks and core stay).
 */
import { z } from 'zod';

const beacon = z.number().int().min(1).max(6);

/** What the console does with a beacon. */
export const BEACON_DEBUG_ACTIONS = ['bereit', 'entzuenden', 'loeschen'] as const;

export const beaconIgniteCommandSchema = z.object({ type: z.literal('beacon.ignite'), beacon }).strict();
export const beaconVisionSeenCommandSchema = z.object({ type: z.literal('beacon.visionSeen'), beacon }).strict();
export const beaconDebugCommandSchema = z.object({ type: z.literal('beacon.debug'), beacon, aktion: z.enum(BEACON_DEBUG_ACTIONS) }).strict();

/** Schemas of the beacon commands (aggregated by `gameCommandSchema`). */
export const BEACON_COMMAND_SCHEMAS = [beaconIgniteCommandSchema, beaconVisionSeenCommandSchema, beaconDebugCommandSchema] as const;
