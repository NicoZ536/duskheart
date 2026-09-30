/**
 * M4-08 "‚Verwendet in'/‚Herkunft' für jedes Item nachschlagbar" (MASTERPROMPT §15.1, §26): the Verwendungsindex
 * (src/ui/tooltip/verwendung.ts) names what an item comes from and goes into, and the item tooltip shows both lists for
 * every item.
 *
 * - Sources: made where (without a station, at which stations), gathered from which world objects, dug from which
 *   grounds.
 * - Uses: recipes taking the item directly and through an ingredient group ("Bauholz"), what a station makes, build
 *   parts placed with it (building material), where a fuel burns (a fire takes any burn value, the smelting furnace
 *   only charcoal and better, the hearth its fuels, a lamp its resin), and what its mending costs (tools a station
 *   mends, build parts repaired with the hammer).
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { RECIPES } from '../../../src/content/recipes/index';
import { defineRecipeGroup } from '../../../src/content/recipes/define';
import { RecipeBook } from '../../../src/game/crafting/recipes';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { createI18n } from '../../../src/i18n';
import { itemTooltip } from '../../../src/ui/tooltip/itemTooltip';
import { contentItemLookup } from '../../../src/ui/tooltip/lookup';
import {
  brennstellenNamen,
  buildVerwendungsindex,
  contentVerwendungsindex,
  herkunftsGruppen,
  verwendungsGruppen,
  type Bezug,
  type Verwendungsindex,
} from '../../../src/ui/tooltip/verwendung';

const catalog = contentItemCatalog();
const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });
const name = (id: string): string => catalog.get(id).name.de;

/** The references of use kind `art` of `item`. */
function bezuege(ix: Verwendungsindex, item: string, art: string): readonly Bezug[] {
  return ix.verwendung(item).find((e) => e.art === art)?.bezuege ?? [];
}

/** The recipe ids a use kind of `item` names. */
function rezepte(ix: Verwendungsindex, item: string, art: string): string[] {
  return bezuege(ix, item, art).flatMap((b) => (b.art === 'rezept' ? [b.id] : []));
}

/** The item ids a use kind of `item` names. */
function items(ix: Verwendungsindex, item: string, art: string): string[] {
  return bezuege(ix, item, art).flatMap((b) => (b.art === 'item' ? [b.id] : []));
}

describe('Verwendungsindex: reine Regeln (Probe-Rezepte)', () => {
  // A plank from any building wood at the sawbuck, a stone axe in the hand, a wall of planks.
  const book = new RecipeBook(
    defineRecipeGroup('proben', [
      { id: 'rezept_brett', ergebnis: { item: 'brett', anzahl: 2 }, zutaten: [{ gruppe: 'bauholz', anzahl: 1 }], station: 'saegebock', dauer: 'werkzeug' },
      { id: 'rezept_steinaxt', ergebnis: { item: 'steinaxt', anzahl: 1 }, zutaten: [{ item: 'stein', anzahl: 2 }, { item: 'zweig', anzahl: 1 }], station: null, dauer: 'werkzeug' },
      { id: 'rezept_wand_holz', ergebnis: { item: 'wand_holz', anzahl: 1 }, zutaten: [{ item: 'brett', anzahl: 3 }], station: 'werkbank', dauer: 'werkzeug' },
    ]),
    catalog,
  );
  const ix = buildVerwendungsindex({
    book,
    index: {
      sources: new Map([['holz', ['welt:baum_eiche', 'welt:baum_birke']]]),
      uses: new Map([
        ['holz', [{ kind: 'brennstoff' }]],
        ['wand_holz', [{ kind: 'baukosten', by: 'buildParts/wand_holz' }]],
      ]),
    },
    brennstellen: [
      { item: 'lagerfeuer', nimmt: (d) => d.brennwert !== undefined },
      { item: 'schmelzofen', nimmt: (d) => (d.brennwert ?? 0) >= 120 },
    ],
    bauteile: [{ id: 'wand_holz', materialien: ['brett', 'brett', 'wand_holz'] }],
    repariert: (d) => d.kategorie === 'werkzeug',
    datensatz: (sammlung, id) => (sammlung === 'worldObjects' ? { de: `Baum ${id}`, en: `Tree ${id}` } : null),
  });

  it('Zutat direkt und über eine Zutatengruppe; Station; Baumaterial', () => {
    expect(rezepte(ix, 'stein', 'zutat')).toEqual(['rezept_steinaxt']);
    // Log and driftwood are both "Bauholz": both go into the plank.
    expect(rezepte(ix, 'holz', 'zutat')).toEqual(['rezept_brett']);
    expect(rezepte(ix, 'treibholz', 'zutat')).toEqual(['rezept_brett']);
    expect(rezepte(ix, 'saegebock', 'station')).toEqual(['rezept_brett']);
    expect(ix.verwendung('wand_holz').map((e) => e.art)).toEqual(['baukosten']);
  });

  it('Brennstoff mit den Stellen, die ihn nehmen – nach Brennwert gefiltert', () => {
    expect(items(ix, 'holz', 'brennstoff')).toEqual(['lagerfeuer']);
    expect(items(ix, 'holzkohle', 'brennstoff')).toEqual(['lagerfeuer', 'schmelzofen']);
    expect(ix.verwendung('stein').some((e) => e.art === 'brennstoff')).toBe(false);
    // In the tooltip the kind stands alone; the places stand next to the burn time.
    expect(verwendungsGruppen(ix, 'holz', de)[0]).toEqual({ kind: 'brennstoff', names: [] });
    expect(verwendungsGruppen(ix, 'stein', de)).toEqual([
      { kind: 'zutat', names: [name('steinaxt')] },
      { kind: 'reparatur', names: [] },
    ]);
    expect(brennstellenNamen(ix, 'holzkohle', 'de')).toEqual([name('lagerfeuer'), name('schmelzofen')]);
  });

  it('Reparatur: was ein Werkzeug und ein Bauteil beim Ausbessern kosten, ohne Doppel und ohne sich selbst', () => {
    expect(items(ix, 'stein', 'reparatur')).toEqual(['steinaxt']);
    expect(items(ix, 'zweig', 'reparatur')).toEqual(['steinaxt']);
    expect(items(ix, 'brett', 'reparatur')).toEqual(['wand_holz']);
    expect(ix.verwendung('wand_holz').some((e) => e.art === 'reparatur')).toBe(false);
  });

  it('Herkunft: Stationen der Rezepte oder ohne Station, Datensätze der Quellen; Reihenfolge der Arten fest', () => {
    expect(herkunftsGruppen(ix, 'brett', de)).toEqual([{ kind: 'rezept', names: [name('saegebock')] }]);
    expect(herkunftsGruppen(ix, 'steinaxt', de)).toEqual([{ kind: 'rezept', names: ['Ohne Station'] }]);
    expect(herkunftsGruppen(ix, 'holz', en)).toEqual([{ kind: 'welt', names: ['Tree baum_birke', 'Tree baum_eiche'] }]);
    expect(ix.herkunft('gibt_es_nicht')).toEqual([]);
    expect(ix.verwendung('gibt_es_nicht')).toEqual([]);
  });
});

describe('Verwendungsindex des Spiels', () => {
  const ix = contentVerwendungsindex();

  it('Rezeptverwendungen nennen die Erzeugnisse; Gruppenmitglieder gehen in die Rezepte der Gruppe', () => {
    expect(rezepte(ix, 'stein', 'zutat')).toContain('rezept_steinaxt');
    expect(rezepte(ix, 'faserseil', 'zutat')).toEqual(expect.arrayContaining(['rezept_steinaxt', 'rezept_werkbank']));
    // Driftwood is never named by a recipe, only through the group "Bauholz" – and still goes into planks.
    const gruppe = CONTENT.collection('recipes').get('rezept_brett').zutaten;
    expect(gruppe.some((z) => 'gruppe' in z)).toBe(true);
    expect(rezepte(ix, 'treibholz', 'zutat')).toContain('rezept_brett');
    expect(rezepte(ix, 'holz', 'zutat')).toEqual(expect.arrayContaining(['rezept_brett', 'rezept_holzeimer']));
    const zutat = verwendungsGruppen(ix, 'treibholz', de).find((g) => g.kind === 'zutat');
    expect(zutat?.names).toContain(name('brett'));
  });

  it('Baumaterial: ein Bauteil wird im Baumodus gesetzt', () => {
    for (const part of ['wand_holz', 'dach_stroh', 'tuer_holz']) expect(ix.verwendung(part).map((e) => e.art), part).toContain('baukosten');
  });

  it('Brennstoff: Holz in Feuern, Öfen, Meiler und Herdfeuer, nicht im Schmelzofen; Holzkohle auch dort; Harz nur in Lampen', () => {
    const holz = items(ix, 'holz', 'brennstoff');
    expect(holz).toEqual(expect.arrayContaining(['lagerfeuer', 'kamin_stein', 'koehlermeiler', 'lehmofen', 'herdfeuer']));
    expect(holz).not.toContain('schmelzofen');
    expect(items(ix, 'holzkohle', 'brennstoff')).toEqual(expect.arrayContaining(['schmelzofen', 'herdfeuer', 'lagerfeuer']));
    // Twigs burn in fires and kilns, but the hearth takes only logs and charcoal (§16.5).
    expect(items(ix, 'zweig', 'brennstoff')).not.toContain('herdfeuer');
    const harz = items(ix, 'harz', 'brennstoff');
    expect(harz).toEqual(expect.arrayContaining(['harzlampe', 'harzlampe_wand']));
    expect(harz).not.toContain('lagerfeuer');
    expect(catalog.get('harz').brennwert).toBeUndefined();
    expect(ix.verwendung('stein').some((e) => e.art === 'brennstoff')).toBe(false);
  });

  it('Reparatur: die Steinaxt kostet Stein, eine Palisade Holz', () => {
    expect(items(ix, 'stein', 'reparatur')).toContain('steinaxt');
    expect(items(ix, 'holz', 'reparatur')).toContain('wand_palisade');
  });

  it('Station: die Werkbank nennt, was an ihr entsteht', () => {
    expect(rezepte(ix, 'werkbank', 'station')).toEqual(expect.arrayContaining(['rezept_saegebock', 'rezept_wand_holz']));
    expect(rezepte(ix, 'werkbank_2', 'station')).toEqual(expect.arrayContaining(['rezept_saegebock', 'rezept_truhe']));
  });

  it('Herkunft: Station der Verarbeitung, ohne Station, Welt-Objekte und Böden beim Graben', () => {
    expect(herkunftsGruppen(ix, 'brett', de)).toEqual([{ kind: 'rezept', names: [name('saegebock')] }]);
    expect(herkunftsGruppen(ix, 'holzkohle', de)[0]).toEqual({ kind: 'rezept', names: [name('koehlermeiler'), name('lagerfeuer')] });
    expect(herkunftsGruppen(ix, 'werkbank', de)).toEqual([{ kind: 'rezept', names: ['Ohne Station'] }]);
    const kies = herkunftsGruppen(ix, 'kies', de);
    expect(kies.map((g) => g.kind)).toEqual(['welt', 'graben']);
    expect(kies[1]?.names).toEqual(['Dünengras', 'Erde', 'Gras', 'Sand']);
    const beeren = herkunftsGruppen(ix, 'himbeeren', de);
    expect(beeren.map((g) => g.kind)).toEqual(['welt']);
    for (const n of beeren[0]?.names ?? []) expect(CONTENT.collection('worldObjects').values().some((o) => o.name.de === n)).toBe(true);
  });

  it('der Tooltip jedes Items zeigt „Herkunft“ und „Verwendet in“ – mit Namen, Brennstellen neben der Brenndauer', () => {
    const lookup = contentItemLookup();
    expect(lookup.verzeichnis).toBe(ix);
    for (const id of catalog.ids()) {
      const m = itemTooltip(de, { def: catalog.get(id), stack: null, lookup });
      const herkunft = m.sections.find((s) => s.heading === 'Herkunft');
      const verwendet = m.sections.find((s) => s.heading === 'Verwendet in');
      expect(herkunft?.lines.length, id).toBeGreaterThan(0);
      expect(verwendet?.lines.length, id).toBeGreaterThan(0);
    }
    const holz = itemTooltip(de, { def: catalog.get('holz'), stack: null, lookup });
    const texte = holz.sections.flatMap((s) => s.lines.map((l) => l.text));
    // Burn time and places in one line; fuel and repair stand as kinds (what a mend costs is made of it: "Zutat").
    expect(texte).toContainEqual(expect.stringMatching(/^Brennt 45 s in Lagerfeuer, Steinkamin, Köhlermeiler und \d+ weitere$/));
    const verwendet = holz.sections.find((s) => s.heading === 'Verwendet in')?.lines.map((l) => l.text) ?? [];
    expect(verwendet).toEqual(['Brennstoff', expect.stringMatching(/^Zutat: Holzeimer, Lagerfeuer, Werkbank und \d+ weitere$/), 'Reparatur']);
    // Resin has no burn time: it names only the lamps.
    const harz = itemTooltip(de, { def: catalog.get('harz'), stack: null, lookup }).sections.flatMap((s) => s.lines.map((l) => l.text));
    expect(harz).toContainEqual(expect.stringMatching(/^Brennt in: Harzlampe, Wand-Harzlampe, /));
    const brett = itemTooltip(en, { def: catalog.get('brett'), stack: null, lookup });
    expect(brett.sections.find((s) => s.heading === 'Source')?.lines.map((l) => l.text)).toEqual([`Crafting: ${catalog.get('saegebock').name.en}`]);
    // A station that only mends (the grindstone) is still a station.
    expect(itemTooltip(de, { def: catalog.get('schleifstein'), stack: null, lookup }).sections.find((s) => s.heading === 'Verwendet in')?.lines.map((l) => l.text)).toContain('Station');
  });

  it('ohne bekannte Quelle oder Verwendung sagt der Tooltip das, statt die Überschrift wegzulassen; ein Endprodukt wird selbst benutzt', () => {
    // An index that knows nothing of these items (a later source, a use that comes with a later milestone).
    const leer = buildVerwendungsindex({ book: ix.book, index: { sources: new Map(), uses: new Map() }, brennstellen: [], bauteile: [], repariert: () => false, datensatz: () => null });
    const lookup = { ...contentItemLookup(), verzeichnis: leer };
    // The shell: its use (a talisman) comes with M7-62, so no recipe of the book names it either (the fly agaric, the
    // earlier example, is in the poison arrow since M6-11).
    const muschel = itemTooltip(de, { def: catalog.get('muschel'), stack: null, lookup });
    expect(muschel.sections.find((s) => s.heading === 'Herkunft')?.lines).toEqual([{ text: 'Herkunft unbekannt', tone: 'dim' }]);
    expect(muschel.sections.find((s) => s.heading === 'Verwendet in')?.lines).toEqual([{ text: 'Keine bekannte Verwendung', tone: 'dim' }]);
    expect(catalog.get('verband').endprodukt).toBe(true);
    const verband = itemTooltip(en, { def: catalog.get('verband'), stack: null, lookup: contentItemLookup() });
    expect(verband.sections.find((s) => s.heading === 'Used in')?.lines).toEqual([{ text: 'Used as it is', tone: 'dim' }]);
  });

  it('RECIPES und der Index kennen dieselben Rezepte', () => {
    expect(ix.book.list.map((r) => r.id)).toEqual(RECIPES.map((r) => r.id));
  });
});
