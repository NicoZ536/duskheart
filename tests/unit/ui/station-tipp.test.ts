/**
 * M4-07/M4-09, §26 "Vergleichs-Tooltips (grün/rot), ‚Verwendet in'/‚Herkunft'": what the item tooltip of each kind of
 * element of the station screen shows (`stationTippZiel`: a recipe's product or ingredient, an order's product, a bag or
 * equipment stack, a slot of the station) and which piece a stack compares with (`vergleichFuer`: the worn piece of its kind, a tool with
 * the one in the hand – not with itself), like in the inventory; the tooltip model then carries "Herkunft" and
 * "Verwendet in".
 */
import { describe, expect, it } from 'vitest';
import { emptyBags } from '../../../src/game/inventory/bags';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import { createI18n } from '../../../src/i18n';
import { contentItemLookup, itemTooltip } from '../../../src/ui/tooltip';
import type { StationAnsicht } from '../../../src/ui/screens/station/ansicht';
import { stationTippZiel } from '../../../src/ui/screens/station/StationScreen';
import { vergleichFuer } from '../../../src/ui/screens/station/tipp';

const catalog = contentItemCatalog();
const stack = (id: string, n = 1) => newStack(catalog.get(id), n);

const ofen: StationAnsicht = {
  vorhanden: true,
  id: 3,
  station: 'lehmofen',
  inReichweite: true,
  verarbeitung: true,
  eingang: [stack('lehm', 6), null],
  brennstoff: stack('holz', 2),
  ausgang: [stack('keramik_topf'), null],
  rezept: null,
  fortschritt: 0,
  glut: 0,
  laeuft: false,
  halt: null,
};

describe('Tooltip-Schlüssel des Stationsbildschirms', () => {
  const bags = { ...emptyBags(), inventar: emptyBags().inventar.map((s, i) => (i === 2 ? stack('stein', 5) : s)) };

  it('zeigt Items, Taschenstapel und Plätze der Station', () => {
    expect(stationTippZiel('item:ziegel', catalog, bags, ofen)).toMatchObject({ def: { id: 'ziegel' }, stack: null, aus: null });
    expect(stationTippZiel('tasche:inventar:2', catalog, bags, ofen)).toMatchObject({ def: { id: 'stein' }, stack: { count: 5 }, aus: { bereich: 'inventar', index: 2 } });
    expect(stationTippZiel('tasche:inventar:3', catalog, bags, ofen)).toBeNull();
    expect(stationTippZiel('station:eingang:0', catalog, bags, ofen)).toMatchObject({ def: { id: 'lehm' }, stack: { count: 6 }, aus: null });
    expect(stationTippZiel('station:brennstoff:0', catalog, bags, ofen)).toMatchObject({ def: { id: 'holz' }, stack: { count: 2 } });
    expect(stationTippZiel('station:ausgang:0', catalog, bags, ofen)).toMatchObject({ def: { id: 'keramik_topf' } });
    expect(stationTippZiel('station:ausgang:1', catalog, bags, ofen)).toBeNull();
    expect(stationTippZiel('station:eingang:0', catalog, bags, null)).toBeNull();
    expect(stationTippZiel('item:gibtsnicht', catalog, bags, ofen)).toBeNull();
    // An order of the recipe book's queue: its recipe's product.
    const produkt = (r: string): string | undefined => (r === 'rezept_saegebock' ? 'saegebock' : undefined);
    expect(stationTippZiel('rezept:rezept_saegebock', catalog, bags, ofen, produkt)).toMatchObject({ def: { id: 'saegebock' }, stack: null });
    expect(stationTippZiel('rezept:unbekannt', catalog, bags, ofen, produkt)).toBeNull();
  });

  it('trägt Herkunft und Verwendung im Modell', () => {
    const ziel = stationTippZiel('station:eingang:0', catalog, bags, ofen);
    if (ziel === null) throw new Error('no target');
    const de = createI18n('de', { strict: true });
    const model = itemTooltip(de, { def: ziel.def, stack: ziel.stack, lookup: contentItemLookup() });
    expect(model.title).toBe('Lehm');
    expect(model.sections.map((s) => s.heading)).toEqual(expect.arrayContaining(['Herkunft', 'Verwendet in']));
  });
});

describe('Vergleich wie im Inventar', () => {
  it('vergleicht ein Werkzeug mit dem in der Hand, aber nicht mit sich selbst', () => {
    const base = emptyBags();
    const bags = { ...base, schnellleiste: base.schnellleiste.map((s, i) => (i === 0 ? stack('steinaxt') : s)), auswahl: 0 };
    const bronze = { def: catalog.get('bronzeaxt'), stack: stack('bronzeaxt'), aus: null };
    expect(vergleichFuer(bags, bronze, catalog)).toMatchObject({ def: { id: 'steinaxt' } });
    expect(vergleichFuer(bags, { def: catalog.get('steinaxt'), stack: stack('steinaxt'), aus: { bereich: 'schnellleiste', index: 0 } }, catalog)).toBeNull();
    expect(vergleichFuer(bags, { def: catalog.get('steinaxt'), stack: null, aus: null }, catalog)).toBeNull();
    expect(vergleichFuer(null, bronze, catalog)).toBeNull();
    expect(vergleichFuer(bags, { def: catalog.get('stein'), stack: stack('stein'), aus: null }, catalog)).toBeNull();
  });
});
