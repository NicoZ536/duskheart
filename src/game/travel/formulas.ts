/**
 * Pure rules of fast travel (docs/SPIEL.md §22, MASTERPROMPT §25; M7-37): the price of a trip by distance, which items are
 * cargo under logistics realism, and the cleaning of a way stone's name.
 */
import { BALANCE } from '../../content/balance';
import type { ItemDef } from '../../content/schema/item';

const T = BALANCE.travel;

/** Lumen shards for a trip over (dx, dy) tiles: ⌈distance / `tilesPerLumen`⌉, at least `minCost`. */
export function travelCost(dx: number, dy: number): number {
  return Math.max(T.minCost, Math.ceil(Math.sqrt(dx * dx + dy * dy) / T.tilesPerLumen));
}

/**
 * The items logistics realism keeps from travelling (§25 "Erze und Barren nicht teleportierbar"): every ore of `ores`
 * (item `<erz>erz`, or the ore's own id when it already ends in "erz", like the star ore) and every item of category `barren`.
 */
export function cargoItems(items: Iterable<Pick<ItemDef, 'id' | 'kategorie'>>, ores: Iterable<{ readonly id: string }>): Set<string> {
  const ids = new Set<string>();
  const oreItems = new Set<string>();
  for (const o of ores) oreItems.add(o.id.endsWith('erz') ? o.id : `${o.id}erz`);
  for (const item of items) if (item.kategorie === 'barren' || oreItems.has(item.id)) ids.add(item.id);
  return ids;
}

/** A way stone's name trimmed and with its whitespace folded, or null when it is blank or too long. */
export function waystoneName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  return name.length === 0 || name.length > T.nameMaxLength ? null : name;
}
