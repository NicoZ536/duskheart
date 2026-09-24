/**
 * Crafting commands (docs/SPIEL.md §3 "`craft.start …`"; MASTERPROMPT §15.1 "Mengenwahl, Warteschlange
 * (10), Abbrechen erstattet vollständig", "Kisten im Umkreis von 8 Tiles (abschaltbar)"; M3-16).
 * `src/game/commands.ts` aggregates the schemas.
 *
 * - `craft.start {recipe, count}`: queue `count` pieces of the visible recipe `recipe`. The ingredients of
 *   all pieces are taken at once (bags first, then chests in reach) and reserved for the order.
 * - `craft.cancel {index}`: cancel the order at queue position `index` (0 = the one being worked on); its
 *   whole reservation goes back into the bags.
 * - `craft.useChests {on}`: whether crafting may take from chests in reach (§15.1 "abschaltbar").
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { idSchema } from '../../content/schema/common';

const C = BALANCE.crafting;

export const craftStartCommandSchema = z
  .object({
    type: z.literal('craft.start'),
    recipe: idSchema,
    count: z.number().int().min(1).max(C.maxOrderCount),
  })
  .strict();

export const craftCancelCommandSchema = z
  .object({
    type: z.literal('craft.cancel'),
    index: z
      .number()
      .int()
      .min(0)
      .max(C.queueLength - 1),
  })
  .strict();

export const craftUseChestsCommandSchema = z.object({ type: z.literal('craft.useChests'), on: z.boolean() }).strict();

/** Schemas of the crafting commands (aggregated by `gameCommandSchema`). */
export const CRAFTING_COMMAND_SCHEMAS = [craftStartCommandSchema, craftCancelCommandSchema, craftUseChestsCommandSchema] as const;
