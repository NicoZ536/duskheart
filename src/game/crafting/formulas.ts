/**
 * Pure rules of crafting (MASTERPROMPT §15.1, §13.1, §23.2 Handwerk; M3-16, M4-01 … M4-03): recipe
 * visibility (concrete and group ingredients, stations by line and stage, blueprints), how many pieces the
 * bags afford, crafting time (skill and station tempo), taking ingredients from the bags, splitting a
 * reservation into the share of one piece, the quality of a finished piece and the product's inherited
 * durability. Unit-tested in tests/unit/game/crafting-basis.test.ts, rezept-entdeckung.test.ts and
 * qualitaet.test.ts.
 */
import { BALANCE } from '../../content/balance';
import type { ItemDef } from '../../content/schema/item';
import type { RecipeDef } from '../../content/recipes/schema';
import { TILE_PX } from '../../world/model/coords';
import { drinkable, waterSource } from '../actions/formulas';
import { distanceToRect } from '../interaction/formulas';
import { withSlot, type BagsState } from '../inventory/bags';
import { maxDurability } from '../items/formulas';
import { BAG_AREAS, type BagArea } from '../items/slots';
import { stackQuality, withCount, type ItemStack } from '../items/stack';
import type { ResolvedIngredient } from './recipes';

const C = BALANCE.crafting;

/**
 * Where crafting takes ingredients from first: the backpack compartment and the back of the inventory,
 * the hotbar last – the order of `removeItems` (src/game/inventory/ops.ts), so the tools in the hand stay.
 */
const TAKE_ORDER: readonly BagArea[] = ['rucksackfach', 'inventar', 'schnellleiste'];

/**
 * Whether `recipe` is visible (§15.1 "Ein Rezept wird sichtbar, sobald jede Zutat einmal besessen wurde und
 * die Station bekannt ist. Zusätzlich: Baupläne"): a recipe with a blueprint once the blueprint is learned;
 * otherwise once every ingredient was owned – a group ingredient once any of its members was – and its
 * station is known (`stationKnown`: a station of its line at its stage or higher was owned or met in the
 * world). A recipe waiting for an unlock (`freischaltung`, §23.1, M7-36) shows once it is granted (`unlocked`, the unlock
 * registry's `recipeAllowed`) – like a learned blueprint, the knowledge of the beacon names it at once.
 */
export function recipeVisible(
  recipe: RecipeDef,
  ingredients: readonly ResolvedIngredient[],
  owned: ReadonlySet<string>,
  stationKnown: (station: string) => boolean,
  blueprints: ReadonlySet<string>,
  unlocked: (recipe: string) => boolean = () => false,
): boolean {
  if (recipe.freischaltung !== undefined) return unlocked(recipe.id);
  if (recipe.bauplan !== undefined) return blueprints.has(recipe.id);
  if (recipe.station !== null && !stationKnown(recipe.station)) return false;
  return ingredients.every((z) => z.items.some((item) => owned.has(item)));
}

/** Whether a stack can be used as an ingredient: pieces with durability only while intact (§13.1 "Kaputt = unbenutzbar"). */
export function usableStack(stack: ItemStack): boolean {
  return stack.haltbarkeit === undefined || stack.haltbarkeit > 0;
}

/** Usable pieces of `item` in the carried bags (inventory, backpack compartment, hotbar) [pieces]. */
export function usableCount(state: BagsState, item: string): number {
  let n = 0;
  // Index loops: the presentation's samples count ≈ 10×/s, and iterating the frozen bag areas with `for … of` made an
  // iterator result per slot (§30 "Keine Allokationen in Hot-Loops", M5-40).
  for (let a = 0; a < TAKE_ORDER.length; a++) {
    const slots = state[TAKE_ORDER[a] as BagArea];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i] ?? null;
      if (slot !== null && slot.item === item && usableStack(slot)) n += slot.count;
    }
  }
  return n;
}

/**
 * Takes `count` usable pieces of `item` from the carried bags (see `TAKE_ORDER`); `null` (nothing taken)
 * when fewer are there. Returns the new bags and the taken stacks with their state (freshness, durability).
 */
export function takeUsable(state: BagsState, item: string, count: number): { state: BagsState; taken: ItemStack[] } | null {
  if (count < 1 || usableCount(state, item) < count) return null;
  let next = state;
  let remaining = count;
  const taken: ItemStack[] = [];
  for (const area of TAKE_ORDER) {
    for (let index = next[area].length - 1; index >= 0 && remaining > 0; index--) {
      const slot = next[area][index] ?? null;
      if (slot === null || slot.item !== item || !usableStack(slot)) continue;
      const n = slot.count < remaining ? slot.count : remaining;
      taken.push(withCount(slot, n));
      next = withSlot(next, { bereich: area, index }, slot.count > n ? withCount(slot, slot.count - n) : null);
      remaining -= n;
    }
  }
  return { state: next, taken };
}

/** Every item id in any slot of the bags, worn pieces included (what the player owns right now). */
export function ownedItems(state: BagsState, out: Set<string>): Set<string> {
  for (const area of BAG_AREAS) for (const slot of state[area]) if (slot !== null) out.add(slot.item);
  return out;
}

/**
 * Pieces the available ingredients afford [pieces]; `available(item)` counts one item – a group ingredient
 * counts all its members together.
 */
export function affordablePieces(ingredients: readonly ResolvedIngredient[], available: (item: string) => number): number {
  let pieces = Number.POSITIVE_INFINITY;
  for (const z of ingredients) {
    let have = 0;
    for (const item of z.items) have += available(item);
    pieces = Math.min(pieces, Math.floor(have / z.anzahl));
  }
  return Number.isFinite(pieces) ? pieces : 0;
}

/** Crafting time of one piece [real seconds] by its time class (`BALANCE.crafting.durationSeconds`). */
export function craftSeconds(recipe: Pick<RecipeDef, 'dauer'>): number {
  return C.durationSeconds[recipe.dauer];
}

/**
 * Crafting time of one piece [ticks, ≥ 1]: the seconds shortened by the Handwerk skill (§23.2 "+0,5 %
 * Wirkung je Stufe": `bonus` 0,05 at level 10 makes crafting 5 % faster) and by the station's tempo
 * (§15.1 "Stationsstufen erhöhen … Tempo": Werkbank II 1,25).
 */
export function craftTicks(seconds: number, bonus: number, tempo = 1, tickHz: number = BALANCE.time.tickHz): number {
  return Math.max(1, Math.ceil((seconds * tickHz) / ((1 + Math.max(0, bonus)) * tempo)));
}

/**
 * Splits `count` pieces of the items `items` off a reservation (stacks in taking order): the taken stacks and
 * the reservation that stays. Throws `RangeError` when the reservation holds fewer.
 */
export function splitReservation(reserved: readonly ItemStack[], items: string | readonly string[], count: number): { taken: ItemStack[]; rest: ItemStack[] } {
  const wanted = typeof items === 'string' ? [items] : items;
  const taken: ItemStack[] = [];
  const rest: ItemStack[] = [];
  let remaining = count;
  for (const stack of reserved) {
    if (remaining === 0 || !wanted.includes(stack.item)) {
      rest.push(stack);
      continue;
    }
    const n = stack.count < remaining ? stack.count : remaining;
    taken.push(withCount(stack, n));
    if (stack.count > n) rest.push(withCount(stack, stack.count - n));
    remaining -= n;
  }
  if (remaining > 0) throw new RangeError(`reservation holds ${count - remaining} of ${count} × "${wanted.join('|')}"`);
  return { taken, rest };
}

/** The ingredients of one piece, split off `reserved`: the consumed stacks and the rest of the reservation. */
export function pieceShare(ingredients: readonly ResolvedIngredient[], reserved: readonly ItemStack[]): { consumed: ItemStack[]; rest: ItemStack[] } {
  let rest: ItemStack[] = [...reserved];
  const consumed: ItemStack[] = [];
  for (const z of ingredients) {
    const split = splitReservation(rest, z.items, z.anzahl);
    consumed.push(...split.taken);
    rest = split.rest;
  }
  return { consumed, rest };
}

/** Whether pieces of `def` have a quality (§13.1: the stars act on stats and durability, so only such items). */
export function hasQuality(def: Pick<ItemDef, 'haltbarkeit' | 'werte'>): boolean {
  return def.haltbarkeit !== undefined || def.werte !== undefined;
}

/**
 * Quality of a finished piece [stars 1–3] (§13.1 "Qualität 1–3 Sterne (aus Handwerks-Skill und
 * Stationsstufe)"): the score is the Handwerk `level` plus the station's quality points (`stationPoints`,
 * `null` = made in the hand); each threshold of `BALANCE.crafting.quality` reached adds a star, and a piece
 * made in the hand gets at most `handMaxStars`.
 */
export function qualityStars(level: number, stationPoints: number | null): number {
  const score = level + (stationPoints ?? 0);
  let stars = 1;
  for (const t of C.quality.thresholds) if (score >= t) stars++;
  return stationPoints === null ? Math.min(stars, C.quality.handMaxStars) : stars;
}

/**
 * Durability and quality the product of a `behaelt: 'haltbarkeit'` recipe takes over from the consumed
 * piece with durability (a filled bucket is the same bucket), capped at the product's maximum; `null` when
 * the recipe keeps nothing or no consumed piece has durability.
 */
export function keptState(recipe: RecipeDef, product: ItemDef, consumed: readonly ItemStack[]): { haltbarkeit: number; qualitaet: number } | null {
  if (recipe.behaelt !== 'haltbarkeit' || product.haltbarkeit === undefined) return null;
  const piece = consumed.find((s) => s.haltbarkeit !== undefined);
  if (piece?.haltbarkeit === undefined) return null;
  const quality = stackQuality(piece);
  return { haltbarkeit: Math.min(piece.haltbarkeit, maxDurability(product.haltbarkeit, quality)), qualitaet: quality };
}

/**
 * Whether open fresh water (a river, lake or spring – not the salty sea, not ice; §18) lies within
 * `radiusPx` of the feet (x, y) [px]: the edge of a water tile counts. `waterAt(tx, ty)` reads the water
 * byte of a tile (docs/WORLD.md §3).
 */
export function freshWaterWithin(x: number, y: number, radiusPx: number, waterAt: (tx: number, ty: number) => number): boolean {
  const tx0 = Math.floor((x - radiusPx) / TILE_PX);
  const tx1 = Math.floor((x + radiusPx) / TILE_PX);
  const ty0 = Math.floor((y - radiusPx) / TILE_PX);
  const ty1 = Math.floor((y + radiusPx) / TILE_PX);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const source = waterSource(waterAt(tx, ty));
      if (source === null || !drinkable(source)) continue;
      if (distanceToRect(x, y, tx * TILE_PX, ty * TILE_PX, (tx + 1) * TILE_PX, (ty + 1) * TILE_PX) <= radiusPx) return true;
    }
  }
  return false;
}
