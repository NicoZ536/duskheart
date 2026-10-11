/**
 * Commands of the quests (aggregated by src/game/commands.ts; docs/SPIEL.md §23 "Aufgaben", §30 "Debug: `quest <id> [schritt]`"):
 * - `quest.track {quest, on}`: follow an active quest in the HUD's tracker (at most `BALANCE.quests.trackedMax`) or stop.
 * - `quest.onboarding {on}`: the world's onboarding (`einstieg` quests) on or off – "jederzeit abschaltbar" (§23.3).
 * - `quest.debug {quest, schritt?}`: debug – starts the quest at step `schritt`, or completes its current step (console
 *   `quest <id> [schritt]`, the progression test of M7-64).
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';

export const questTrackCommandSchema = z.object({ type: z.literal('quest.track'), quest: idSchema, on: z.boolean() }).strict();
export const questOnboardingCommandSchema = z.object({ type: z.literal('quest.onboarding'), on: z.boolean() }).strict();
export const questDebugCommandSchema = z.object({ type: z.literal('quest.debug'), quest: idSchema, schritt: idSchema.optional() }).strict();

/** Schemas of the quest commands (aggregated by `gameCommandSchema`). */
export const QUEST_COMMAND_SCHEMAS = [questTrackCommandSchema, questOnboardingCommandSchema, questDebugCommandSchema] as const;
