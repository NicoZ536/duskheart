/**
 * All items (docs/SPIEL.md §2): the group files joined into the registry collection `items`
 * (src/content/index.ts), plus the conventions around items – §C count categories, icon and figure
 * layer sprites – and the derived sources and uses (usage.ts, relations.ts).
 *
 * A new group file (`werkzeuge.ts`, `grundlagen.ts` …) validates its records with
 * `defineItemGroup` and adds one entry to `ITEM_GROUPS`.
 */
import type { ContentCategory } from '../categories';
import type { ItemCategory, ItemDef } from '../schema/item';
import { NAHRUNG } from './nahrung';
import { ROHSTOFFE } from './rohstoffe';
import { SETZLINGE } from './setzlinge';
import { WERKZEUGE } from './werkzeuge';
import { GRUNDLAGEN } from './grundlagen';
import { STATIONEN } from './stationen';
import { VERARBEITUNG } from './verarbeitung';
import { BRONZEWERKZEUGE } from './verarbeitung_bronzewerkzeuge';
import { BAUTEILE } from './bauteile';
import { LAGERUNG } from './lagerung';
import { HERDFEUER } from './herdfeuer';
import { HEILMITTEL } from './heilmittel';
import { MOEBEL } from './moebel';
import { MOEBEL_DEKO } from './moebel_deko';

/** Item groups in registry order (one entry per group file). */
export const ITEM_GROUPS = {
  rohstoffe: ROHSTOFFE,
  nahrung: NAHRUNG,
  setzlinge: SETZLINGE,
  werkzeuge: WERKZEUGE,
  grundlagen: GRUNDLAGEN,
  // Stations, processing products and bronze tools T0–T1 (M4-05, M4-06, M4-10).
  stationen: STATIONEN,
  verarbeitung: VERARBEITUNG,
  verarbeitung_bronzewerkzeuge: BRONZEWERKZEUGE,
  // Build parts T0–T1: walls, floors, roofs, doors, windows, pillars, fences, ladder, stairs, jetty (M4-12).
  bauteile: BAUTEILE,
  // Storage, the hearth fire and the splint (M4-20, M4-21, M4-35).
  lagerung: LAGERUNG,
  herdfeuer: HERDFEUER,
  heilmittel: HEILMITTEL,
  // Furniture, lights, decoration and wall objects T0–T1 (M4-19); their build parts: src/content/buildPartsAlle.ts.
  moebel: MOEBEL,
  moebel_deko: MOEBEL_DEKO,
} as const satisfies Record<string, readonly ItemDef[]>;

/** Every item, in group order. */
export const ITEMS: readonly ItemDef[] = Object.values(ITEM_GROUPS).flat();

/**
 * §C categories an item counts towards (ADR-0006): every item counts once as `items`; weapons,
 * armour pieces, jewellery, dishes & drinks, potions & medicine and build parts also in their
 * specialist category.
 */
const SPECIALIST_COUNT: Partial<Record<ItemCategory, ContentCategory>> = {
  waffe: 'weapons',
  ruestung: 'armor',
  schmuck: 'jewelry',
  gericht: 'dishes',
  trank: 'potions',
  medizin: 'potions',
  bauteil: 'buildParts',
};

/** §C count categories of one item. */
export function itemCountCategories(item: Pick<ItemDef, 'kategorie'>): ContentCategory[] {
  const specialist = SPECIALIST_COUNT[item.kategorie];
  return specialist === undefined ? ['items'] : ['items', specialist];
}

/** Icon sprite of an item (16×16; also drawn for the item lying in the world). */
export function itemIconId(itemId: string): string {
  return `icon_${itemId}`;
}

/** Figure layers of equipment (§4.5 "Ausrüstung als Layer (Kopf, Körper, Beine, Waffe, Nebenhand)"). */
export const FIGURE_LAYERS = ['kopf', 'koerper', 'beine', 'waffe', 'nebenhand'] as const;
/** One figure layer. */
export type FigureLayer = (typeof FIGURE_LAYERS)[number];

/**
 * The figure layer an item is drawn on while worn or held, or `null` when it is not drawn on the
 * figure (materials, food, jewellery, backpacks). Boots belong to the legs layer, a cloak on the back
 * to the body layer; tools and weapons are held in the weapon hand.
 */
export function itemFigureLayer(item: { readonly kategorie: string; readonly ausruestung?: string | undefined }): FigureLayer | null {
  switch (item.kategorie) {
    case 'werkzeug':
    case 'waffe':
      return 'waffe';
    case 'schild':
    case 'licht':
      return 'nebenhand';
    case 'ruestung':
      return item.ausruestung === 'kopf' ? 'kopf' : item.ausruestung === 'beine' || item.ausruestung === 'fuesse' ? 'beine' : 'koerper';
    default:
      return null;
  }
}

/** Layer sprite of an item drawn on the figure (docs/SPIEL.md §5 `ausruestung_<itemId>`). */
export function itemLayerSpriteId(itemId: string): string {
  return `ausruestung_${itemId}`;
}

export { baseItem, defineItemGroup, ITEM_SFX, ItemGroupError, type ItemSpec } from './define';
export { ITEM_RELATIONS, ITEM_USE_KINDS, referencePathMatches, type ItemRelation, type ItemSourceRelation, type ItemUseKind, type ItemUseRelation } from './relations';
export { buildItemIndex, classifyItemReference, intrinsicItemUses, ITEMS_COLLECTION, type ItemIndex, type ItemUse } from './usage';
