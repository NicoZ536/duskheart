/**
 * Commands of the bosses (aggregated by src/game/commands.ts; docs/SPIEL.md §22, §30 "Debug: `boss <id>`, `phase <n>`"):
 * - `boss.summon {boss}`: wakes a boss whose access is a summoning (`zugang.beschwoerung`) – the player stands in its arena
 *   with the item (E at the altar; the Borkenvater wakes by being approached, `betreten`).
 * - `boss.debug {boss, aktion, phase?}`: console – `wecken` (wake it where it stands, the player anywhere), `phase` (jump to
 *   phase `phase`: its threshold of health), `besiegen` (defeat it with loot), `zuruecksetzen` (reset the fight).
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';

/** What the console does with a boss. */
export const BOSS_DEBUG_ACTIONS = ['wecken', 'phase', 'besiegen', 'zuruecksetzen'] as const;

export const bossSummonCommandSchema = z.object({ type: z.literal('boss.summon'), boss: idSchema }).strict();
export const bossDebugCommandSchema = z
  .object({ type: z.literal('boss.debug'), boss: idSchema, aktion: z.enum(BOSS_DEBUG_ACTIONS), phase: z.number().int().min(0).optional() })
  .strict()
  .refine((c) => (c.aktion === 'phase') === (c.phase !== undefined), { message: 'exactly the action phase names a phase' });

/** Schemas of the boss commands (aggregated by `gameCommandSchema`). */
export const BOSS_COMMAND_SCHEMAS = [bossSummonCommandSchema, bossDebugCommandSchema] as const;
