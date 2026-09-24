/**
 * Commands of the condition system (MASTERPROMPT §31.6 debug console; aggregated by src/game/commands.ts).
 * Conditions arise from the game itself (falls, water, food, sleep, death); these commands give the debug
 * console (M3-35), E2E tests and screenshot scenarios direct access:
 *
 * - `conditions.apply {id, seconds?}`: applies a condition like the game does (its stack rule), for its
 *   own duration or `seconds`.
 * - `conditions.cure {id}`: ends an active condition as a cure would (bandage, splint, antidote).
 * Conditions that follow a survival value (hunger, cold …) are refused (`derivedCondition`).
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';

/** Longest duration a command may give [s] (one game day at the longest day length, §10). */
const MAX_SECONDS = 2880;

export const conditionsApplyCommandSchema = z
  .object({ type: z.literal('conditions.apply'), id: idSchema, seconds: z.number().positive().max(MAX_SECONDS).optional() })
  .strict();

export const conditionsCureCommandSchema = z.object({ type: z.literal('conditions.cure'), id: idSchema }).strict();

/** The command schemas of the condition system. */
export const CONDITION_COMMAND_SCHEMAS = [conditionsApplyCommandSchema, conditionsCureCommandSchema] as const;
