/**
 * M4-07/M4-08/M4-32: the rules of the recipe screens (src/ui/screens/handwerk/modell.ts) on the game's content – the
 * rows of the visible recipes with what the ingredients at hand afford, search (umlauts folded, product names
 * before ingredient matches) and filter, the ingredients of an order with what is missing, the solution hint of a
 * missing item ("Fehlt: 2× Brett – herstellbar am Sägebock"), the quantity range, the quality preview (§13.1) and
 * the place phrase of every station in both languages; plus the pixel symbols of the screens.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { createI18n } from '../../../src/i18n';
import { SYMBOL_GROESSE, symbolRaster, type SymbolId } from '../../../src/ui/screens/handwerk/glyphen';
import {
  bedarfItems,
  bedarfStationen,
  contentRezeptKontext,
  fehltText,
  filterAuswahl,
  filtern,
  herstellbar,
  loesungsHinweis,
  MAX_STERNE,
  mengeKlemmen,
  naechsterFilter,
  ortSchluessel,
  qualitaetsVorschau,
  rezeptZeilen,
  suchform,
  zutatZeilen,
  type Vorrat,
} from '../../../src/ui/screens/handwerk/modell';

const ctx = contentRezeptKontext();
const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

function vorrat(items: Record<string, number>, chests: Record<string, number> = {}): Vorrat {
  return { imBeutel: (i) => items[i] ?? 0, verfuegbar: (i) => (items[i] ?? 0) + (chests[i] ?? 0) };
}

const handRecipes = ctx.book.list.filter((r) => r.station === null);

describe('Rezeptzeilen', () => {
  it('zählt, wie oft die Zutaten in Taschen und Kisten reichen – eine Gruppe mit allen Mitgliedern', () => {
    expect(herstellbar(ctx, 'rezept_faserseil', vorrat({ fasern: 10 }))).toBe(3);
    expect(herstellbar(ctx, 'rezept_steinaxt', vorrat({ zweig: 4, stein: 5, faserseil: 1 }))).toBe(1);
    expect(herstellbar(ctx, 'rezept_steinaxt', vorrat({ zweig: 4, stein: 5 }, { faserseil: 3 }))).toBe(2);
    // Bauholz: logs and driftwood together (two planks per piece).
    expect(herstellbar(ctx, 'rezept_brett', vorrat({ holz: 2, treibholz: 3 }))).toBe(5);
    const rows = rezeptZeilen(ctx, handRecipes, vorrat({ fasern: 6 }), 'de');
    expect(rows.map((r) => r.id)).toEqual(handRecipes.map((r) => r.id));
    expect(rows.find((r) => r.id === 'rezept_faserseil')).toMatchObject({ name: 'Faserseil', stueck: 1, herstellbar: 2 });
    // A recipe with its own name keeps it ("Eimer füllen").
    const bucket = rows.find((r) => r.id === 'rezept_holzeimer_wasser');
    expect(bucket?.name).toBe(ctx.book.get('rezept_holzeimer_wasser').name?.de ?? ctx.book.catalog.get('holzeimer_wasser').name.de);
  });
});

describe('Suche und Filter', () => {
  const rows = rezeptZeilen(ctx, ctx.book.list, vorrat({ fasern: 3, zweig: 2, stein: 2 }), 'de');

  it('faltet Groß-/Kleinschreibung, Umlaute und ß', () => {
    expect(suchform('Sägebock', 'de')).toBe('sagebock');
    expect(suchform('  STRAßE ', 'de')).toBe('strasse');
    expect(filtern(ctx, rows, 'sage', 'alle', 'de').map((r) => r.id)).toContain('rezept_saegebock');
    expect(filtern(ctx, rows, 'säge', 'alle', 'de').map((r) => r.id)).toContain('rezept_saegebock');
  });

  it('stellt Treffer im Produktnamen vor Treffer über eine Zutat', () => {
    const hits = filtern(ctx, rows, 'faserseil', 'alle', 'de').map((r) => r.id);
    expect(hits[0]).toBe('rezept_faserseil');
    // Recipes that only need rope follow ("what can I make from it").
    expect(hits).toContain('rezept_steinaxt');
    expect(hits.indexOf('rezept_steinaxt')).toBeGreaterThan(0);
    expect(filtern(ctx, rows, 'xyzzy', 'alle', 'de')).toEqual([]);
  });

  it('filtert nach herstellbar und nach Produktkategorie; die Auswahl nennt nur vorhandene Kategorien', () => {
    const handRows = rezeptZeilen(ctx, handRecipes, vorrat({ fasern: 3 }), 'de');
    expect(filtern(ctx, handRows, '', 'herstellbar', 'de').map((r) => r.id)).toEqual(['rezept_faserseil']);
    expect(filtern(ctx, handRows, '', 'werkzeug', 'de').every((r) => r.produkt.kategorie === 'werkzeug')).toBe(true);
    const auswahl = filterAuswahl(handRows);
    expect(auswahl.slice(0, 2)).toEqual(['alle', 'herstellbar']);
    expect(auswahl).toContain('werkzeug');
    expect(auswahl).not.toContain('barren');
    expect(naechsterFilter(auswahl, 'alle', 1)).toBe('herstellbar');
    expect(naechsterFilter(auswahl, 'alle', -1)).toBe(auswahl[auswahl.length - 1]);
    expect(naechsterFilter(auswahl, auswahl[auswahl.length - 1] ?? 'alle', 1)).toBe('alle');
  });
});

describe('Zutaten, fehlende Zutaten und Lösungshinweise', () => {
  it('rechnet die Menge hoch und nennt, was fehlt', () => {
    const rows = zutatZeilen(ctx, 'rezept_steinaxt', 3, vorrat({ zweig: 4, stein: 2 }, { stein: 3 }), 'de');
    expect(rows.map((z) => [z.key, z.braucht, z.hat, z.imBeutel, z.fehlt])).toEqual([
      ['zweig', 6, 4, 4, 2],
      ['stein', 6, 5, 2, 1],
      ['faserseil', 3, 0, 0, 3],
    ]);
  });

  it('zeigt eine Gruppe mit ihrem Namen und dem Mitglied, von dem am meisten da ist', () => {
    const [bauholz] = zutatZeilen(ctx, 'rezept_brett', 2, vorrat({ holz: 1, treibholz: 4 }), 'de');
    expect(bauholz).toMatchObject({ key: 'bauholz', gruppe: true, iconItem: 'treibholz', braucht: 2, hat: 5, fehlt: 0 });
    expect(bauholz?.name).toBe(CONTENT.collection('ingredientGroups').get('bauholz').name.de);
  });

  it('sagt, wo es entsteht: ohne Station, an einer Station, in einer Verarbeitungsstation, sonst wo es zu finden ist', () => {
    const none = new Set<string>();
    expect(loesungsHinweis(de, ctx, 'faserseil', none)).toBe('herstellbar ohne Station');
    expect(loesungsHinweis(de, ctx, 'brett', none)).toBe('herstellbar am Sägebock');
    expect(loesungsHinweis(en, ctx, 'brett', none)).toBe('craftable at the sawbuck');
    expect(loesungsHinweis(de, ctx, 'ziegel', none)).toBe('entsteht im Lehmofen');
    expect(loesungsHinweis(de, ctx, 'lehm', none)).toBe('Graben mit der Schaufel: Lehm');
    expect(loesungsHinweis(de, ctx, 'holz', none)).toMatch(/^Sammeln in der Welt: \S+, \S+$/);
    // Charcoal has two recipes: the kiln and a burning campfire – a visible one goes first.
    expect(loesungsHinweis(de, ctx, 'holzkohle', new Set(['rezept_holzkohle_lagerfeuer']))).toBe('herstellbar am brennenden Lagerfeuer');
    expect(loesungsHinweis(de, ctx, 'holzkohle', new Set(['rezept_holzkohle']))).toBe('entsteht im Köhlermeiler');
  });

  it('formt die Zeile „Fehlt: 2× Brett – herstellbar am Sägebock“', () => {
    const rows = zutatZeilen(ctx, 'rezept_wand_holz', 1, vorrat({ brett: 1 }), 'de');
    const brett = rows.find((z) => z.key === 'brett');
    expect(brett).toBeDefined();
    if (brett === undefined) return;
    expect(fehltText(de, ctx, brett, new Set())).toBe('Fehlt: 2× Brett – herstellbar am Sägebock');
    expect(fehltText(en, ctx, zutatZeilen(ctx, 'rezept_wand_holz', 1, vorrat({ brett: 1 }), 'en')[0] ?? brett, new Set())).toBe('Missing: 2× Plank – craftable at the sawbuck');
  });

  it('fragt genau die Zutaten (Gruppen mit allen Mitgliedern) und Stationen der Rezepte ab', () => {
    expect(bedarfItems(ctx, ['rezept_faserseil', 'rezept_brett'])).toEqual(['fasern', 'holz', 'treibholz']);
    expect(bedarfStationen(ctx, ['rezept_faserseil', 'rezept_brett', 'rezept_ziegel'])).toEqual(['lehmofen', 'saegebock']);
  });
});

describe('Menge und Qualität', () => {
  it('hält die Menge ganz zwischen 1 und dem größten Auftrag', () => {
    expect(mengeKlemmen(0)).toBe(1);
    expect(mengeKlemmen(-5)).toBe(1);
    expect(mengeKlemmen(7.4)).toBe(7);
    expect(mengeKlemmen(Number.NaN)).toBe(1);
    expect(mengeKlemmen(1e9)).toBe(BALANCE.crafting.maxOrderCount);
  });

  it('zeigt Sterne nur für Stücke mit Qualität; in der Hand höchstens zwei, an Werkbank II früher mehr', () => {
    const axe = ctx.book.catalog.get('steinaxt');
    const rope = ctx.book.catalog.get('faserseil');
    expect(MAX_STERNE).toBe(3);
    expect(qualitaetsVorschau(rope, 100, null)).toBeNull();
    expect(qualitaetsVorschau(axe, 1, null)).toBe(1);
    expect(qualitaetsVorschau(axe, 40, null)).toBe(2);
    expect(qualitaetsVorschau(axe, 100, null)).toBe(BALANCE.crafting.quality.handMaxStars);
    expect(qualitaetsVorschau(axe, 80, 0)).toBe(3);
    expect(qualitaetsVorschau(axe, 60, BALANCE.stations.stages.werkbank_2.qualitaet)).toBe(3);
  });
});

describe('Texte', () => {
  it('jede Station hat ihre Ortsangabe auf Deutsch und Englisch', () => {
    for (const s of CONTENT.collection('stations').values()) {
      expect(de.t(ortSchluessel(s.id)).length).toBeGreaterThan(0);
      expect(en.t(ortSchluessel(s.id)).length).toBeGreaterThan(0);
    }
  });
});

describe('Pixelsymbole', () => {
  it('sind 7 × 7 Raster aus „#“ und „.“', () => {
    const ids: SymbolId[] = ['stern', 'nadel', 'lupe', 'kiste', 'flamme', 'pfeil', 'uhr', 'kreuz', 'haken', 'links', 'rechts'];
    for (const id of ids) {
      const raster = symbolRaster(id);
      expect(raster).toHaveLength(SYMBOL_GROESSE);
      for (const row of raster) expect(row).toMatch(new RegExp(`^[#.]{${SYMBOL_GROESSE}}$`));
    }
  });
});
