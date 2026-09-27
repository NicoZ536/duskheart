/**
 * M4-21, §16.7 "Suche über alle Kisten der Basis": the rules of the chest screen's search tab (src/ui/screens/kiste/
 * modell.ts) – the compass direction of a chest in eight sectors, where a chest with finds stands ("diese Kiste",
 * "8 Felder nordwestlich"), which base the search runs over (a hearth's zone or the chests around this one, singular
 * and plural), which slots of the open chest hold a find – and what the item tooltip of each kind of slot of the chest
 * screen shows (`kistenTippZiel`), in German and English.
 */
import { describe, expect, it } from 'vitest';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { emptyBags } from '../../../src/game/inventory/bags';
import { newStack } from '../../../src/game/items/stack';
import { createI18n } from '../../../src/i18n';
import { kistenTippZiel } from '../../../src/ui/screens/kiste/KisteScreen';
import { basisText, ortText, richtung, trefferIn } from '../../../src/ui/screens/kiste/modell';
import type { SucheAnsicht } from '../../../src/ui/screens/kiste/sucheQuelle';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });
const catalog = contentItemCatalog();
const stack = (id: string, n = 1) => newStack(catalog.get(id), n);

describe('Richtung und Ort', () => {
  it('teilt die Richtung in acht Sektoren (y wächst nach Süden)', () => {
    expect(richtung(0, -5)).toBe('n');
    expect(richtung(4, -4)).toBe('no');
    expect(richtung(6, 1)).toBe('o');
    expect(richtung(3, 3)).toBe('so');
    expect(richtung(-1, 7)).toBe('s');
    expect(richtung(-5, 5)).toBe('sw');
    expect(richtung(-3, 0)).toBe('w');
    expect(richtung(-2, -2)).toBe('nw');
    expect(richtung(0, 0)).toBeNull();
  });

  it('nennt die offene Kiste „diese Kiste“ und andere mit Entfernung und Richtung', () => {
    expect(ortText(de, { offen: true, dx: 0, dy: 0, entfernung: 0 })).toBe('diese Kiste');
    expect(ortText(de, { offen: false, dx: -6, dy: -6, entfernung: 8 })).toBe('8 Felder nordwestlich');
    expect(ortText(de, { offen: false, dx: 1, dy: 0, entfernung: 1 })).toBe('1 Feld östlich');
    expect(ortText(en, { offen: false, dx: 0, dy: 3, entfernung: 3 })).toBe('3 tiles south');
    expect(ortText(en, { offen: true, dx: 0, dy: 0, entfernung: 0 })).toBe('this chest');
  });

  it('nennt die Basis: Zone des Herdfeuers oder Umkreis ohne Herdfeuer', () => {
    expect(basisText(de, { herd: false, radius: 12, kistenGesamt: 3 })).toBe('Umkreis 12 Felder: 3 Kisten');
    expect(basisText(de, { herd: true, radius: 12, kistenGesamt: 1 })).toBe('Basis des Herdfeuers (12 Felder): 1 Kiste');
    expect(basisText(en, { herd: false, radius: 12, kistenGesamt: 1 })).toBe('Within 12 tiles: 1 chest');
  });

  it('hebt die Plätze der offenen Kiste mit Funden hervor', () => {
    const ansicht: Pick<SucheAnsicht, 'kisten'> = {
      kisten: [
        {
          id: 2,
          item: 'kiste_holz',
          name: '',
          label: null,
          dx: 0,
          dy: 0,
          entfernung: 0,
          offen: true,
          funde: [
            { index: 0, stack: stack('stein', 5) },
            { index: 3, stack: stack('stein', 2) },
          ],
          stueck: 7,
        },
        { id: 5, item: 'kiste_holz', name: 'Erze', label: null, dx: 4, dy: 0, entfernung: 4, offen: false, funde: [{ index: 1, stack: stack('stein', 9) }], stueck: 9 },
      ],
    };
    expect([...trefferIn(ansicht, 2)]).toEqual([0, 3]);
    expect([...trefferIn(ansicht, 5)]).toEqual([1]);
    expect(trefferIn(ansicht, 9).size).toBe(0);
    expect(trefferIn(null, 2).size).toBe(0);
  });
});

describe('Tooltips des Kistenbildschirms', () => {
  const bags = emptyBags();
  const mitAxt = { ...bags, schnellleiste: bags.schnellleiste.map((s, i) => (i === 0 ? stack('steinaxt') : s)) };
  const ansicht = { vorhanden: true, id: 1, item: 'kiste_holz', name: '', label: null, slots: [stack('lehm', 4), null], nur: null, inReichweite: true };
  const suche: SucheAnsicht = {
    vorhanden: true,
    herd: false,
    radius: 12,
    kistenGesamt: 2,
    kisten: [{ id: 7, item: 'truhe', name: '', label: null, dx: 3, dy: 0, entfernung: 3, offen: false, funde: [{ index: 2, stack: stack('holz', 6) }], stueck: 6 }],
  };

  it('zeigt für jeden Schlüssel sein Item und seinen Stapel', () => {
    expect(kistenTippZiel('kiste:0', catalog, mitAxt, ansicht, suche)).toMatchObject({ def: { id: 'lehm' }, stack: { count: 4 }, aus: null });
    expect(kistenTippZiel('kiste:1', catalog, mitAxt, ansicht, suche)).toBeNull();
    expect(kistenTippZiel('tasche:schnellleiste:0', catalog, mitAxt, ansicht, suche)).toMatchObject({ def: { id: 'steinaxt' }, aus: { bereich: 'schnellleiste', index: 0 } });
    expect(kistenTippZiel('fund:7:2', catalog, mitAxt, ansicht, suche)).toMatchObject({ def: { id: 'holz' }, stack: { count: 6 }, aus: null });
    expect(kistenTippZiel('fund:7:3', catalog, mitAxt, ansicht, suche)).toBeNull();
    expect(kistenTippZiel('item:stein', catalog, mitAxt, ansicht, suche)).toMatchObject({ def: { id: 'stein' }, stack: null });
    expect(kistenTippZiel('unbekannt:1', catalog, mitAxt, ansicht, suche)).toBeNull();
  });
});
