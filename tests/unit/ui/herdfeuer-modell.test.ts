/**
 * M4-20: the rules of the hearth screen (src/ui/screens/herdfeuer/modell.ts) – the game time the fire lasts
 * ("brennt noch 5 h 20 min"), the status of a burning, ready or empty hearth, what it burns and its store as 40
 * places in burn order, the ember core niches (set, ready from the bags, locked until the beacon – only those whose
 * core item exists in the content, none before the beacons bring them), the search
 * over item names in both languages, the finds joined per chest and item, the chest names and the refusal texts –
 * every text in German and English – and the screen's pixel symbols.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { HEARTH_REJECT_REASONS } from '../../../src/game/hearth/events';
import { emptyBags, withSlot } from '../../../src/game/inventory/bags';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import { createI18n } from '../../../src/i18n';
import { herdSymbolRaster, type HerdSymbol } from '../../../src/ui/screens/herdfeuer/glyphen';
import {
  brenndauerText,
  brennstunden,
  findeImBeutel,
  fundZeilen,
  herdAblehnung,
  herdNimmt,
  herdStatus,
  istHerdBrennstoff,
  kistenTitel,
  nischen,
  radiusMax,
  suchItems,
  vorratsSegmente,
} from '../../../src/ui/screens/herdfeuer/modell';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });
const catalog = contentItemCatalog();
const stack = (id: string, n = 1) => newStack(catalog.get(id), n);
const items = catalog.ids().map((id) => catalog.get(id));

describe('Brenndauer in Spielzeit', () => {
  it('zeigt Stunden und Minuten, volle Stunden ohne Minuten, unter einer Stunde nur Minuten', () => {
    expect(brenndauerText(de, 5 * 60 + 20)).toBe('5 h 20 min');
    expect(brenndauerText(de, 3 * 60)).toBe('3 h');
    expect(brenndauerText(de, 45)).toBe('45 min');
    expect(brenndauerText(de, 0)).toBe('0 min');
    // Parts of a minute count as a whole one: a burning fire never shows "0 min".
    expect(brenndauerText(de, 0.2)).toBe('1 min');
    expect(brenndauerText(en, 23 * 60 + 20)).toBe('23 h 20 min');
  });
});

describe('Zustand des Feuers', () => {
  it('brennend mit Restzeit, kalt mit Brennstoff, kalt und leer', () => {
    const brennt = herdStatus(de, { brennt: true, restMinuten: 5 * 60 + 20, stueck: 4, glut: 0.5 });
    expect(brennt).toEqual({ titel: 'Brennt noch', detail: '5 h 20 min', text: 'Brennt noch 5 h 20 min', ton: 'brennt' });
    const bereit = herdStatus(de, { brennt: false, restMinuten: 0, stueck: 3, glut: 0 });
    expect(bereit.ton).toBe('bereit');
    expect(bereit.titel).toBe('Erloschen');
    expect(bereit.text).toContain('kein Schutz');
    // A doused hearth keeps the glow of its piece: it is ready to be lit again.
    expect(herdStatus(de, { brennt: false, restMinuten: 0, stueck: 0, glut: 0.3 }).ton).toBe('bereit');
    const leer = herdStatus(en, { brennt: false, restMinuten: 0, stueck: 0, glut: 0 });
    expect(leer).toMatchObject({ titel: 'Out', detail: 'No fuel', ton: 'leer' });
    expect(herdStatus(en, { brennt: true, restMinuten: 90, stueck: 1, glut: 1 }).text).toBe('Burns for another 1 h 30 min');
  });
});

describe('Brennstoff und Vorratsfach', () => {
  it('das Herdfeuer brennt Holz (1 h) und Holzkohle (3 h), sonst nichts', () => {
    expect(istHerdBrennstoff('holz')).toBe(true);
    expect(istHerdBrennstoff('holzkohle')).toBe(true);
    expect(istHerdBrennstoff('stein')).toBe(false);
    expect(istHerdBrennstoff('zweig')).toBe(false);
    expect(brennstunden('holz')).toBe(1);
    expect(brennstunden('holzkohle')).toBe(3);
    expect(brennstunden('stein')).toBe(0);
    // From the bags it takes fuel and the ember cores (for their niches), nothing else.
    expect(herdNimmt('holz')).toBe(true);
    expect(herdNimmt('glutkern_4')).toBe(true);
    expect(herdNimmt('stein')).toBe(false);
  });

  it('zeigt die 40 Plätze in Brennreihenfolge', () => {
    const segmente = vorratsSegmente([stack('holz', 11), stack('holzkohle', 4)]);
    expect(segmente).toHaveLength(BALANCE.hearth.storePieces);
    expect(segmente.slice(0, 11).every((s) => s === 'holz')).toBe(true);
    expect(segmente.slice(11, 15).every((s) => s === 'holzkohle')).toBe(true);
    expect(segmente.slice(15).every((s) => s === null)).toBe(true);
    expect(vorratsSegmente([])).toEqual(new Array(BALANCE.hearth.storePieces).fill(null));
    // Never more places than the store has.
    expect(vorratsSegmente([stack('holz', 30), stack('holzkohle', 30)])).toHaveLength(BALANCE.hearth.storePieces);
  });
});

describe('Glutkern-Nischen', () => {
  it('sechs Nischen, Nische n nimmt nur Kern n; ohne Kern gesperrt', () => {
    const liste = nischen([null, null, null, null, null, null], emptyBags());
    expect(liste.map((n) => n.kern)).toEqual(['glutkern_1', 'glutkern_2', 'glutkern_3', 'glutkern_4', 'glutkern_5', 'glutkern_6']);
    expect(liste.every((n) => n.zustand === 'gesperrt' && n.ausBeutel === null)).toBe(true);
  });

  it('ein gesetzter Kern kommt heraus, ein Kern in den Taschen ist bereit für seine Nische', () => {
    // The cores come with their beacons (M7); a stack with the id stands for one here.
    const kern2 = { ...stack('stein'), item: 'glutkern_2' };
    const bags = withSlot(emptyBags(), { bereich: 'inventar', index: 4 }, kern2);
    const liste = nischen(['glutkern_1', null, null, null, null, null], bags);
    expect(liste[0]).toMatchObject({ zustand: 'gesetzt', ausBeutel: null });
    expect(liste[1]).toMatchObject({ zustand: 'bereit', ausBeutel: { bereich: 'inventar', index: 4 } });
    expect(liste.slice(2).every((n) => n.zustand === 'gesperrt')).toBe(true);
    expect(findeImBeutel(bags, 'glutkern_3')).toBeNull();
    expect(nischen([null, null, null, null, null, null], null).every((n) => n.zustand === 'gesperrt')).toBe(true);
  });

  it('die Schutzzone wächst mit allen sechs Kernen auf 40 Felder', () => {
    expect(radiusMax()).toBe(40);
  });

  it('nur Nischen, deren Glutkern es im Inhalt gibt: ohne Glutkern-Items keine (der Bildschirm zeigt dann keinen Abschnitt), mit ihnen alle (Review M4 #18)', () => {
    // A registry without ember cores (the game's content before the beacons of M7) and one with them.
    const ohne = { find: (id: string) => (id.startsWith('glutkern_') ? undefined : { id }) };
    const mit = { find: (id: string) => ({ id }) };
    const nurErster = { find: (id: string) => (id === 'glutkern_1' ? { id } : undefined) };
    expect(nischen([null, null, null, null, null, null], emptyBags(), ohne)).toEqual([]);
    const alle = nischen([null, null, null, null, null, null], emptyBags(), mit);
    expect(alle.map((n) => [n.index, n.kern, n.zustand])).toEqual(BALANCE.hearth.coreItems.map((k, i) => [i, k, 'gesperrt']));
    // Each niche keeps its index (niche n takes core n), whichever cores exist.
    expect(nischen(['glutkern_1', null, null, null, null, null], emptyBags(), nurErster).map((n) => [n.index, n.zustand])).toEqual([[0, 'gesetzt']]);
    // The game's own content has the first ember core (M7-36, beacon 1); its item catalog shows that niche only.
    const katalog = contentItemCatalog();
    expect(BALANCE.hearth.coreItems.filter((k) => katalog.find(k) !== undefined)).toEqual(['glutkern_1']);
    expect(nischen([null, null, null, null, null, null], emptyBags(), katalog).map((n) => [n.index, n.kern, n.zustand])).toEqual([[0, 'glutkern_1', 'gesperrt']]);
  });
});

describe('Suche in der Lagerübersicht', () => {
  it('findet Items über den deutschen oder englischen Namen und die Id, Umlaute und Groß-/Kleinschreibung verziehen', () => {
    expect(suchItems('', items, 'de')).toBeNull();
    expect(suchItems('   ', items, 'de')).toBeNull();
    expect(suchItems('Stein', items, 'de')?.has('stein')).toBe(true);
    expect(suchItems('stone', items, 'de')?.has('stein')).toBe(true);
    expect(suchItems('holzkohle', items, 'en')).toEqual(new Set(['holzkohle']));
    expect(suchItems('HOLZKOHLE', items, 'de')).toEqual(new Set(['holzkohle']));
    const saege = suchItems('sage', items, 'de');
    expect(saege?.has('saegebock')).toBe(true);
    // Every word must match.
    expect(suchItems('stein axt', items, 'de')?.has('steinaxt')).toBe(true);
    expect(suchItems('stein axt', items, 'de')?.has('stein')).toBe(false);
    expect(suchItems('xyzzy', items, 'de')?.size).toBe(0);
  });

  it('fasst Funde je Kiste und Item zusammen, in der Reihenfolge der Suche', () => {
    const treffer = [
      { kiste: 2, stack: { item: 'stein', count: 30 } },
      { kiste: 2, stack: { item: 'holz', count: 5 } },
      { kiste: 2, stack: { item: 'stein', count: 12 } },
      { kiste: 5, stack: { item: 'stein', count: 1 } },
    ];
    expect(fundZeilen(treffer)).toEqual([
      { kiste: 2, item: 'stein', anzahl: 42 },
      { kiste: 2, item: 'holz', anzahl: 5 },
      { kiste: 5, item: 'stein', anzahl: 1 },
    ]);
    expect(fundZeilen([])).toEqual([]);
  });

  it('nennt eine Kiste mit ihrem Namen, sonst mit dem ihres Behälters', () => {
    expect(kistenTitel({ name: 'Baustoffe', item: 'kiste_holz' }, catalog.find('kiste_holz'), 'de')).toBe('Baustoffe');
    expect(kistenTitel({ name: '', item: 'kiste_holz' }, catalog.find('kiste_holz'), 'de')).toBe('Holzkiste');
    expect(kistenTitel({ name: '', item: 'truhe' }, catalog.find('truhe'), 'en')).toBe('Chest');
  });
});

describe('Texte', () => {
  it('jede Ablehnung eines Herdfeuer-Befehls hat einen Text in beiden Sprachen', () => {
    for (const reason of HEARTH_REJECT_REASONS) {
      expect(herdAblehnung(de, reason).length).toBeGreaterThan(0);
      expect(herdAblehnung(en, reason).length).toBeGreaterThan(0);
    }
    expect(herdAblehnung(de, 'notFuel')).toContain('Holzscheite und Holzkohle');
  });

  it('die zusammengesetzten Schlüssel des Bildschirms gibt es in beiden Sprachen', () => {
    for (const i18n of [de, en]) {
      for (const ton of ['bereit', 'leer']) expect(i18n.has(`ui.herdfeuer.kalt.${ton}`)).toBe(true);
      for (const zustand of ['gesetzt', 'bereit', 'gesperrt']) expect(i18n.t(`ui.herdfeuer.nische.${zustand}`, { n: 3 })).toContain('3');
      expect(i18n.t('ui.herdfeuer.kisten', { count: 1, radius: 12 })).toContain('12');
      expect(i18n.t('ui.herdfeuer.kisten', { count: 3, radius: 12 })).toContain('3');
      expect(i18n.t('ui.herdfeuer.funde', { count: 2 })).toContain('2');
      expect(i18n.t('ui.herdfeuer.kerne.anzahl', { gesetzt: 2, max: 6, radius: radiusMax() })).toContain('40');
    }
    expect(de.t('ui.herdfeuer.kisten', { count: 1, radius: 12 })).toBe('1 Kiste in 12 Feldern');
    expect(en.t('ui.herdfeuer.funde', { count: 1 })).toBe('1 find');
    // The locked niches name where the cores come from.
    expect(de.t('ui.herdfeuer.kerne.hinweis')).toContain('Leuchtfeuer');
    expect(en.t('ui.herdfeuer.kerne.hinweis')).toContain('beacons');
  });
});

describe('Symbole', () => {
  it('sind 7 × 7 Pixel groß', () => {
    for (const id of ['schloss', 'schild', 'erwachen'] satisfies HerdSymbol[]) {
      const raster = herdSymbolRaster(id);
      expect(raster).toHaveLength(7);
      for (const row of raster) expect(row).toMatch(/^[.#]{7}$/);
    }
  });
});
