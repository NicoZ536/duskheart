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

/** A cost record the caller keeps and `repairCostsInto` overwrites (the repair tab quotes ≈ 10×/s without garbage). */
export interface RepairCostRecord {
  key: string;
  items: readonly string[];
  anzahl: number;
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
  // A fresh array grows by exactly the records written.
  const costs: RepairCostRecord[] = [];
  writeCosts(ingredients, durable, worn, 1, costs, share);
  return costs;
}

/**
 * `repairCosts` of a piece with `haltbarkeit` of `voll` uses left, written into the records of `out` (grown when too
 * short, never shrunk); returns how many are valid. Allocates only when `out` grows – the repair tab's sampler keeps its
 * records (§30 "Keine Allokationen in Hot-Loops", M5-40): whole uses in, so no fraction is boxed on the way, and every
 * argument given (a missing one cost the call an allocation under V8).
 */
export function repairCostsInto(ingredients: readonly ResolvedIngredient[], durable: (item: string) => boolean, haltbarkeit: number, voll: number, out: RepairCostRecord[], share: number): number {
  return writeCosts(ingredients, durable, voll - haltbarkeit, voll, out, share);
}

/**
 * The cost rule of `repairCosts` for a piece worn `part` of `whole` (whole uses, or the worn share over 1 – the fraction
 * is taken here, so no caller boxes it) into the records of `out`; returns how many are valid.
 */
function writeCosts(ingredients: readonly ResolvedIngredient[], durable: (item: string) => boolean, part: number, whole: number, out: RepairCostRecord[], share: number): number {
  if (part <= 0 || whole <= 0) return 0;
  // `wornShare`: the share of whole uses never exceeds 1 (a share over 1, `whole` 1, is `repairCosts`' 0–1 already).
  // One expression for both callers: a choice between the parameter and the quotient would let V8 keep the quotient as
  // a heap number whenever `part` has been seen fractional (M5-40).
  const worn = Math.min(1, part / whole);
  let n = 0;
  let largest: ResolvedIngredient | null = null;
  for (let i = 0; i < ingredients.length; i++) {
    const z = ingredients[i] as ResolvedIngredient;
    if (z.items.some(durable)) continue;
    if (largest === null || z.anzahl > largest.anzahl) largest = z;
    const count = Math.round(z.anzahl * worn * share);
    if (count > 0) setCost(out, n++, z, count);
  }
  if (n === 0 && largest !== null) setCost(out, n++, largest, 1);
  return n;
}

/** Record `i` of `out` (created when missing) set to `count` pieces of ingredient `z`. */
function setCost(out: RepairCostRecord[], i: number, z: ResolvedIngredient, count: number): void {
  const rec = out[i];
  if (rec === undefined) {
    out.push({ key: z.key, items: z.items, anzahl: count });
    return;
  }
  rec.key = z.key;
  rec.items = z.items;
  rec.anzahl = count;
}
