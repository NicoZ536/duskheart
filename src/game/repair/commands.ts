/**
 * Repair command (MASTERPROMPT §13.1 "Reparatur an Werkbank, Amboss oder Schleifstein (anteilige
 * Materialkosten)"; M4-09). `src/game/commands.ts` aggregates the schema.
 *
 * - `repair.item {slot}`: mends the piece in bag or equipment slot `slot` to its full durability at a station
 *   in reach that repairs it, paying the materials from the bags and the chests in reach.
 */
import { z } from 'zod';
import { slotRefSchema } from '../inventory/commands';

export const repairItemCommandSchema = z.object({ type: z.literal('repair.item'), slot: slotRefSchema }).strict();

/** Schemas of the repair commands (aggregated by `gameCommandSchema`). */
export const REPAIR_COMMAND_SCHEMAS = [repairItemCommandSchema] as const;
