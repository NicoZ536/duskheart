/**
 * What the build mode offers (MASTERPROMPT §16.6 "Baumodus (B) mit Kategorienleiste (Fundament/Boden, Wände,
 * Türen/Fenster, Dächer, Möbel, Stationen, Licht, Lagerung, Landwirtschaft, Verteidigung, Deko, Lumen-Netz) und
 * Suche"; M4-22). Pure and derived from the content: every build part (src/content/buildParts.ts and the furniture
 * of M4-19) and every station set up on the grid (src/content/stations.ts; the camp fire is set up from the hand) is
 * one entry, in the category its kind and furniture category name – except stages only an upgrade makes in place
 * (`nurAufwerten`: Werkbank II). A category without entries is not shown (§2.1 "keine coming-soon-Menüs"): defence
 * parts arrive with M6, the Lumen network with M11.
 *
 * - Order inside a category: tier, then content order.
 * - Search (`sucheEintraege`): every word of the query in the German or English name or the id, case, accents and
 *   ß folded ("tur" finds "Tür", "strasse" finds "Straße").
 * - Costs (`bauKosten`): the ingredients of the plain recipe that makes the piece (`rezept_<id>`), per craft, with
 *   the station it is made at; availability (`vorrat`): the pieces in the bags – placing takes from the bags only.
 */
import type { LocalizedText } from '../../../content/schema/common';
import { buildPartSpriteId, type FurnitureCategory, type PartKind } from '../../../content/buildParts';
import { CONTENT } from '../../../content/index';
import { stationSpriteId } from '../../../content/stations';
import { RECIPE_ID_PREFIX } from '../../../content/recipes/schema';
import type { BagsState } from '../../../game/inventory/bags';
import { countItem } from '../../../game/inventory/ops';
import { CARRY_AREAS, type SlotRef } from '../../../game/items/slots';
import { generatedAtlasModule } from '../../../render/assets/generated';
import { dragShapeOf, rotatableKind, type DragShape, type PieceSource } from '../../../render/game/ghost';

/** The categories of the build bar in their order (§16.6). */
export const BAU_KATEGORIEN = ['fundament', 'waende', 'tueren', 'daecher', 'moebel', 'stationen', 'licht', 'lagerung', 'landwirtschaft', 'verteidigung', 'deko', 'lumen'] as const;
/** One category. */
export type BauKategorie = (typeof BAU_KATEGORIEN)[number];

/** One piece the build mode offers. */
export interface BauEintrag {
  /** The placed item (part id or station id). */
  readonly id: string;
  readonly source: PieceSource;
  readonly kategorie: BauKategorie;
  /** Kind of the build part (`null`: a station). */
  readonly kind: PartKind | null;
  readonly name: LocalizedText;
  readonly stufe: number;
  /** Footprint when not rotated [tiles]. */
  readonly b: number;
  readonly t: number;
  /** R turns it (stairs, gate); F mirrors it (furniture and stations with a mirrorable sprite). */
  readonly drehbar: boolean;
  readonly spiegelbar: boolean;
  /** How dragging places it (§16.6: walls as outline, floors filled). */
  readonly ziehen: DragShape;
}

/** Ids of the sprites that may stand mirrored (`spiegelbar`, docs/ART.md), read once from the game atlas. */
let spiegelbareSprites: ReadonlySet<string> | null = null;

/**
 * Whether F may mirror a piece drawn with sprite `id`: the game view mirrors only `spiegelbar` sprites
 * (src/render/game/building.ts, stations.ts), so the build mode offers F only there – F never promises what the picture
 * does not show. Without the atlas (before `npm run assets`) nothing mirrors.
 */
function spriteSpiegelbar(id: string): boolean {
  if (spiegelbareSprites === null) {
    const sprites = generatedAtlasModule()?.SPRITES ?? {};
    spiegelbareSprites = new Set(Object.values(sprites).filter((s) => s.spiegelbar).map((s) => s.id));
  }
  return spiegelbareSprites.has(id);
}

/** Category of a build part by its kind and furniture category, or `null` when no category takes it yet. */
export function kategorieVon(art: PartKind, moebel: FurnitureCategory | undefined): BauKategorie | null {
  switch (art) {
    case 'boden':
    case 'steg':
    case 'treppe':
    case 'leiter':
      return 'fundament';
    case 'wand':
    case 'saeule':
    case 'zaun':
      return 'waende';
    case 'tuer':
    case 'tor':
    case 'fenster':
    case 'falltuer':
      return 'tueren';
    case 'dach':
      return 'daecher';
    case 'moebel':
    case 'wandmoebel':
      switch (moebel) {
        case 'licht':
          return 'licht';
        case 'lager':
          return 'lagerung';
        case 'station':
          return 'stationen';
        case 'beet':
        case 'trog':
          return 'landwirtschaft';
        case 'deko':
        case 'teppich':
        case 'bild':
        case 'pflanze':
        case 'trophaee':
          return 'deko';
        case undefined:
          return null;
        default:
          return 'moebel';
      }
  }
}

let katalog: readonly BauEintrag[] | null = null;

/** Every piece of the build mode (built once from the content). */
export function bauKatalog(): readonly BauEintrag[] {
  if (katalog !== null) return katalog;
  const items = CONTENT.collection('items');
  const out: Array<BauEintrag & { readonly ordnung: number }> = [];
  let ordnung = 0;
  for (const p of CONTENT.collection('buildParts').values()) {
    const kategorie = kategorieVon(p.art, p.kategorie);
    const item = items.find(p.id);
    if (kategorie === null || item === undefined) continue;
    const moebel = (p.art === 'moebel' || p.art === 'wandmoebel') && spriteSpiegelbar(buildPartSpriteId(p.id, p.art));
    out.push({
      id: p.id,
      source: 'bauteil',
      kategorie,
      kind: p.art,
      name: item.name,
      stufe: item.stufe,
      b: p.groesse?.b ?? 1,
      t: p.groesse?.t ?? 1,
      drehbar: rotatableKind(p.art),
      spiegelbar: moebel,
      ziehen: dragShapeOf(p.art),
      ordnung: ordnung++,
    });
  }
  const teile = new Set(out.map((e) => e.id));
  for (const s of CONTENT.collection('stations').values()) {
    const item = items.find(s.id);
    // The camp fire is set up from the hand like a torch; a station that is a build part is listed as one; a stage
    // that only an upgrade recipe makes at its place (Werkbank II, `nurAufwerten`) is never set up from the bags.
    if (s.brennt === true || s.nurAufwerten === true || item === undefined || teile.has(s.id)) continue;
    out.push({ id: s.id, source: 'station', kategorie: 'stationen', kind: null, name: item.name, stufe: item.stufe, b: s.groesse.b, t: s.groesse.t, drehbar: false, spiegelbar: spriteSpiegelbar(stationSpriteId(s.id)), ziehen: 'einzeln', ordnung: ordnung++ });
  }
  out.sort((a, b) => BAU_KATEGORIEN.indexOf(a.kategorie) - BAU_KATEGORIEN.indexOf(b.kategorie) || a.stufe - b.stufe || a.ordnung - b.ordnung);
  katalog = Object.freeze(out.map(({ ordnung: _o, ...e }) => Object.freeze(e)));
  return katalog;
}

/** The categories that have pieces, in bar order. */
export function sichtbareKategorien(eintraege: readonly BauEintrag[]): BauKategorie[] {
  return BAU_KATEGORIEN.filter((k) => eintraege.some((e) => e.kategorie === k));
}

/** The pieces of one category. */
export function eintraegeDer(eintraege: readonly BauEintrag[], kategorie: BauKategorie): BauEintrag[] {
  return eintraege.filter((e) => e.kategorie === kategorie);
}

/** Lower case without accents, ß as ss (search). */
export function normalisiere(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase();
}

/** The pieces whose German or English name or id contains every word of `text` (empty query: none). */
export function sucheEintraege(eintraege: readonly BauEintrag[], text: string): BauEintrag[] {
  const woerter = normalisiere(text).split(/\s+/).filter((w) => w.length > 0);
  if (woerter.length === 0) return [];
  return eintraege.filter((e) => {
    const heu = normalisiere(`${e.name.de} ${e.name.en} ${e.id.replace(/_/g, ' ')}`);
    return woerter.every((w) => heu.includes(w));
  });
}

/** One ingredient of the costs: an item or an ingredient group, and how many. */
export interface BauZutat {
  readonly item: string | null;
  readonly gruppe: string | null;
  readonly name: LocalizedText;
  readonly anzahl: number;
}

/** What a piece costs: its recipe's ingredients per craft, the pieces one craft makes, where it is made. */
export interface BauKosten {
  readonly zutaten: readonly BauZutat[];
  readonly ergebnis: number;
  /** Station item (its name via the item catalog), or `null` for the hand. */
  readonly station: string | null;
}

/** The plain recipe of a piece (`rezept_<id>`, else the first recipe that makes it), or `null` (found, not made). */
export function bauKosten(id: string): BauKosten | null {
  const recipes = [...CONTENT.collection('recipes').values()].filter((r) => r.ergebnis.item === id);
  const r = recipes.find((x) => x.id === `${RECIPE_ID_PREFIX}${id}`) ?? recipes[0];
  if (r === undefined) return null;
  const items = CONTENT.collection('items');
  const groups = CONTENT.collection('ingredientGroups');
  const zutaten: BauZutat[] = [];
  for (const z of r.zutaten) {
    if ('item' in z) {
      const def = items.find(z.item);
      if (def !== undefined) zutaten.push({ item: z.item, gruppe: null, name: def.name, anzahl: z.anzahl });
    } else {
      const g = groups.find(z.gruppe);
      if (g !== undefined) zutaten.push({ item: null, gruppe: z.gruppe, name: g.name, anzahl: z.anzahl });
    }
  }
  return { zutaten, ergebnis: r.ergebnis.anzahl, station: r.station ?? null };
}

/** Pieces of `id` in the carried bags – what placing takes from (`countItem`, the building system's count). */
export function vorrat(bags: BagsState | null, id: string): number {
  return bags === null ? 0 : countItem(bags, id);
}

/** The first carried bag slot holding `id` (for `station.place`), or `null`. */
export function platzMit(bags: BagsState | null, id: string): SlotRef | null {
  if (bags === null) return null;
  for (const b of CARRY_AREAS) {
    const i = bags[b].findIndex((s) => s !== null && s.item === id);
    if (i >= 0) return { bereich: b, index: i };
  }
  return null;
}
