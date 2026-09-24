/**
 * State of crafting (M3-16) and its save form (participant `crafting`).
 *
 * - `besessen`: every item the player has owned at least once (§15.1 visibility rule).
 * - `stationen`: stations the player has met in the world (placed ones count as known like owned ones).
 * - `bauplaene`: recipes learned from blueprints.
 * - `kisten`: whether crafting takes from chests in reach (§15.1 "abschaltbar").
 * - `auftraege`: the queue (§15.1 "Warteschlange (10)"); each order keeps the ingredients reserved for
 *   its remaining pieces, so a cancel refunds exactly what was taken (freshness and durability included).
 * The visible recipes are derived from these sets and not saved.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { idSchema } from '../../content/schema/common';
import { copyStack } from '../inventory/snapshot';
import { itemStackSchema, type ItemStack } from '../items/stack';

/** One order in the queue. */
export interface CraftOrder {
  readonly rezept: string;
  /** Pieces still to make, the one being worked on included [pieces ≥ 1]. */
  anzahl: number;
  /** Ticks worked on the current piece. */
  fortschritt: number;
  /** Ticks the current piece takes; 0 = not started yet (fixed when work on it begins). */
  dauer: number;
  /** Ingredients reserved for the remaining pieces, in taking order. */
  reserviert: ItemStack[];
}

/** The crafting state of the player. */
export interface CraftingState {
  readonly besessen: Set<string>;
  readonly stationen: Set<string>;
  readonly bauplaene: Set<string>;
  kisten: boolean;
  readonly auftraege: CraftOrder[];
}

/** A fresh state: nothing owned, chests on, empty queue. */
export function emptyCraftingState(): CraftingState {
  return { besessen: new Set(), stationen: new Set(), bauplaene: new Set(), kisten: true, auftraege: [] };
}

const sortedIds = z
  .array(idSchema)
  .refine((ids) => ids.every((id, i) => i === 0 || (ids[i - 1] as string) < id), { message: 'ids must be sorted and unique' });

/** Save form of an order. */
export const craftOrderSchema = z
  .object({
    rezept: idSchema,
    anzahl: z.number().int().min(1).max(BALANCE.crafting.maxOrderCount),
    fortschritt: z.number().int().min(0),
    dauer: z.number().int().min(0),
    reserviert: z.array(itemStackSchema),
  })
  .strict()
  .refine((o) => o.dauer === 0 ? o.fortschritt === 0 : o.fortschritt < o.dauer, { message: 'progress lies within the piece being worked on' });

/** Save form of the crafting state. */
export const craftingSnapshotSchema = z
  .object({
    besessen: sortedIds,
    stationen: sortedIds,
    bauplaene: sortedIds,
    kisten: z.boolean(),
    auftraege: z.array(craftOrderSchema).max(BALANCE.crafting.queueLength),
  })
  .strict();

/** Save form of the crafting state. */
export type CraftingSnapshot = z.output<typeof craftingSnapshotSchema>;

function sorted(set: ReadonlySet<string>): string[] {
  return [...set].sort();
}

/** The save form of `state` (sets sorted, stacks copied). */
export function craftingSnapshot(state: CraftingState): CraftingSnapshot {
  return {
    besessen: sorted(state.besessen),
    stationen: sorted(state.stationen),
    bauplaene: sorted(state.bauplaene),
    kisten: state.kisten,
    auftraege: state.auftraege.map((o) => ({ rezept: o.rezept, anzahl: o.anzahl, fortschritt: o.fortschritt, dauer: o.dauer, reserviert: o.reserviert.map(copyStack) })),
  };
}
