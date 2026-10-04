/**
 * The "Verwendet in"/"Herkunft" index of every item (MASTERPROMPT §15.1 "Für jedes Item ‚Verwendet in' und
 * ‚Herkunft' nachschlagbar", §26 "‚Verwendet in'/‚Herkunft'", §13.1 "Verwendungen (automatisch berechnet)"; M4-08):
 * pure, built once from the content and unit tested in tests/unit/ui/verwendungsindex.test.ts. It names *what* an
 * item comes from and goes into, beyond the kinds of the content's item index (src/content/items/usage.ts), whose
 * recipes and build parts carry no names of their own:
 *
 * - **Herkunft** by kind (`SOURCE_DISPLAY_ORDER`: world and digging first, then making, then creature loot, M6-30c):
 *   gathered from world objects, dug from grounds (the records named by the item's declared and derived sources); made –
 *   where: without a station, or the stations of the recipes that make it ("Herstellen: Köhlermeiler, Lagerfeuer");
 *   dropped by creatures, found at places; the trader.
 * - **Verwendet in** by kind (`ITEM_USE_KINDS` order): the item's own uses (food, equipment, tool, planting); fuel –
 *   with the places it burns in: every fire takes what has a burn value (campfire, fireplace), a processing station
 *   what burns at least its minimum (the smelting furnace wants charcoal), the hearth its own fuels, a lamp its own
 *   fuel (resin); ingredient – the recipes taking it directly or as a member of an ingredient group ("Bauholz");
 *   station – the recipes made at it; building material – a build part placed with it; repair – the pieces whose
 *   mending costs it (tools, weapons and armour a station mends, priced by their recipe) and the build parts made of
 *   it (area repair with the hammer).
 *
 * Entries hold references (`Bezug`); `herkunftsGruppen`/`verwendungsGruppen` turn them into names of one language
 * for the tooltip (unique, in index order). The fuel entry lists its places separately (`brennstellenNamen`: the
 * tooltip puts them next to the burn time); the repair entry stands without names in the tooltip (what it mends is
 * made of the item, so it stands under "Zutat" already) – the tooltip must fit 270 design pixels.
 */
import { BALANCE } from '../../content/balance';
import { contentMaterialBook } from '../../game/building/materials';
import { CONTENT } from '../../content/index';
import { buildItemIndex, type ItemIndex } from '../../content/items/usage';
import { ITEM_USE_KINDS, type ItemUseKind } from '../../content/items/relations';
import { LIGHT_KINDS } from '../../content/lights';
import type { LocalizedText } from '../../content/schema/common';
import { ITEM_SOURCE_KINDS, parseItemSource, type ItemDef, type ItemSourceKind } from '../../content/schema/item';
import { contentRecipeBook, type RecipeBook } from '../../game/crafting/recipes';
import { HEARTH_ITEM } from '../../game/hearth/system';
import { contentItemCatalog } from '../../game/items/catalog';
import { repairRecipe } from '../../game/repair/formulas';
import type { I18n, Lang } from '../../i18n';

/** What an entry names: an item, a recipe (its name or its product's), a content record, or "without a station". */
export type Bezug =
  | { readonly art: 'item'; readonly id: string }
  | { readonly art: 'rezept'; readonly id: string }
  | { readonly art: 'datensatz'; readonly sammlung: string; readonly id: string }
  | { readonly art: 'hand' };

/** One kind of source or use with what it names. */
export interface Eintrag<K extends string> {
  readonly art: K;
  readonly bezuege: readonly Bezug[];
}

/** A place fuel burns in: the placeable item and which fuel it takes. */
export interface Brennstelle {
  readonly item: string;
  nimmt(def: ItemDef): boolean;
}

/** A build part and the items one piece of it is made of (its area repair costs a share of them). */
export interface Bauteil {
  readonly id: string;
  readonly materialien: readonly string[];
}

/** What the index is built from (the game's content, or fixtures in tests). */
export interface VerwendungsDaten {
  /** Recipes with their ingredient groups, stations and the item catalog. */
  readonly book: RecipeBook;
  /** Declared and derived sources and the items' own uses (src/content/items/usage.ts). */
  readonly index: Pick<ItemIndex, 'sources' | 'uses'>;
  /** The places fuel burns in. */
  readonly brennstellen: readonly Brennstelle[];
  /** The build parts. */
  readonly bauteile: readonly Bauteil[];
  /** Whether a station mends a piece of `def` (§13.1 "Reparatur an Werkbank, Amboss oder Schleifstein"). */
  readonly repariert: (def: ItemDef) => boolean;
  /** Name of a content record (world object, ground, creature, place), or `null`. */
  readonly datensatz: (sammlung: string, id: string) => LocalizedText | null;
}

/** Sources and uses of every item, with what they name. */
export interface Verwendungsindex {
  readonly book: RecipeBook;
  readonly datensatz: (sammlung: string, id: string) => LocalizedText | null;
  /** Sources of `item` by kind (empty for an unknown item). */
  herkunft(item: string): readonly Eintrag<ItemSourceKind>[];
  /** Uses of `item` by kind (empty for an unknown item). */
  verwendung(item: string): readonly Eintrag<ItemUseKind>[];
}

/** Kinds of uses that come from the item's own data (src/content/items/usage.ts `intrinsicItemUses`). */
const EIGENE: readonly ItemUseKind[] = ['essen', 'brennstoff', 'ausruesten', 'werkzeug', 'pflanzen', 'munition', 'werfen'];
/**
 * Rank of each source kind in the tooltips and the crafting hints (M6-30c): what the world offers first – gathering, then
 * digging –, then making it (processing, crafting), then creature loot, finds at places and the trader. A player looks for
 * the easy way first: flint is struck from rocks, not taken from a beach raider (the raw index sorts `drop:` before
 * `welt:`). A record, so a new source kind cannot be forgotten here.
 */
const SOURCE_RANK: Readonly<Record<ItemSourceKind, number>> = { welt: 0, graben: 1, rezept: 2, drop: 3, ort: 4, haendlerin: 5 };
/** The source kinds in the order tooltips and hints show them (`SOURCE_RANK`). */
export const SOURCE_DISPLAY_ORDER: readonly ItemSourceKind[] = (Object.keys(ITEM_SOURCE_KINDS) as ItemSourceKind[]).sort((a, b) => SOURCE_RANK[a] - SOURCE_RANK[b]);

/** Adds `b` to the list of `kind` in `map` unless an equal reference is there. */
function add<K>(map: Map<K, Bezug[]>, kind: K, b: Bezug | null): void {
  let list = map.get(kind);
  if (list === undefined) {
    list = [];
    map.set(kind, list);
  }
  if (b !== null && !list.some((x) => sameBezug(x, b))) list.push(b);
}

function sameBezug(a: Bezug, b: Bezug): boolean {
  if (a.art !== b.art) return false;
  if (a.art === 'hand' || b.art === 'hand') return true;
  if (a.art === 'datensatz' && b.art === 'datensatz') return a.sammlung === b.sammlung && a.id === b.id;
  return (a as { id: string }).id === (b as { id: string }).id;
}

function inOrder<K extends string>(map: Map<K, Bezug[]>, order: readonly K[]): Eintrag<K>[] {
  return order.filter((k) => map.has(k)).map((art) => ({ art, bezuege: map.get(art) ?? [] }));
}

/** Builds the index (see module comment). */
export function buildVerwendungsindex(d: VerwendungsDaten): Verwendungsindex {
  const { book } = d;
  const catalog = book.catalog;
  // Uses by item, filled per relation; sources are built per item on demand from the index and the book.
  const uses = new Map<string, Map<ItemUseKind, Bezug[]>>();
  const usesOf = (item: string): Map<ItemUseKind, Bezug[]> => {
    let m = uses.get(item);
    if (m === undefined) {
      m = new Map();
      uses.set(item, m);
    }
    return m;
  };
  for (const id of catalog.ids()) {
    const own = d.index.uses.get(id) ?? [];
    for (const u of own) if (u.by === undefined && EIGENE.includes(u.kind)) add(usesOf(id), u.kind, null);
    if (own.some((u) => u.kind === 'baukosten')) add(usesOf(id), 'baukosten', null);
    const def = catalog.get(id);
    for (const place of d.brennstellen) if (place.nimmt(def)) add(usesOf(id), 'brennstoff', { art: 'item', id: place.item });
  }
  for (const r of book.list) {
    for (const z of book.ingredients(r.id)) for (const item of z.items) add(usesOf(item), 'zutat', { art: 'rezept', id: r.id });
  }
  // A station: the recipes made at it (a station that only mends, the grindstone, stands without names).
  for (const s of book.stations.list) {
    if (!catalog.has(s.id)) continue;
    add(usesOf(s.id), 'station', null);
    for (const r of book.recipesAt(s.id)) add(usesOf(s.id), 'station', { art: 'rezept', id: r.id });
  }
  // Mending: a durable piece a station mends costs the ingredients of its recipe without durability.
  for (const id of catalog.ids()) {
    const def = catalog.get(id);
    if (def.haltbarkeit === undefined || !d.repariert(def)) continue;
    const r = repairRecipe(book, id);
    if (r === undefined) continue;
    for (const z of book.ingredients(r.id)) {
      if (z.items.some((i) => catalog.find(i)?.haltbarkeit !== undefined)) continue;
      for (const item of z.items) add(usesOf(item), 'reparatur', { art: 'item', id });
    }
  }
  // Area repair of build parts with the hammer.
  for (const part of d.bauteile) {
    for (const item of part.materialien) if (item !== part.id && catalog.has(item)) add(usesOf(item), 'reparatur', { art: 'item', id: part.id });
  }
  const verwendung = new Map<string, readonly Eintrag<ItemUseKind>[]>();
  for (const [item, m] of uses) verwendung.set(item, inOrder(m, ITEM_USE_KINDS));

  const herkunft = new Map<string, readonly Eintrag<ItemSourceKind>[]>();
  const herkunftVon = (item: string): readonly Eintrag<ItemSourceKind>[] => {
    const cached = herkunft.get(item);
    if (cached !== undefined) return cached;
    const m = new Map<ItemSourceKind, Bezug[]>();
    for (const raw of d.index.sources.get(item) ?? []) {
      const s = parseItemSource(raw);
      if (s === null || s.kind === 'rezept') continue;
      const sammlung = ITEM_SOURCE_KINDS[s.kind];
      add(m, s.kind, sammlung === null || s.id === null ? null : { art: 'datensatz', sammlung, id: s.id });
    }
    for (const r of book.recipesFor(item)) add(m, 'rezept', r.station === null ? { art: 'hand' } : { art: 'item', id: r.station });
    const out = catalog.has(item) ? inOrder(m, SOURCE_DISPLAY_ORDER) : [];
    herkunft.set(item, out);
    return out;
  };

  return {
    book,
    datensatz: d.datensatz,
    herkunft: herkunftVon,
    verwendung: (item) => verwendung.get(item) ?? [],
  };
}

/** Name of reference `b` in `lang` (`null` when it names nothing known). */
function bezugName(ix: Verwendungsindex, b: Bezug, i18n: I18n): string | null {
  const lang = i18n.lang;
  switch (b.art) {
    case 'hand':
      return i18n.t('ui.handwerk.ohneStation');
    case 'item':
      return ix.book.catalog.find(b.id)?.name[lang] ?? null;
    case 'rezept': {
      const r = ix.book.find(b.id);
      if (r === undefined) return null;
      return r.name?.[lang] ?? ix.book.catalog.find(r.ergebnis.item)?.name[lang] ?? null;
    }
    case 'datensatz':
      return ix.datensatz(b.sammlung, b.id)?.[lang] ?? null;
  }
}

/** Names of `bezuege`, unique, in their order. */
function namen(ix: Verwendungsindex, bezuege: readonly Bezug[], i18n: I18n): string[] {
  const out: string[] = [];
  for (const b of bezuege) {
    const n = bezugName(ix, b, i18n);
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Sources of `item` by kind with names of `i18n`'s language (records of a kind sorted by name, places in book order). */
export function herkunftsGruppen(ix: Verwendungsindex, item: string, i18n: I18n): { kind: ItemSourceKind; names: string[] }[] {
  return ix.herkunft(item).map((e) => {
    const names = namen(ix, e.bezuege, i18n);
    return { kind: e.art, names: e.art === 'rezept' ? names : names.sort((a, b) => a.localeCompare(b, i18n.lang)) };
  });
}

/**
 * Kinds whose names the tooltip leaves out: fuel names its places next to the burn time (`brennstellenNamen`), and a
 * mend costs a share of the recipe, so what it mends already stands under "Zutat" – the kind alone says it.
 */
const OHNE_NAMEN: ReadonlySet<ItemUseKind> = new Set(['brennstoff', 'reparatur']);

/** Uses of `item` by kind with names of `i18n`'s language (fuel and repair without names, see `OHNE_NAMEN`). */
export function verwendungsGruppen(ix: Verwendungsindex, item: string, i18n: I18n): { kind: ItemUseKind; names: string[] }[] {
  return ix.verwendung(item).map((e) => ({ kind: e.art, names: OHNE_NAMEN.has(e.art) ? [] : namen(ix, e.bezuege, i18n) }));
}

/** Names of the places `item` burns in (empty for no fuel). */
export function brennstellenNamen(ix: Verwendungsindex, item: string, lang: Lang): string[] {
  const e = ix.verwendung(item).find((x) => x.art === 'brennstoff');
  const out: string[] = [];
  for (const b of e?.bezuege ?? []) {
    const n = b.art === 'item' ? ix.book.catalog.find(b.id)?.name[lang] : undefined;
    if (n !== undefined && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * The places fuel burns in (content): fires (campfire, fireplace) take whatever has a burn value, processing stations
 * with a fuel slot what burns at least their minimum (§15.4), the hearth its fuels (§16.5), a lamp its own fuel.
 */
export function contentBrennstellen(book: RecipeBook): Brennstelle[] {
  const out: Brennstelle[] = [];
  for (const k of LIGHT_KINDS) {
    if (!book.catalog.has(k.gegenstand)) continue;
    if (k.verhalten === 'feuer') out.push({ item: k.gegenstand, nimmt: (def) => def.brennwert !== undefined });
    const lampe = k.moebel?.brennstoff;
    if (k.verhalten === 'lampe' && lampe !== undefined) out.push({ item: k.gegenstand, nimmt: (def) => def.id === lampe });
  }
  for (const s of book.stations.list) {
    const fuel = book.stations.fuel(s.id);
    if (fuel !== null && book.catalog.has(s.id)) out.push({ item: s.id, nimmt: (def) => def.brennwert !== undefined && def.brennwert >= fuel.minBurnSeconds });
  }
  if (book.catalog.has(HEARTH_ITEM)) out.push({ item: HEARTH_ITEM, nimmt: (def) => BALANCE.hearth.fuelGameHours[def.id] !== undefined });
  return out;
}

/** Whether some station of `book` mends a piece of `def` (its category up to its tier). */
export function stationRepariert(book: RecipeBook, def: ItemDef): boolean {
  return book.stations.list.some((s) => s.reparatur !== undefined && (s.reparatur.kategorien as readonly string[]).includes(def.kategorie) && def.stufe <= s.reparatur.bisStufe);
}

/** Name of the content record `id` of collection `sammlung`, or `null`. */
function contentDatensatzName(sammlung: string, id: string): LocalizedText | null {
  if (!CONTENT.has(sammlung, id)) return null;
  const record = CONTENT.collections().find((c) => c.name === sammlung)?.get(id) as { name?: unknown } | undefined;
  const name = record?.name;
  return typeof name === 'object' && name !== null && typeof (name as { de?: unknown }).de === 'string' && typeof (name as { en?: unknown }).en === 'string' ? (name as LocalizedText) : null;
}

let content: Verwendungsindex | null = null;

/** The index of the game's content (built on first use; `index`: the content's item index, when already built). */
export function contentVerwendungsindex(index?: ItemIndex): Verwendungsindex {
  if (content !== null) return content;
  const book = contentRecipeBook(contentItemCatalog());
  const materials = contentMaterialBook();
  content = buildVerwendungsindex({
    book,
    index: index ?? buildItemIndex(CONTENT),
    brennstellen: contentBrennstellen(book),
    bauteile: CONTENT.collection('buildParts')
      .values()
      .map((p) => ({ id: p.id, materialien: materials.materials(p.id).map((m) => m.item) })),
    repariert: (def) => stationRepariert(book, def),
    datensatz: contentDatensatzName,
  });
  return content;
}
