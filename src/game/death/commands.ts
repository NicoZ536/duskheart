/**
 * Commands of death and respawn (MASTERPROMPT §11.6, §31.6; aggregated by src/game/commands.ts):
 * - `death.respawn {at?}`: from the death screen – back at the bed (`bett`), a lit beacon (`leuchtfeuer`)
 *   or the start beach (`strand`); without `at` at the bed if one is set, else on the beach.
 * - `death.lootGrave {grave}`: take what fits from a grave within reach (the interaction "E" on a grave).
 * - `death.kill {}`: debug – the player's light goes out at once (console `kill`, M3-35; tests).
 */
import { z } from 'zod';
import { RESPAWN_SPOTS } from './events';

export const deathRespawnCommandSchema = z.object({ type: z.literal('death.respawn'), at: z.enum(RESPAWN_SPOTS).optional() }).strict();
export const deathLootGraveCommandSchema = z.object({ type: z.literal('death.lootGrave'), grave: z.number().int().min(1) }).strict();
export const deathKillCommandSchema = z.object({ type: z.literal('death.kill') }).strict();

/** The command schemas of death and respawn. */
export const DEATH_COMMAND_SCHEMAS = [deathRespawnCommandSchema, deathLootGraveCommandSchema, deathKillCommandSchema] as const;
