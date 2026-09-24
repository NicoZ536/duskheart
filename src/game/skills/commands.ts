/**
 * Commands of the skills (MASTERPROMPT §23.2; aggregated by src/game/commands.ts): `skills.choosePerk
 * {skill, level, choice}` takes perk `choice` (0 or 1) of the open choice of `skill` at perk level `level`
 * (30, 60, 90). The perks behind the choices follow with their content.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { idSchema } from '../../content/schema/common';

const K = BALANCE.skills;

export const skillsChoosePerkCommandSchema = z
  .object({
    type: z.literal('skills.choosePerk'),
    skill: idSchema,
    level: z.number().int().min(K.minLevel).max(K.maxLevel),
    choice: z
      .number()
      .int()
      .min(0)
      .max(K.perkChoices - 1),
  })
  .strict();

/** The command schemas of the skills. */
export const SKILL_COMMAND_SCHEMAS = [skillsChoosePerkCommandSchema] as const;
