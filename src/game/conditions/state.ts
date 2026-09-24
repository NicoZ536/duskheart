/**
 * Active conditions of the player (MASTERPROMPT §11.3): one record per condition, in content order.
 * Saved by the participant `conditions`.
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';

/** Remaining time of a condition without an end of its own (cured, or held by a survival value). */
export const UNTIMED = -1;

/** One active condition. */
export interface ActiveCondition {
  readonly id: string;
  /** Stacks (1 unless the stack rule is `stapeln`). */
  stacks: number;
  /** Remaining time [ticks]; `UNTIMED` for `heilung` and `wert` conditions. */
  remainingTicks: number;
  /** Ticks since the last pulse (`schub`). */
  pulseTicks: number;
  /** Damage over time not yet reported [HP] (reported once per second, at once when lethal or ending). */
  pendingDamage: number;
}

/** Saved active condition. */
export const activeConditionSchema = z
  .object({
    id: idSchema,
    stacks: z.number().int().min(1),
    remainingTicks: z.number().int().min(UNTIMED),
    pulseTicks: z.number().int().min(0),
    pendingDamage: z.number().min(0),
  })
  .strict();

/** Copy of an active condition (saves must not share the live record). */
export function copyActive(c: ActiveCondition): ActiveCondition {
  return { id: c.id, stacks: c.stacks, remainingTicks: c.remainingTicks, pulseTicks: c.pulseTicks, pendingDamage: c.pendingDamage };
}
