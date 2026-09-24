/**
 * Commands of the player's actions (MASTERPROMPT §11.4 "Aktionen", §26 "Q Gürtel"; aggregated by
 * src/game/commands.ts):
 *
 * - `action.eat {from}`: eat or drink the consumable in slot `from` (inventory, hotbar, backpack, belt).
 * - `action.useBelt {index?}`: key Q – consume from belt slot `index`, or from the first filled belt slot.
 * - `action.drink {tx, ty}`: a sip from the river, lake or spring on tile (tx, ty) within reach.
 * - `action.sit {tx, ty}`: sit on the seat on tile (tx, ty) (tree stumps, chairs); `action.stand {}` gets up.
 * - `action.throw {from, x, y}`: throw one piece from slot `from` towards world px (x, y).
 * - `action.cancel {}`: stop eating or drinking, or get up.
 *
 * Items for debug and tests come from `inventory.give` (src/game/inventory/commands.ts).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { slotRefSchema } from '../inventory/commands';

const tile = z.number().int();

export const actionEatCommandSchema = z.object({ type: z.literal('action.eat'), from: slotRefSchema }).strict();
export const actionUseBeltCommandSchema = z
  .object({
    type: z.literal('action.useBelt'),
    index: z
      .number()
      .int()
      .min(0)
      .max(BALANCE.items.bags.beltSlots - 1)
      .optional(),
  })
  .strict();
export const actionDrinkCommandSchema = z.object({ type: z.literal('action.drink'), tx: tile, ty: tile }).strict();
export const actionSitCommandSchema = z.object({ type: z.literal('action.sit'), tx: tile, ty: tile }).strict();
export const actionStandCommandSchema = z.object({ type: z.literal('action.stand') }).strict();
export const actionThrowCommandSchema = z.object({ type: z.literal('action.throw'), from: slotRefSchema, x: z.number(), y: z.number() }).strict();
export const actionCancelCommandSchema = z.object({ type: z.literal('action.cancel') }).strict();

/** The command schemas of the actions. */
export const ACTION_COMMAND_SCHEMAS = [
  actionEatCommandSchema,
  actionUseBeltCommandSchema,
  actionDrinkCommandSchema,
  actionSitCommandSchema,
  actionStandCommandSchema,
  actionThrowCommandSchema,
  actionCancelCommandSchema,
] as const;
