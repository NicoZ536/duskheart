/**
 * Using an item (docs/SPIEL.md §3 "`player.useItem {slot}`"; MASTERPROMPT §11.4, §13.1; M3-15, M3-16).
 * `src/game/commands.ts` aggregates the schema.
 *
 * - `player.useItem {slot?}`: use the item in bag slot `slot` (absent: the item in the hand, i.e. the
 *   selected hotbar slot – the primary button, §26 "LMB") – food and drink are eaten (the actions system,
 *   like `action.eat`), a bandage stops bleeding, a bucket of water is poured out over the player, a torch
 *   or camp fire is set up on the aimed tile (the light system, like `light.place`). Tools and weapons are
 *   used by working a target (`player.interact`), not by this command.
 */
import { z } from 'zod';
import { slotRefSchema } from '../inventory/commands';

export const playerUseItemCommandSchema = z.object({ type: z.literal('player.useItem'), slot: slotRefSchema.optional() }).strict();

/** Schemas of the item-use commands (aggregated by `gameCommandSchema`). */
export const TOOL_COMMAND_SCHEMAS = [playerUseItemCommandSchema] as const;
