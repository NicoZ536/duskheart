/**
 * Debug cheats of the console (MASTERPROMPT §31.6 "god, noclip, unlock"; M3-35; aggregated by
 * src/game/commands.ts). Like every console command that changes the world they are game commands:
 * validated, applied in the next tick, recorded for replays.
 *
 * - `debug.god {on}`: the player takes no damage.
 * - `debug.noclip {on}`: the player walks through walls, cliffs, trees and deep water.
 * - `debug.unlock {skill?}`: every skill – or `skill` – at its highest level at once (Grundform, M3).
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';

export const debugGodCommandSchema = z.object({ type: z.literal('debug.god'), on: z.boolean() }).strict();
export const debugNoclipCommandSchema = z.object({ type: z.literal('debug.noclip'), on: z.boolean() }).strict();
export const debugUnlockCommandSchema = z.object({ type: z.literal('debug.unlock'), skill: idSchema.optional() }).strict();

/** The command schemas of the debug cheats. */
export const DEBUG_COMMAND_SCHEMAS = [debugGodCommandSchema, debugNoclipCommandSchema, debugUnlockCommandSchema] as const;
