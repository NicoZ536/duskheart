/**
 * Skills of the player (MASTERPROMPT §23.2): level, progress within the level and the perk choices of each
 * skill. Saved by the participant `skills`.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';

const K = BALANCE.skills;

/** A perk choice at a perk level: open (`choice` null) or taken (index of the chosen perk). */
export interface PerkChoice {
  readonly level: number;
  choice: number | null;
}

/** One skill of the player. */
export interface SkillState {
  level: number;
  /** XP within the current level. */
  xp: number;
  /** Perk choices reached, in level order. */
  perks: PerkChoice[];
}

/** A new character's skill: level 1, no progress. */
export function createSkillState(): SkillState {
  return { level: K.minLevel, xp: 0, perks: [] };
}

/** Saved skill. */
export const skillStateSchema = z
  .object({
    level: z.number().int().min(K.minLevel).max(K.maxLevel),
    xp: z.number().min(0),
    perks: z.array(
      z
        .object({
          level: z.number().int(),
          choice: z
            .number()
            .int()
            .min(0)
            .max(K.perkChoices - 1)
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict();

/** Copy of a skill (saves must not share the live object). */
export function copySkillState(s: SkillState): SkillState {
  return { level: s.level, xp: s.xp, perks: s.perks.map((p) => ({ ...p })) };
}
