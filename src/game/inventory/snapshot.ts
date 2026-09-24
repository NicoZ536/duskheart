/**
 * Saved form of bag slots, shared by the participants `inventory` and `equipment`: stacks are copied
 * on the way out (the simulation shares immutable stacks) and checked against their item and place on
 * the way in – an unknown item, a stack too large for its slot, missing or surplus durability or
 * freshness, or an item in a slot it does not fit is a load error (`TypeError`), never a silent change.
 */
import type { z } from 'zod';
import type { ItemCatalog } from '../items/catalog';
import { slotAccepts, slotCapacity, type BagArea, type SlotRef } from '../items/slots';
import { checkStack, itemStackSchema, type ItemStack } from '../items/stack';
import type { Slot } from './bags';

/** Schema of a saved slot (`null` = empty). */
export const savedSlotSchema = itemStackSchema.nullable();
/** A saved slot after schema validation. */
export type SavedSlot = z.output<typeof savedSlotSchema>;

/** A copy of a stack for saves (stacks are shared immutable data inside the simulation). */
export function copyStack(stack: ItemStack): ItemStack {
  return stack.daten === undefined ? { ...stack } : { ...stack, daten: { ...stack.daten } };
}

/** A copy of a slot list for saves. */
export function copySlots(slots: readonly Slot[]): Slot[] {
  return slots.map((s) => (s === null ? null : copyStack(s)));
}

/**
 * Checks a saved slot against its item and place; throws `TypeError` naming the slot. Used by the
 * inventory and the equipment participant.
 */
export function restoredSlot(catalog: ItemCatalog, ref: SlotRef, raw: SavedSlot): Slot {
  if (raw === null) return null;
  const where = `${ref.bereich}[${ref.index}]`;
  const def = catalog.find(raw.item);
  if (def === undefined) throw new TypeError(`${where}: unknown item "${raw.item}"`);
  if (!slotAccepts(ref, def)) throw new TypeError(`${where}: "${raw.item}" does not fit there`);
  const problem = checkStack(def, raw, slotCapacity(ref.bereich, def));
  if (problem !== null) throw new TypeError(`${where}: ${problem}`);
  return raw;
}

/** Checks a saved area slot by slot (see `restoredSlot`). */
export function restoredArea(catalog: ItemCatalog, area: BagArea, raw: readonly SavedSlot[]): Slot[] {
  return raw.map((s, index) => restoredSlot(catalog, { bereich: area, index }, s));
}
