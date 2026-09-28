/**
 * Pure rules of storage (MASTERPROMPT §16.7; M4-21): what a container takes, how its slots fill and empty, how
 * they sort, what the chests of a base hold. The storage system (system.ts) applies them to its chests.
 *
 * - **Filling** joins stacks first, then takes empty slots in slot order (`addToSlots`, the rule of station slots);
 *   pieces with durability take a slot each (§13.1: they never stack).
 * - **Taking** for crafting, building and repairs counts only usable pieces (a broken tool is no material) and
 *   takes from the last slot first, like the bags do.
 * - **Sorting** (§16.7 "Sortieren") joins what can join and orders the stacks like the bags (`inventory.sort`):
 *   category, tier, id, then better quality, more durability, fresher, larger first.
 */
import type { ContainerBalance } from '../../content/balance/storage';
import { ITEM_CATEGORIES, type ItemDef } from '../../content/schema/item';
import { TILE_PX } from '../../world/model/coords';
import { usableStack } from '../crafting/formulas';
import type { ItemCatalog } from '../items/catalog';
import { canStack, joinedStack, stackQuality, withCount, type ItemStack } from '../items/stack';
import { addToSlots } from '../stations/formulas';
import type { Chest } from './state';

/** Whether a container of `rules` takes items of `def` (§16.7 "Lagerregal 48 (nur Rohstoffe)"). */
export function containerAccepts(rules: ContainerBalance, def: Pick<ItemDef, 'kategorie'>): boolean {
  return rules.only === undefined || rules.only.includes(def.kategorie);
}

/** Puts up to `stack.count` pieces into `slots`; returns how many went in. */
export function putIntoSlots(slots: (ItemStack | null)[], stack: ItemStack, stackSize: number): number {
  return stack.count - addToSlots(slots, stack, stackSize);
}

/** Usable pieces of `item` in `slots` [pieces]. */
export function usableIn(slots: readonly (ItemStack | null)[], item: string): number {
  let n = 0;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i] ?? null;
    if (s !== null && s.item === item && usableStack(s)) n += s.count;
  }
  return n;
}

/**
 * Takes `count` usable pieces of `item` out of `slots` (the last slot first); returns the taken stacks with their
 * state, or `null` (nothing taken) when fewer are there.
 */
export function takeUsableFrom(slots: (ItemStack | null)[], item: string, count: number): ItemStack[] | null {
  if (count < 1 || usableIn(slots, item) < count) return null;
  const taken: ItemStack[] = [];
  let need = count;
  for (let i = slots.length - 1; i >= 0 && need > 0; i--) {
    const s = slots[i] ?? null;
    if (s === null || s.item !== item || !usableStack(s)) continue;
    const n = Math.min(need, s.count);
    taken.push(withCount(s, n));
    slots[i] = s.count > n ? withCount(s, s.count - n) : null;
    need -= n;
  }
  return taken;
}

/** Whether any slot holds `item`. */
export function holds(slots: readonly (ItemStack | null)[], item: string): boolean {
  for (const s of slots) if (s !== null && s.item === item) return true;
  return false;
}

/** Whether every slot is empty. */
export function isEmpty(slots: readonly (ItemStack | null)[]): boolean {
  for (const s of slots) if (s !== null) return false;
  return true;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Order of two stacks in a sorted container (the order of `inventory.sort`). */
export function compareStored(catalog: ItemCatalog, a: ItemStack, b: ItemStack): number {
  const da = catalog.get(a.item);
  const db = catalog.get(b.item);
  return (
    ITEM_CATEGORIES.indexOf(da.kategorie) - ITEM_CATEGORIES.indexOf(db.kategorie) ||
    da.stufe - db.stufe ||
    compareText(a.item, b.item) ||
    stackQuality(b) - stackQuality(a) ||
    (b.haltbarkeit ?? 0) - (a.haltbarkeit ?? 0) ||
    (b.frische ?? 0) - (a.frische ?? 0) ||
    b.count - a.count
  );
}

/** The slots joined and sorted (§16.7 "Sortieren"); the same number of slots, empty ones last. */
export function sortedSlots(slots: readonly (ItemStack | null)[], catalog: ItemCatalog): (ItemStack | null)[] {
  const joined: ItemStack[] = [];
  for (const slot of slots) {
    if (slot === null) continue;
    let rest: ItemStack | null = slot;
    const capacity = catalog.get(slot.item).stapel;
    for (let i = 0; i < joined.length && rest !== null; i++) {
      const other = joined[i] as ItemStack;
      if (!canStack(other, rest) || other.count >= capacity) continue;
      const moved = Math.min(capacity - other.count, rest.count);
      joined[i] = joinedStack(other, rest, moved);
      rest = rest.count > moved ? withCount(rest, rest.count - moved) : null;
    }
    if (rest !== null) joined.push(rest);
  }
  joined.sort((a, b) => compareStored(catalog, a, b));
  const out: (ItemStack | null)[] = [...joined];
  while (out.length < slots.length) out.push(null);
  return out;
}

/** Pieces per item over `chests` (the storage overview, §16.5 "Lagerübersicht aller Kisten"), items in id order. */
export function storedTotals(chests: readonly Pick<Chest, 'slots'>[]): Map<string, number> {
  const sums = new Map<string, number>();
  for (const c of chests) for (const s of c.slots) if (s !== null) sums.set(s.item, (sums.get(s.item) ?? 0) + s.count);
  return new Map([...sums].sort((a, b) => compareText(a[0], b[0])));
}

/** Centre of a chest's footprint [world px] into `out`. */
export function chestCentre(c: Pick<Chest, 'tx' | 'ty' | 'w' | 'h'>, out: { x: number; y: number }): { x: number; y: number } {
  out.x = (c.tx + c.w / 2) * TILE_PX;
  out.y = (c.ty + c.h / 2) * TILE_PX;
  return out;
}

/**
 * Distance from world px (x, y) to the footprint of a chest [px] (0 inside) – the root of the squares like
 * `distanceToFootprint` of the stations: crafting's look at the chests in reach runs in the samples ≈ 10×/s (M5-40).
 */
export function distanceToChest(c: Pick<Chest, 'tx' | 'ty' | 'w' | 'h'>, x: number, y: number): number {
  const x0 = c.tx * TILE_PX;
  const y0 = c.ty * TILE_PX;
  const x1 = (c.tx + c.w) * TILE_PX;
  const y1 = (c.ty + c.h) * TILE_PX;
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return Math.sqrt(dx * dx + dy * dy);
}
