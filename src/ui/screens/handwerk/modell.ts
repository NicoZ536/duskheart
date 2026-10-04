/**
 * Rules of the recipe screens as plain data (MASTERPROMPT §15.1, §13.1, §26 "Fehlermeldungen sagen, was fehlt
 * und wie man es löst"; M4-07, M4-08, M4-32), so they are unit tested (tests/unit/ui/handwerk-modell.test.ts) and
 * the components only lay them out:
 *
 * - **Recipe rows** of the visible recipes (`rezeptZeilen`): name, product, pieces per craft, how many crafts
 *   the ingredients at hand afford (bags and chests in reach, group ingredients counting all members).
 * - **Search and filter** (`filtern`, `filterAuswahl`): the search matches product names first, then ingredient
 *   names ("what can I make from clay"), case and accents folded; the filter is all, craftable now, or a product
 *   category present in the list.
 * - **Ingredients** of an order of `menge` crafts (`zutatZeilen`) with what is at hand and what is missing, and a
 *   **solution hint** per missing item (`loesungsHinweis`): where it is made – without a station, at a hand
 *   station, in a processing station, at a burning fire (visible recipes first) – or else where it is found (the
 *   item's sources, "Sammeln in der Welt: Eiche, Birke").
 * - **Quantity** (`mengeKlemmen`: 1 … `BALANCE.crafting.maxOrderCount`) and the **quality preview** of the next
 *   piece (`qualitaetsVorschau`: the stars of §13.1 from the Handwerk level and the station at hand; `null` for
 *   products without a quality).
 */
import { BALANCE } from '../../../content/balance';
import type { RecipeDef } from '../../../content/recipes/schema';
import { ITEM_CATEGORIES, type ItemCategory, type ItemDef } from '../../../content/schema/item';
import { affordablePieces, craftSeconds, hasQuality, qualityStars } from '../../../game/crafting/formulas';
import { contentRecipeBook, type RecipeBook, type ResolvedIngredient } from '../../../game/crafting/recipes';
import { contentItemCatalog } from '../../../game/items/catalog';
import type { I18n, Lang } from '../../../i18n';
import { contentItemLookup, sourceGroups, type ItemLookup } from '../../tooltip/lookup';

const C = BALANCE.crafting;

/** Most stars a piece can have (§13.1 "Qualität 1–3 Sterne"). */
export const MAX_STERNE = C.quality.thresholds.length + 1;
/** Names of the sources a solution hint lists at most (the hint stays one line). */
const HINWEIS_NAMEN = 2;

/** Recipes, items and their sources. */
export interface RezeptKontext {
  readonly book: RecipeBook;
  readonly lookup: ItemLookup;
}

let content: RezeptKontext | null = null;

/** The context of the game's content (built on first use). */
export function contentRezeptKontext(): RezeptKontext {
  content ??= { book: contentRecipeBook(contentItemCatalog()), lookup: contentItemLookup() };
  return content;
}

/** What is at hand: usable pieces in the bags, and in the bags and the chests in reach together. */
export interface Vorrat {
  verfuegbar(item: string): number;
  imBeutel(item: string): number;
}

/** Nothing at hand (before the first sample). */
export const KEIN_VORRAT: Vorrat = { verfuegbar: () => 0, imBeutel: () => 0 };

/** Filter of a recipe list: every recipe, the ones craftable now, or a product category. */
export type RezeptFilter = 'alle' | 'herstellbar' | ItemCategory;

/** A recipe as the list shows it. */
export interface RezeptZeile {
  readonly id: string;
  readonly recipe: RecipeDef;
  readonly produkt: ItemDef;
  readonly name: string;
  /** Pieces one craft makes. */
  readonly stueck: number;
  /** Crafts the ingredients at hand afford. */
  readonly herstellbar: number;
}

/** Display name of a recipe: its own name ("Eimer füllen") or its product's. */
export function rezeptName(recipe: Pick<RecipeDef, 'name'>, produkt: Pick<ItemDef, 'name'>, lang: Lang): string {
  return recipe.name?.[lang] ?? produkt.name[lang];
}

/** Crafts the ingredients of `id` afford with `vorrat`. */
export function herstellbar(ctx: RezeptKontext, id: string, vorrat: Vorrat): number {
  return affordablePieces(ctx.book.ingredients(id), (item) => vorrat.verfuegbar(item));
}

/** The rows of `recipes` (book order kept). */
export function rezeptZeilen(ctx: RezeptKontext, recipes: readonly RecipeDef[], vorrat: Vorrat, lang: Lang): RezeptZeile[] {
  return recipes.map((recipe) => {
    const produkt = ctx.book.catalog.get(recipe.ergebnis.item);
    return { id: recipe.id, recipe, produkt, name: rezeptName(recipe, produkt, lang), stueck: recipe.ergebnis.anzahl, herstellbar: herstellbar(ctx, recipe.id, vorrat) };
  });
}

/** Lower case without accents ("Säge" → "sage"), so the search forgives umlauts either way. */
export function suchform(text: string, lang: Lang): string {
  return text
    .toLocaleLowerCase(lang)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .trim();
}

/** Name of an ingredient: the item's or the group's. */
export function zutatName(ctx: RezeptKontext, z: ResolvedIngredient, lang: Lang): string {
  if (z.gruppe) return ctx.book.group(z.key)?.name[lang] ?? z.key;
  return ctx.book.catalog.get(z.key).name[lang];
}

/**
 * The rows matching `suche` and `filter`: product name matches first, then rows that match only through an
 * ingredient; each part in its original order.
 */
export function filtern(ctx: RezeptKontext, zeilen: readonly RezeptZeile[], suche: string, filter: RezeptFilter, lang: Lang): RezeptZeile[] {
  const q = suchform(suche, lang);
  const passt = (z: RezeptZeile): boolean => (filter === 'alle' ? true : filter === 'herstellbar' ? z.herstellbar > 0 : z.produkt.kategorie === filter);
  const vorne: RezeptZeile[] = [];
  const hinten: RezeptZeile[] = [];
  for (const z of zeilen) {
    if (!passt(z)) continue;
    if (q === '' || suchform(z.name, lang).includes(q) || suchform(z.produkt.name[lang], lang).includes(q)) vorne.push(z);
    else if (ctx.book.ingredients(z.id).some((i) => suchform(zutatName(ctx, i, lang), lang).includes(q))) hinten.push(z);
  }
  return [...vorne, ...hinten];
}

/** Filters to offer for `zeilen`: all, craftable, then the product categories present (category order). */
export function filterAuswahl(zeilen: readonly RezeptZeile[]): RezeptFilter[] {
  const present = new Set(zeilen.map((z) => z.produkt.kategorie));
  return ['alle', 'herstellbar', ...ITEM_CATEGORIES.filter((c) => present.has(c))];
}

/** The filter `schritt` steps after `aktuell` in `auswahl` (wrapping). */
export function naechsterFilter(auswahl: readonly RezeptFilter[], aktuell: RezeptFilter, schritt: number): RezeptFilter {
  const i = auswahl.indexOf(aktuell);
  const n = auswahl.length;
  return auswahl[(((i < 0 ? 0 : i) + schritt) % n + n) % n] ?? 'alle';
}

/** Quantity of an order: whole, 1 … `BALANCE.crafting.maxOrderCount`. */
export function mengeKlemmen(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(C.maxOrderCount, Math.max(1, Math.round(n)));
}

/** One ingredient of an order of `menge` crafts. */
export interface ZutatZeile {
  /** Item id, or the group id. */
  readonly key: string;
  readonly gruppe: boolean;
  readonly name: string;
  /** Item whose icon stands for it (a group: the member most at hand, else its first). */
  readonly iconItem: string;
  readonly braucht: number;
  /** Usable pieces at hand (bags and chests in reach; a group: all members). */
  readonly hat: number;
  /** Of those in the bags. */
  readonly imBeutel: number;
  readonly fehlt: number;
}

/** The ingredients of `menge` crafts of recipe `id` with what is at hand. */
export function zutatZeilen(ctx: RezeptKontext, id: string, menge: number, vorrat: Vorrat, lang: Lang): ZutatZeile[] {
  return ctx.book.ingredients(id).map((z) => {
    let hat = 0;
    let beutel = 0;
    let icon = z.items[0] ?? z.key;
    let best = -1;
    for (const item of z.items) {
      const n = vorrat.verfuegbar(item);
      hat += n;
      beutel += vorrat.imBeutel(item);
      if (n > best) {
        best = n;
        icon = item;
      }
    }
    const braucht = z.anzahl * menge;
    return { key: z.key, gruppe: z.gruppe, name: zutatName(ctx, z, lang), iconItem: icon, braucht, hat, imBeutel: beutel, fehlt: Math.max(0, braucht - hat) };
  });
}

/** Every item an ingredient of `recipes` can be (the sample counts them). */
export function bedarfItems(ctx: RezeptKontext, recipes: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of recipes) for (const z of ctx.book.ingredients(id)) for (const item of z.items) out.add(item);
  return [...out].sort();
}

/** Every station kind of `recipes` (the sample looks for them). */
export function bedarfStationen(ctx: RezeptKontext, recipes: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of recipes) {
    const s = ctx.book.get(id).station;
    if (s !== null) out.add(s);
  }
  return [...out].sort();
}

/** i18n key of the place phrase of station `station` ("am Sägebock", "im Lehmofen"). */
export function ortSchluessel(station: string): string {
  return `ui.handwerk.ort.${station}`;
}

/**
 * How to get `item` (the "wie man es löst" of §26): the first recipe making it – visible ones first, then made in
 * the hand before at a station – as "herstellbar ohne Station", "herstellbar am Sägebock", "entsteht im Lehmofen";
 * without a recipe the first kind of its sources in the tooltip's order – world and digging before creature loot, M6-30c
 * (flint: "Sammeln in der Welt: …", not the beach raider who also drops it) – with up to `namenMax` names ("Sammeln in der
 * Welt: Eiche, Birke"; the HUD tracker names only the kind).
 */
export function loesungsHinweis(i18n: I18n, ctx: RezeptKontext, item: string, sichtbar: ReadonlySet<string>, namenMax: number = HINWEIS_NAMEN): string {
  const recipes = [...ctx.book.recipesFor(item)].sort((a, b) => Number(sichtbar.has(b.id)) - Number(sichtbar.has(a.id)) || Number(a.station !== null) - Number(b.station !== null));
  const r = recipes[0];
  if (r !== undefined) {
    if (r.station === null) return i18n.t('ui.handwerk.loesung.hand');
    const ort = i18n.t(ortSchluessel(r.station));
    return i18n.t(ctx.book.isProcessing(r) ? 'ui.handwerk.loesung.verarbeitung' : 'ui.handwerk.loesung.station', { ort });
  }
  const group = sourceGroups(ctx.lookup, item, i18n.lang)[0];
  if (group === undefined) return i18n.t('ui.handwerk.loesung.unbekannt');
  const art = i18n.t(`ui.item.quelle.${group.kind}`);
  const names = group.names.slice(0, namenMax);
  return names.length === 0 ? art : i18n.t('ui.handwerk.loesung.quelle', { art, namen: names.join(', ') });
}

/** The line of a missing ingredient: "Fehlt: 2× Brett – herstellbar am Sägebock" (a group: its first member's hint). */
export function fehltText(i18n: I18n, ctx: RezeptKontext, zeile: ZutatZeile, sichtbar: ReadonlySet<string>): string {
  const item = zeile.gruppe ? (ctx.book.group(zeile.key)?.items[0] ?? zeile.key) : zeile.key;
  return i18n.t('ui.handwerk.fehlt', { anzahl: zeile.fehlt, name: zeile.name, hinweis: loesungsHinweis(i18n, ctx, item, sichtbar) });
}

/** Crafting time of one craft without skill and station [s] (the list's time class). */
export function dauerSekunden(recipe: Pick<RecipeDef, 'dauer'>): number {
  return craftSeconds(recipe);
}

/**
 * Stars the next piece of `produkt` gets (§13.1) at Handwerk level `stufe` – at the station at hand with
 * `stationPunkte` quality points, or in the hand (`null`); `null` for products without a quality.
 */
export function qualitaetsVorschau(produkt: Pick<ItemDef, 'haltbarkeit' | 'werte'>, stufe: number, stationPunkte: number | null): number | null {
  return hasQuality(produkt) ? qualityStars(stufe, stationPunkte) : null;
}
