/**
 * Commands of the unlock registry (aggregated by src/game/commands.ts; docs/SPIEL.md §30 "Debug: `unlock <id>`"):
 * - `unlock.grant {unlock}`: debug – grants the unlock at once (source `debug`; the console `unlock <id>`, tests, the
 *   progression test of M7-64). In play the beacons, blueprints and research grant through `UnlockRegistry.grant`.
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';

export const unlockGrantCommandSchema = z.object({ type: z.literal('unlock.grant'), unlock: idSchema }).strict();

/** Schemas of the unlock commands (aggregated by `gameCommandSchema`). */
export const UNLOCK_COMMAND_SCHEMAS = [unlockGrantCommandSchema] as const;
