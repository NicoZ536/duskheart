/**
 * Commands of the bags (docs/SPIEL.md §3; MASTERPROMPT §13.1, §26 "Inventar-Komfort"), aggregated by
 * src/game/commands.ts. Slots are addressed as `{ bereich, index }` (src/game/items/slots.ts).
 *
 * - `inventory.move {from, to, count?}`: drag and drop, number keys onto the hotbar, equip/unequip.
 * - `inventory.split {from, to?}`: right click – the smaller half to `to` or the first free slot.
 * - `inventory.collect {at}`: double click – gather matching items onto one stack.
 * - `inventory.sort {}`: sort inventory and backpack compartment.
 * - `inventory.quickMove {from}`: shift click.
 * - `inventory.discard {from, count?}`: the bin.
 * - `player.selectHotbar {index}`: keys 1–0 (index 0–9); `player.scrollHotbar {delta}`: mouse wheel.
 * - `inventory.give {item, count, qualitaet?, frische?}`: debug and tests – puts `count` new pieces of
 *   `item` into the bags (quality 2–3 stars, freshness 0–100 % for items that spoil), like a pick-up:
 *   what does not fit raises `inventoryFull` and is lost. The console `give` (M3-35) and the E2E tests
 *   use it; an unknown item is refused (`unknownItem`).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { idSchema } from '../../content/schema/common';
import { FRESHNESS_MAX, QUALITY_MAX, QUALITY_MIN } from '../items/formulas';
import { BAG_AREAS, MAX_SLOT_INDEX } from '../items/slots';

/** A slot address in commands. */
export const slotRefSchema = z.object({ bereich: z.enum(BAG_AREAS), index: z.number().int().min(0).max(MAX_SLOT_INDEX) }).strict();

const itemCount = z.number().int().min(1);
const HOTBAR_SLOTS = BALANCE.items.bags.hotbarSlots;
const BAGS = BALANCE.items.bags;
/**
 * Most pieces one `inventory.give` hands out [items]: every carried slot (inventory, hotbar, the largest
 * backpack compartment) filled with the largest stack – more can never arrive, so the bound only keeps
 * replay files and console typos sane.
 */
export const MAX_GIVE_COUNT = (BAGS.inventorySlots + BAGS.hotbarSlots + Math.max(...BAGS.backpackSlots)) * Math.max(...Object.values(BALANCE.items.stack));

export const inventoryMoveCommandSchema = z.object({ type: z.literal('inventory.move'), from: slotRefSchema, to: slotRefSchema, count: itemCount.optional() }).strict();
export const inventorySplitCommandSchema = z.object({ type: z.literal('inventory.split'), from: slotRefSchema, to: slotRefSchema.optional() }).strict();
export const inventoryCollectCommandSchema = z.object({ type: z.literal('inventory.collect'), at: slotRefSchema }).strict();
export const inventorySortCommandSchema = z.object({ type: z.literal('inventory.sort') }).strict();
export const inventoryQuickMoveCommandSchema = z.object({ type: z.literal('inventory.quickMove'), from: slotRefSchema }).strict();
export const inventoryDiscardCommandSchema = z.object({ type: z.literal('inventory.discard'), from: slotRefSchema, count: itemCount.optional() }).strict();
export const playerSelectHotbarCommandSchema = z
  .object({
    type: z.literal('player.selectHotbar'),
    index: z
      .number()
      .int()
      .min(0)
      .max(HOTBAR_SLOTS - 1),
  })
  .strict();
export const playerScrollHotbarCommandSchema = z
  .object({
    type: z.literal('player.scrollHotbar'),
    /** Wheel notches (positive = next slot); several notches can arrive in one frame. */
    delta: z
      .number()
      .int()
      .min(-(HOTBAR_SLOTS - 1))
      .max(HOTBAR_SLOTS - 1)
      .refine((d) => d !== 0, { message: 'delta must not be 0' }),
  })
  .strict();

export const inventoryGiveCommandSchema = z
  .object({
    type: z.literal('inventory.give'),
    item: idSchema,
    count: itemCount.max(MAX_GIVE_COUNT),
    /** Quality [stars 2–3]; absent = 1 star. */
    qualitaet: z
      .number()
      .int()
      .min(QUALITY_MIN + 1)
      .max(QUALITY_MAX)
      .optional(),
    /** Freshness [percent]; only for items that spoil (default full). */
    frische: z.number().min(0).max(FRESHNESS_MAX).optional(),
  })
  .strict();

/** The command schemas of the bags, in declaration order. */
export const INVENTORY_COMMAND_SCHEMAS = [
  inventoryMoveCommandSchema,
  inventorySplitCommandSchema,
  inventoryCollectCommandSchema,
  inventorySortCommandSchema,
  inventoryQuickMoveCommandSchema,
  inventoryDiscardCommandSchema,
  playerSelectHotbarCommandSchema,
  playerScrollHotbarCommandSchema,
  inventoryGiveCommandSchema,
] as const;
