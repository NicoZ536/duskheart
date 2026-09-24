/**
 * Commands of fear (aggregated by src/game/commands.ts): `fear.set {value}` sets the player's fear – the
 * debug console (M3-35), E2E tests and the screenshots of the HUD's fear eye and the stage effects use it.
 * The game itself changes fear only through its rules (src/game/fear/system.ts).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';

export const fearSetCommandSchema = z.object({ type: z.literal('fear.set'), value: z.number().min(0).max(BALANCE.fear.max) }).strict();

/** The command schemas of fear. */
export const FEAR_COMMAND_SCHEMAS = [fearSetCommandSchema] as const;
