/**
 * Commands of spoilage (docs/SPIEL.md §30 "Debug: … spoil [stunden] – alle als Befehle (Replay)"), aggregated by
 * src/game/commands.ts.
 *
 * - `spoilage.advance {hours}` (debug console `spoil [stunden]`): every perishable stack of the bags and the active zone spoils
 *   `hours` game hours at once, with the factors of its place – a test of the shelf lives without waiting.
 */
import { z } from 'zod';

/** Most hours one debug `spoil` adds (a month). */
export const MAX_DEBUG_SPOIL_HOURS = 720;

export const spoilageAdvanceCommandSchema = z.object({ type: z.literal('spoilage.advance'), hours: z.number().int().min(1).max(MAX_DEBUG_SPOIL_HOURS) }).strict();

/** Schemas of the spoilage commands (aggregated by `gameCommandSchema`). */
export const SPOILAGE_COMMAND_SCHEMAS = [spoilageAdvanceCommandSchema] as const;
