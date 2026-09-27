/**
 * Using an item (docs/SPIEL.md §3 "`player.useItem {slot}`"; MASTERPROMPT §11.4, §13.1; M3-15, M3-16).
 * `src/game/commands.ts` aggregates the schema.
 *
 * - `player.useItem {slot?}`: use the item in bag slot `slot` (absent: the item in the hand, i.e. the
 *   selected hotbar slot – the primary button, §26 "LMB") – food and drink are eaten (the actions system,
 *   like `action.eat`), a bandage stops bleeding, a bucket of water is poured out over the player, a torch
 *   or camp fire is set up on the aimed tile (the light system, like `light.place`), earth fills a dug tile
 *   back in (M4-40). With `tx`/`ty` the item is used on that tile (E on a use target: the tile must lie within
 *   reach), else on the aimed tile within reach or the tile ahead. Tools and weapons are used by working a
 *   target (`player.interact`), not by this command.
 */
import { z } from 'zod';
import { slotRefSchema } from '../inventory/commands';

export const playerUseItemCommandSchema = z
  .object({
    type: z.literal('player.useItem'),
    slot: slotRefSchema.optional(),
    /** Target tile; both absent = the aimed tile within reach, else the tile ahead. */
    tx: z.number().int().optional(),
    ty: z.number().int().optional(),
  })
  .strict()
  .refine((c) => (c.tx === undefined) === (c.ty === undefined), { message: 'tx and ty must be given together' });

/** Schemas of the item-use commands (aggregated by `gameCommandSchema`). */
export const TOOL_COMMAND_SCHEMAS = [playerUseItemCommandSchema] as const;
