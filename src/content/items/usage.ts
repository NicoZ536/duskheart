/**
 * Sources and uses of every item, derived from the content (MASTERPROMPT §13.1 "Verwendungen
 * (automatisch berechnet)", §15.1 "Für jedes Item ‚Verwendet in' und ‚Herkunft' nachschlagbar",
 * §31.4; docs/SPIEL.md §2).
 *
 * - Sources: the item's declared `quellen` plus every classified source reference of another record
 *   (a world object's `drops` ⇒ `welt:<objekt>`), see src/content/items/relations.ts.
 * - Uses: what the item's own data makes it good for (`essbar` ⇒ essen, `brennwert` ⇒ brennstoff,
 *   worn or carried equipment ⇒ ausrüsten, `werkzeug` ⇒ werkzeug, `pflanzt` ⇒ pflanzen) plus every
 *   classified use reference of another record (a recipe input ⇒ zutat …).
 * - References into `items` that no relation classifies are returned as `unclassified` so the
 *   validator can report them.
 *
 * Works on any registry view (the validator runs it on fixtures with partial item schemas), so it
 * reads records defensively.
 */
import type { ContentRegistryView, ReferenceUse } from '../registry';
import { formatItemSource, type ItemCategory } from '../schema/item';
import { ITEM_RELATIONS, referencePathMatches, type ItemRelation, type ItemUseKind } from './relations';

/** Name of the item collection. */
export const ITEMS_COLLECTION = 'items';

/** One use of an item. */
export interface ItemUse {
  readonly kind: ItemUseKind;
  /** The using record (`recipes/rezept_steinaxt`); absent for uses from the item's own data. */
  readonly by?: string;
}

/** Sources and uses of all items of a registry. */
export interface ItemIndex {
  /** Item id → sources (sorted, unique; declared and derived). */
  readonly sources: ReadonlyMap<string, readonly string[]>;
  /** Item id → uses (own data first, then references in registry order). */
  readonly uses: ReadonlyMap<string, readonly ItemUse[]>;
  /** References into `items` that no relation classifies. */
  readonly unclassified: readonly ReferenceUse[];
}

/** Categories whose items are worn or wielded: equipment slots, the backpack slot, the main hand (§13.1). */
const WORN_CATEGORIES: readonly ItemCategory[] = ['waffe', 'ruestung', 'schild', 'licht', 'schmuck', 'rucksack'];

function field(record: object, key: string): unknown {
  return (record as Record<string, unknown>)[key];
}

/** Uses that follow from an item record's own data. */
export function intrinsicItemUses(item: object): ItemUseKind[] {
  const uses: ItemUseKind[] = [];
  if (field(item, 'essbar') !== undefined) uses.push('essen');
  if (typeof field(item, 'brennwert') === 'number') uses.push('brennstoff');
  const category = field(item, 'kategorie');
  if (typeof category === 'string' && (WORN_CATEGORIES as readonly string[]).includes(category)) uses.push('ausruesten');
  if (field(item, 'werkzeug') !== undefined) uses.push('werkzeug');
  if (typeof field(item, 'pflanzt') === 'string') uses.push('pflanzen');
  return uses;
}

/** The relation classifying a reference, or `undefined`. */
export function classifyItemReference(ref: ReferenceUse, relations: readonly ItemRelation[] = ITEM_RELATIONS): ItemRelation | undefined {
  return relations.find((r) => r.collection === ref.collection && referencePathMatches(r.path, ref.at));
}

/** Derives sources and uses of every item in `registry` (empty maps without an `items` collection). */
export function buildItemIndex(registry: ContentRegistryView, relations: readonly ItemRelation[] = ITEM_RELATIONS): ItemIndex {
  const sources = new Map<string, Set<string>>();
  const uses = new Map<string, ItemUse[]>();
  const items = registry.collections().find((c) => c.name === ITEMS_COLLECTION);
  for (const item of items?.values() ?? []) {
    const declared = field(item, 'quellen');
    sources.set(item.id, new Set(Array.isArray(declared) ? declared.filter((s): s is string => typeof s === 'string') : []));
    uses.set(item.id, intrinsicItemUses(item).map((kind) => ({ kind })));
  }
  const unclassified: ReferenceUse[] = [];
  for (const ref of registry.references()) {
    if (ref.target !== ITEMS_COLLECTION) continue;
    const relation = classifyItemReference(ref, relations);
    if (relation === undefined) {
      unclassified.push(ref);
      continue;
    }
    if (typeof ref.value !== 'string') continue;
    if (relation.kind === 'quelle') sources.get(ref.value)?.add(formatItemSource(relation.source, ref.id));
    else uses.get(ref.value)?.push({ kind: relation.use, by: `${ref.collection}/${ref.id}` });
  }
  return {
    sources: new Map([...sources].map(([id, set]) => [id, [...set].sort()])),
    uses,
    unclassified,
  };
}
