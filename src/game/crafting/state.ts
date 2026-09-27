/**
 * State of crafting (M3-16) and its save form (participant `crafting`).
 *
 * - `besessen`: every item the player has owned at least once (§15.1 visibility rule).
 * - `stationen`: stations the player has met in the world (placed ones count as known like owned ones).
 * - `bauplaene`: recipes learned from blueprints.
 * - `kisten`: whether crafting takes from chests in reach (§15.1 "abschaltbar").
 * - `auftraege`: the queue (§15.1 "Warteschlange (10)"); each order keeps the ingredients reserved for
 *   its remaining pieces, so a cancel refunds exactly what was taken (freshness and durability included),
 *   and – while a piece is worked at a station – which station (`station`, its quality points count at the
 *   end) and where it stands (`platz`, the station an upgrade replaces).
 * - `alle`: every recipe is visible (the console's `unlock`, M3-35).
 * - `angeheftet`: the recipes pinned to the HUD's recipe tracker, oldest first (§15.1 "Rezept anheften"; M4-08) –
 *   at most `MAX_PINNED_RECIPES`.
 * The visible recipes are derived from these sets and not saved. Data version 1: `station`, `platz`, `alle` and
 * `angeheftet` are optional (written only when set) and absent in the M3 saves (ADR-0038, ADR-0043).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { idSchema } from '../../content/schema/common';
import { copyStack } from '../inventory/snapshot';
import { itemStackSchema, type ItemStack } from '../items/stack';

/** Recipes pinned to the HUD's recipe tracker at once at most [recipes] (`BALANCE.crafting.maxPinnedRecipes`). */
export const MAX_PINNED_RECIPES = BALANCE.crafting.maxPinnedRecipes;

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
  /** Station the current piece is worked at (set when it begins; absent in the hand or before it begins). */
  station?: string;
  /** Id of that placed station in the station system (absent for stations of other systems, e.g. campfires). */
  platz?: number;
}

/** The crafting state of the player. */
export interface CraftingState {
  readonly besessen: Set<string>;
  readonly stationen: Set<string>;
  readonly bauplaene: Set<string>;
  kisten: boolean;
  /** Every recipe visible (cheat). */
  alle: boolean;
  readonly auftraege: CraftOrder[];
  /** Pinned recipe ids, oldest first (at most `MAX_PINNED_RECIPES`). */
  readonly angeheftet: string[];
}

/** A fresh state: nothing owned, chests on, empty queue, nothing pinned. */
export function emptyCraftingState(): CraftingState {
  return { besessen: new Set(), stationen: new Set(), bauplaene: new Set(), kisten: true, alle: false, auftraege: [], angeheftet: [] };
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
    station: idSchema.optional(),
    platz: z.number().int().min(1).optional(),
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
    alle: z.literal(true).optional(),
    auftraege: z.array(craftOrderSchema).max(BALANCE.crafting.queueLength),
    angeheftet: z
      .array(idSchema)
      .min(1)
      .max(MAX_PINNED_RECIPES)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'pinned recipes must be unique' })
      .optional(),
  })
  .strict();

/** Save form of the crafting state. */
export type CraftingSnapshot = z.output<typeof craftingSnapshotSchema>;

function sorted(set: ReadonlySet<string>): string[] {
  return [...set].sort();
}

/** The save form of an order (optional fields only when set). */
function orderSnapshot(o: CraftOrder): CraftingSnapshot['auftraege'][number] {
  return {
    rezept: o.rezept,
    anzahl: o.anzahl,
    fortschritt: o.fortschritt,
    dauer: o.dauer,
    reserviert: o.reserviert.map(copyStack),
    ...(o.station === undefined ? {} : { station: o.station }),
    ...(o.platz === undefined ? {} : { platz: o.platz }),
  };
}

/** The save form of `state` (sets sorted, stacks copied). */
export function craftingSnapshot(state: CraftingState): CraftingSnapshot {
  return {
    besessen: sorted(state.besessen),
    stationen: sorted(state.stationen),
    bauplaene: sorted(state.bauplaene),
    kisten: state.kisten,
    ...(state.alle ? { alle: true as const } : {}),
    auftraege: state.auftraege.map(orderSnapshot),
    ...(state.angeheftet.length === 0 ? {} : { angeheftet: [...state.angeheftet] }),
  };
}
