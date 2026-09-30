/**
 * Combat commands (docs/SPIEL.md §10 "Eingabe (M6-02)"; MASTERPROMPT §19.1, §26 "LMB/RT Angriff, RMB/LT Block/Zielen").
 * `src/game/commands.ts` aggregates the schemas. Both carry the held state of their button, sent on every change by
 * the input layer (src/game/input.ts) and applied in the next tick – no buffer across frames.
 *
 * - `combat.attack {on}`: the attack button pressed (`true`) or released (`false`). A press winds up a blow with the item
 *   in the hand (or the fist); released before `BALANCE.combat.attack.heavyHoldSeconds` it lands as a light blow (the
 *   next of a combo within the combo window), held longer it lands as the weapon's heavy attack on release. A bow, a
 *   sling or a thrown weapon draws while held and shoots on release (damage × tension); a crossbow shoots its loaded
 *   bolt on the press, or starts reloading.
 * - `combat.block {on}`: the block button held (`true`) or let go. With a shield in the off hand or a melee weapon, a
 *   tool or the fists it blocks – begun at most `BALANCE.combat.parry.windowSeconds` before a blow, it parries; with a
 *   ranged weapon it aims (steadier hand, slower walk).
 */
import { z } from 'zod';

export const combatAttackCommandSchema = z.object({ type: z.literal('combat.attack'), on: z.boolean() }).strict();

export const combatBlockCommandSchema = z.object({ type: z.literal('combat.block'), on: z.boolean() }).strict();

/** Schemas of the combat commands (aggregated by `gameCommandSchema`). */
export const COMBAT_COMMAND_SCHEMAS = [combatAttackCommandSchema, combatBlockCommandSchema] as const;
