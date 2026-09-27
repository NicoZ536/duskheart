/**
 * Pure rules of repair (MASTERPROMPT §13.1 "Haltbarkeit für Werkzeuge, Waffen, Rüstung; Reparatur an Werkbank,
 * Amboss oder Schleifstein (anteilige Materialkosten). Kaputt = unbenutzbar, nie zerstört."; M4-09).
 * Unit-tested in tests/unit/game/reparatur.test.ts.
 *
 * - The price of a repair comes from the recipe that makes the item (the first in book order); a product that
 *   keeps the durability of an ingredient (a filled bucket) is priced by the recipe of that ingredient (the
 *   bucket).
 * - Each ingredient without durability costs its count × the worn share of the piece × the repair share
 *   (`BALANCE.crafting.repairMaterialShare`), rounded; a worn piece always costs at least one piece of its
 *   largest ingredient. Mending brings the piece back to the full durability of its quality.
 */
import { BALANCE } from '../../content/balance';
import type { RecipeDef } from '../../content/recipes/schema';
import type { ItemDef } from '../../content/schema/item';
import type { ResolvedIngredient, RecipeBook } from '../crafting/recipes';
import { maxDurability } from '../items/formulas';
import { stackQuality, type ItemStack } from '../items/stack';

/** One material cost of a repair: pieces of any of `items` (a group ingredient) or of the one item. */
export interface RepairCost {
  readonly key: string;
  readonly items: readonly string[];
  readonly anzahl: number;
}

/** Full durability of `stack` of `def` [uses] (its quality's maximum); 0 for items without durability. */
export function fullDurability(def: Pick<ItemDef, 'haltbarkeit'>, stack: ItemStack): number {
  return def.haltbarkeit === undefined ? 0 : maxDurability(def.haltbarkeit, stackQuality(stack));
}

/** Worn share of a piece [0–1]: 0 undamaged, 1 broken. */
export function wornShare(def: Pick<ItemDef, 'haltbarkeit'>, stack: ItemStack): number {
  const full = fullDurability(def, stack);
  if (full === 0 || stack.haltbarkeit === undefined) return 0;
  return Math.min(1, Math.max(0, (full - stack.haltbarkeit) / full));
}

/** The recipe whose ingredients price a repair of `item` (see module comment), or `undefined`. */
export function repairRecipe(book: RecipeBook, item: string): RecipeDef | undefined {
  const r = book.recipesFor(item)[0];
  if (r?.behaelt !== 'haltbarkeit') return r;
  const kept = book.ingredients(r.id).find((z) => !z.gruppe && book.catalog.get(z.key).haltbarkeit !== undefined);
  return kept === undefined ? undefined : book.recipesFor(kept.key)[0];
}

/**
 * Material costs of mending a piece `worn` (0–1) worn out of `ingredients` (the recipe's): count × worn ×
 * `share`, rounded, for every ingredient without durability; at least one piece of the largest one when the
 * piece is worn at all. Empty for an undamaged piece.
 */
export function repairCosts(
  ingredients: readonly ResolvedIngredient[],
  durable: (item: string) => boolean,
  worn: number,
  share: number = BALANCE.crafting.repairMaterialShare,
): RepairCost[] {
  if (worn <= 0) return [];
  const materials = ingredients.filter((z) => !z.items.some(durable));
  const costs: RepairCost[] = [];
  for (const z of materials) {
    const n = Math.round(z.anzahl * worn * share);
    if (n > 0) costs.push({ key: z.key, items: z.items, anzahl: n });
  }
  if (costs.length === 0 && materials.length > 0) {
    let largest = materials[0] as ResolvedIngredient;
    for (const z of materials) if (z.anzahl > largest.anzahl) largest = z;
    costs.push({ key: largest.key, items: largest.items, anzahl: 1 });
  }
  return costs;
}
