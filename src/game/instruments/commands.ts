/**
 * Making music (M7-31; docs/SPIEL.md §24 "`instrument.play {from}` / `instrument.stop`"). `src/game/commands.ts` aggregates
 * the schemas.
 *
 * - `instrument.play {from, lied?}`: play the instrument in bag slot `from` – the song `lied` of its `instrument.lieder`, or
 *   the next of them (the songs take turns). The hand's primary use of an instrument (`player.useItem`) does the same.
 * - `instrument.stop {}`: stop playing.
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';
import { slotRefSchema } from '../inventory/commands';

export const instrumentPlayCommandSchema = z.object({ type: z.literal('instrument.play'), from: slotRefSchema, lied: idSchema.optional() }).strict();
export const instrumentStopCommandSchema = z.object({ type: z.literal('instrument.stop') }).strict();

/** Schemas of the instrument commands (aggregated by `gameCommandSchema`). */
export const INSTRUMENT_COMMAND_SCHEMAS = [instrumentPlayCommandSchema, instrumentStopCommandSchema] as const;
