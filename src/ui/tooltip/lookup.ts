/**
 * "Verwendet in" and "Herkunft" of every item (MASTERPROMPT §15.1 "Für jedes Item ‚Verwendet in' und
 * ‚Herkunft' nachschlagbar", §26): the derived item index of the content (src/content/items/usage.ts)
 * turned into names for tooltips – sources grouped by kind ("Sammeln in der Welt: Eiche, Birke"),
 * uses by kind with the names of the using records where they have one ("Zutat: Faserseil").
 */
import { CONTENT } from '../../content/index';
import { buildItemIndex, type ItemIndex, type ItemUse } from '../../content/items/usage';
import type { ItemUseKind } from '../../content/items/relations';
import type { LocalizedText } from '../../content/schema/common';
import { ITEM_SOURCE_KINDS, parseItemSource, type ItemSourceKind } from '../../content/schema/item';
import type { Lang } from '../../i18n';

/** Sources and uses of an item. */
export interface ItemLookup {
  sources(itemId: string): readonly string[];
  uses(itemId: string): readonly ItemUse[];
  /** Display name of a content record (`name` of the record), or `null` when it has none. */
  recordName(collection: string, id: string, lang: Lang): string | null;
}

/** Sources of one kind with the names of the source records. */
export interface SourceGroup {
  readonly kind: ItemSourceKind;
  readonly names: readonly string[];
}

/** Uses of one kind with the names of the using records. */
export interface UseGroup {
  readonly kind: ItemUseKind;
  readonly names: readonly string[];
}

function isLocalized(v: unknown): v is LocalizedText {
  return typeof v === 'object' && v !== null && typeof (v as { de?: unknown }).de === 'string' && typeof (v as { en?: unknown }).en === 'string';
}

/** Lookup over an item index and a registry (tests pass fixtures). */
export function createItemLookup(index: ItemIndex, find: (collection: string, id: string) => object | undefined): ItemLookup {
  return {
    sources: (itemId) => index.sources.get(itemId) ?? [],
    uses: (itemId) => index.uses.get(itemId) ?? [],
    recordName(collection, id, lang) {
      const record = find(collection, id);
      const name = record === undefined ? undefined : (record as { name?: unknown }).name;
      return isLocalized(name) ? name[lang] : null;
    },
  };
}

let contentLookup: ItemLookup | null = null;

/** The lookup of the game's content (built on first use). */
export function contentItemLookup(): ItemLookup {
  contentLookup ??= createItemLookup(buildItemIndex(CONTENT), (collection, id) => (CONTENT.has(collection, id) ? CONTENT.collections().find((c) => c.name === collection)?.get(id) : undefined));
  return contentLookup;
}

/** Sources of `itemId` grouped by kind, in first-seen order; names sorted, unique. */
export function sourceGroups(lookup: ItemLookup, itemId: string, lang: Lang): SourceGroup[] {
  const groups = new Map<ItemSourceKind, Set<string>>();
  for (const raw of lookup.sources(itemId)) {
    const source = parseItemSource(raw);
    if (source === null) continue;
    const names = groups.get(source.kind) ?? new Set<string>();
    groups.set(source.kind, names);
    const collection = ITEM_SOURCE_KINDS[source.kind];
    if (collection !== null && source.id !== null) {
      const name = lookup.recordName(collection, source.id, lang);
      if (name !== null) names.add(name);
    }
  }
  return [...groups].map(([kind, names]) => ({ kind, names: [...names].sort((a, b) => a.localeCompare(b, lang)) }));
}

/** Uses of `itemId` grouped by kind (own data first), with the names of the using records. */
export function useGroups(lookup: ItemLookup, itemId: string, lang: Lang): UseGroup[] {
  const groups = new Map<ItemUseKind, string[]>();
  for (const use of lookup.uses(itemId)) {
    const names = groups.get(use.kind) ?? [];
    groups.set(use.kind, names);
    if (use.by === undefined) continue;
    const slash = use.by.indexOf('/');
    const name = slash < 0 ? null : lookup.recordName(use.by.slice(0, slash), use.by.slice(slash + 1), lang);
    if (name !== null && !names.includes(name)) names.push(name);
  }
  return [...groups].map(([kind, names]) => ({ kind, names }));
}
