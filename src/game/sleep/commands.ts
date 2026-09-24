/**
 * Commands of sleep (MASTERPROMPT §11.5; aggregated by src/game/commands.ts):
 * - `sleep.start {tx?, ty?}`: lie down in the bed on tile (tx, ty) (the interaction "E" on a bed), or –
 *   without a tile – roll out a sleeping bag from the bags.
 * - `sleep.wake {}`: get up before the morning (the player's own choice; no "Ausgeruht").
 */
import { z } from 'zod';

export const sleepStartCommandSchema = z
  .object({ type: z.literal('sleep.start'), tx: z.number().int().optional(), ty: z.number().int().optional() })
  .strict()
  .refine((c) => (c.tx === undefined) === (c.ty === undefined), { message: 'tx and ty must be given together' });

export const sleepWakeCommandSchema = z.object({ type: z.literal('sleep.wake') }).strict();

/** The command schemas of sleep. */
export const SLEEP_COMMAND_SCHEMAS = [sleepStartCommandSchema, sleepWakeCommandSchema] as const;
