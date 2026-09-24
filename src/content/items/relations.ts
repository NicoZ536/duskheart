/**
 * How other content refers to items (docs/SPIEL.md §2 "Verwendungen werden automatisch berechnet").
 *
 * Every reference into the collection `items` (declared with `ref(pfad, 'items')` at the referencing
 * collection) is either a **source** of the item (a world object drops it, a recipe makes it) or a
 * **use** (a recipe consumes it, a building costs it, a station burns it). This table classifies each
 * such reference path once; src/content/items/usage.ts derives the sources and uses of every item
 * from it, and the content validator reports item references that no entry classifies. A collection
 * that adds an item reference adds its line here.
 */
import type { ItemSourceKind } from '../schema/item';

/** Kinds of item uses: from the item's own data or from references of other collections. */
export const ITEM_USE_KINDS = ['essen', 'brennstoff', 'ausruesten', 'werkzeug', 'pflanzen', 'zutat', 'station', 'baukosten', 'reparatur'] as const;
/** One kind of item use. */
export type ItemUseKind = (typeof ITEM_USE_KINDS)[number];

/** A reference path into `items` that makes the referencing record a source of the item. */
export interface ItemSourceRelation {
  readonly collection: string;
  /** Reference path as declared with `ref()` (`drops[].item`). */
  readonly path: string;
  readonly kind: 'quelle';
  /** Source kind the relation stands for (`welt` for world object drops). */
  readonly source: ItemSourceKind;
}

/** A reference path into `items` that uses the item. */
export interface ItemUseRelation {
  readonly collection: string;
  readonly path: string;
  readonly kind: 'verwendung';
  readonly use: ItemUseKind;
}

/** One classified reference path. */
export type ItemRelation = ItemSourceRelation | ItemUseRelation;

/** Every reference path into `items`, classified. */
export const ITEM_RELATIONS: readonly ItemRelation[] = [
  // World objects drop items when felled, mined, picked, cleared or harvested (src/content/worldObjects.ts).
  { collection: 'worldObjects', path: 'drops[].item', kind: 'quelle', source: 'welt' },
  // Recipes make their product, consume their ingredients and need their station (src/content/recipes/, M3-16).
  { collection: 'recipes', path: 'ergebnis.item', kind: 'quelle', source: 'rezept' },
  { collection: 'recipes', path: 'zutaten[].item', kind: 'verwendung', use: 'zutat' },
  { collection: 'recipes', path: 'station', kind: 'verwendung', use: 'station' },
];

/**
 * Whether the concrete location `at` of a reference (`drops[2].item`) belongs to the declared path
 * `path` (`drops[].item`): `[]` matches any array index, `{}` any map key.
 */
export function referencePathMatches(path: string, at: string): boolean {
  const pattern = path
    .split('.')
    .map((segment) => {
      const array = segment.endsWith('[]');
      const map = segment.endsWith('{}');
      const key = array || map ? segment.slice(0, -2) : segment;
      const escaped = key.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
      if (array) return `${escaped}(?:\\[\\d+\\])?`;
      if (map) return `${escaped}\\.[^.\\[]+`;
      return escaped;
    })
    .join('\\.');
  return new RegExp(`^${pattern}$`).test(at);
}
