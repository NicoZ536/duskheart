/**
 * M3-02 Inventar-Kern (MASTERPROMPT §13.1, §26): 30 Plätze + Schnellleiste 10 + Rucksack (+8/+16/+24),
 * Stapelgrößen je Kategorie, Verschieben, Teilen, Zusammenführen, Sortieren, Frische-Mittelung.
 * Alle Operationen sind rein: der Ausgangszustand bleibt unverändert.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { emptyBags, slotAt, withSlot, type BagsState } from '../../../src/game/inventory/bags';
import { scrolledIndex, splitAmount, transferAmount } from '../../../src/game/inventory/formulas';
import {
  addStack,
  collectSame,
  countItem,
  discard,
  moveStack,
  quickMove,
  removeItems,
  scrollHotbar,
  selectedStack,
  selectHotbar,
  sortBags,
  splitStack,
  type BagsResult,
} from '../../../src/game/inventory/ops';
import { weightedFreshness } from '../../../src/game/items/formulas';
import { equipmentRef, type SlotRef } from '../../../src/game/items/slots';
import { newStack, type ItemStack } from '../../../src/game/items/stack';
import { testCatalog } from './items-fixtures';

const catalog = testCatalog();
const inv = (index: number): SlotRef => ({ bereich: 'inventar', index });
const bar = (index: number): SlotRef => ({ bereich: 'schnellleiste', index });
const fach = (index: number): SlotRef => ({ bereich: 'rucksackfach', index });
const PACK: SlotRef = { bereich: 'rucksack', index: 0 };
const belt = (index: number): SlotRef => ({ bereich: 'guertel', index });

function stack(item: string, count: number, frische?: number): ItemStack {
  return newStack(catalog.get(item), count, frische === undefined ? {} : { frische });
}

/** Bags with the given stacks placed directly. */
function bags(entries: ReadonlyArray<[SlotRef, ItemStack]>, base: BagsState = emptyBags()): BagsState {
  return entries.reduce((s, [ref, st]) => withSlot(s, ref, st), base);
}

function ok<T extends object>(r: BagsResult<T>): BagsState & T {
  if (!r.ok) throw new Error(`expected success, got ${r.reason}`);
  return { ...r.state, ...r } as BagsState & T;
}

function counts(state: BagsState, area: keyof Pick<BagsState, 'inventar' | 'schnellleiste' | 'rucksackfach' | 'guertel'>): Array<string | null> {
  return state[area].map((s) => (s === null ? null : `${s.item}×${s.count}`));
}

describe('Taschen: Größen und Stapel (§13.1)', () => {
  it('30 Inventarplätze, 10 Schnellleistenplätze, 1 Rucksackplatz, kein Fach ohne Rucksack, 8 Ausrüstungs- und 3 Gürtelplätze', () => {
    const s = emptyBags();
    expect([s.inventar.length, s.schnellleiste.length, s.rucksack.length, s.rucksackfach.length, s.ausruestung.length, s.guertel.length]).toEqual([30, 10, 1, 0, 8, 3]);
    expect(s.auswahl).toBe(0);
    expect(Object.isFrozen(s.inventar)).toBe(true);
  });

  it('Stapelgrößen: Rohstoffe 100, Nahrung 20, Werkzeuge/Waffen/Rüstung 1 (Barren 50, Munition 200 im Balancing)', () => {
    expect(catalog.get('stein').stapel).toBe(100);
    expect(catalog.get('himbeeren').stapel).toBe(20);
    expect(catalog.get('probe_axt').stapel).toBe(1);
    expect(catalog.get('probe_speer').stapel).toBe(1);
    expect(catalog.get('probe_helm').stapel).toBe(1);
    expect(BALANCE.items.stack.barren).toBe(50);
    expect(BALANCE.items.stack.munition).toBe(200);
  });

  it('addStack verteilt auf volle Stapel, füllt zuerst vorhandene Stapel und meldet den Rest', () => {
    const start = emptyBags();
    const a = addStack(start, catalog, stack('stein', 250));
    expect(a).toMatchObject({ added: 250, rest: 0 });
    expect(counts(a.state, 'inventar').slice(0, 4)).toEqual(['stein×100', 'stein×100', 'stein×50', null]);
    expect(start.inventar[0]).toBeNull();
    // A partial stack is filled before a new slot is opened; the hotbar stack comes first.
    const withBar = bags([[bar(2), stack('stein', 90)]]);
    const b = addStack(withBar, catalog, stack('stein', 30));
    expect(slotAt(b.state, bar(2))?.count).toBe(100);
    expect(slotAt(b.state, inv(0))?.count).toBe(20);
  });

  it('Werkzeuge landen zuerst in der Schnellleiste, Rohstoffe im Inventar; Stücke mit Haltbarkeit stapeln nie', () => {
    const r = addStack(emptyBags(), catalog, stack('probe_axt', 3));
    expect(counts(r.state, 'schnellleiste').slice(0, 4)).toEqual(['probe_axt×1', 'probe_axt×1', 'probe_axt×1', null]);
    expect(slotAt(r.state, bar(0))?.haltbarkeit).toBe(60);
    expect(counts(r.state, 'inventar').every((c) => c === null)).toBe(true);
  });

  it('volle Taschen: was nicht passt, bleibt als Rest', () => {
    let s = emptyBags();
    s = addStack(s, catalog, stack('stein', 100 * 40)).state;
    expect(countItem(s, 'stein')).toBe(4000);
    const r = addStack(s, catalog, stack('holz', 5));
    expect(r).toMatchObject({ added: 0, rest: 5 });
    expect(r.state).toBe(s);
    const partial = addStack(withSlot(s, inv(0), stack('stein', 97)), catalog, stack('stein', 5));
    expect(partial).toMatchObject({ added: 3, rest: 2 });
  });
});

describe('Frische beim Zusammenlegen: gewichtet gemittelt (§13.1)', () => {
  it('Formel: (f₁·n₁ + f₂·n₂) / (n₁ + n₂)', () => {
    expect(weightedFreshness(100, 10, 50, 10)).toBe(75);
    expect(weightedFreshness(90, 3, 30, 1)).toBe(75);
    expect(weightedFreshness(40, 5, 40, 7)).toBe(40);
  });

  it('beim Aufnehmen, Verschieben, Einsammeln und Sortieren', () => {
    const base = bags([[inv(0), stack('himbeeren', 10, 100)]]);
    expect(slotAt(addStack(base, catalog, stack('himbeeren', 10, 50)).state, inv(0))).toMatchObject({ count: 20, frische: 75 });
    const moved = ok(moveStack(bags([[inv(1), stack('himbeeren', 6, 20)]], base), catalog, inv(1), inv(0)));
    expect(slotAt(moved, inv(0))).toMatchObject({ count: 16, frische: 70 });
    const collected = ok(collectSame(bags([[inv(5), stack('himbeeren', 5, 40)]], base), catalog, inv(0)));
    expect(slotAt(collected, inv(0))).toMatchObject({ count: 15, frische: 80 });
    const sorted = sortBags(bags([[inv(7), stack('himbeeren', 30 - 20, 70)]], base), catalog);
    expect(slotAt(sorted, inv(0))).toMatchObject({ count: 20, frische: 85 });
  });

  it('nur der verschobene Teil geht in die Mittelung ein; der Rest behält seine Frische', () => {
    const s = bags([
      [inv(0), stack('apfel', 18, 100)],
      [inv(1), stack('apfel', 10, 0)],
    ]);
    const r = ok(moveStack(s, catalog, inv(1), inv(0)));
    expect(slotAt(r, inv(0))).toMatchObject({ count: 20, frische: 90 });
    expect(slotAt(r, inv(1))).toMatchObject({ count: 8, frische: 0 });
  });
});

describe('Verschieben (Drag & Drop, Zifferntasten)', () => {
  const s = bags([
    [inv(0), stack('stein', 60)],
    [inv(1), stack('stein', 70)],
    [inv(2), stack('holz', 5)],
    [inv(3), stack('probe_helm', 1)],
    [inv(4), stack('himbeeren', 4)],
  ]);

  it('auf einen freien Platz, ganz oder teilweise', () => {
    const whole = ok(moveStack(s, catalog, inv(2), bar(0)));
    expect([slotAt(whole, inv(2)), slotAt(whole, bar(0))?.count]).toEqual([null, 5]);
    const part = ok(moveStack(s, catalog, inv(0), inv(9), 25));
    expect([slotAt(part, inv(0))?.count, slotAt(part, inv(9))?.count]).toEqual([35, 25]);
    expect(slotAt(s, inv(0))?.count).toBe(60);
  });

  it('auf einen gleichen Stapel bis zur Stapelgröße; ein voller Stapel lehnt ab', () => {
    const r = ok(moveStack(s, catalog, inv(0), inv(1)));
    expect([slotAt(r, inv(1))?.count, slotAt(r, inv(0))?.count]).toEqual([100, 30]);
    expect(moveStack(r, catalog, inv(0), inv(1))).toEqual({ ok: false, reason: 'stackFull' });
  });

  it('ganze Stapel tauschen die Plätze; Teilmengen auf ein anderes Item nicht', () => {
    const r = ok(moveStack(s, catalog, inv(2), inv(0)));
    expect([slotAt(r, inv(0))?.item, slotAt(r, inv(2))?.item]).toEqual(['holz', 'stein']);
    expect(moveStack(s, catalog, inv(0), inv(2), 10)).toEqual({ ok: false, reason: 'occupied' });
  });

  it('lehnt ungültige Züge mit Grund ab', () => {
    expect(moveStack(s, catalog, inv(9), inv(10))).toEqual({ ok: false, reason: 'slotEmpty' });
    expect(moveStack(s, catalog, inv(0), inv(0))).toEqual({ ok: false, reason: 'sameSlot' });
    expect(moveStack(s, catalog, inv(0), inv(30))).toEqual({ ok: false, reason: 'invalidSlot' });
    expect(moveStack(s, catalog, inv(0), fach(0))).toEqual({ ok: false, reason: 'invalidSlot' });
    expect(moveStack(s, catalog, inv(0), inv(9), 61)).toEqual({ ok: false, reason: 'invalidCount' });
    expect(moveStack(s, catalog, inv(0), inv(9), 0)).toEqual({ ok: false, reason: 'invalidCount' });
    expect(moveStack(s, catalog, inv(0), equipmentRef('kopf'))).toEqual({ ok: false, reason: 'wrongSlot' });
    expect(moveStack(s, catalog, inv(0), belt(0))).toEqual({ ok: false, reason: 'wrongSlot' });
  });

  it('Ausrüstung und Gürtel nehmen nur, was dorthin gehört; ein Tausch muss in beide Richtungen passen', () => {
    const worn = ok(moveStack(s, catalog, inv(3), equipmentRef('kopf')));
    expect(slotAt(worn, equipmentRef('kopf'))?.item).toBe('probe_helm');
    expect(moveStack(s, catalog, inv(3), equipmentRef('brust'))).toEqual({ ok: false, reason: 'wrongSlot' });
    // Helmet back onto the stones: the stones would have to go to the head slot.
    expect(moveStack(worn, catalog, equipmentRef('kopf'), inv(0))).toEqual({ ok: false, reason: 'wrongSlot' });
    const food = ok(moveStack(s, catalog, inv(4), belt(2)));
    expect(slotAt(food, belt(2))?.count).toBe(4);
  });
});

describe('Rucksack (+8/+16/+24)', () => {
  const s = bags([
    [inv(0), stack('probe_rucksack_8', 1)],
    [inv(1), stack('probe_rucksack_16', 1)],
    [inv(2), stack('stein', 40)],
  ]);

  it('der Rucksackplatz nimmt nur Rucksäcke; das Fach hat so viele Plätze, wie der Rucksack bringt', () => {
    expect(moveStack(s, catalog, inv(2), PACK)).toEqual({ ok: false, reason: 'wrongSlot' });
    const eight = ok(moveStack(s, catalog, inv(0), PACK));
    expect(eight.rucksackfach).toHaveLength(8);
    const sixteen = ok(moveStack(eight, catalog, inv(1), PACK));
    expect(sixteen.rucksackfach).toHaveLength(16);
    expect(slotAt(sixteen, inv(1))?.item).toBe('probe_rucksack_8');
  });

  it('Taschen nutzen das Fach; ein kleinerer Rucksack oder Ablegen scheitert, solange wegfallende Plätze belegt sind', () => {
    const sixteen = ok(moveStack(s, catalog, inv(1), PACK));
    const filled = ok(moveStack(sixteen, catalog, inv(2), fach(12)));
    expect(countItem(filled, 'stein')).toBe(40);
    expect(moveStack(filled, catalog, inv(0), PACK)).toEqual({ ok: false, reason: 'backpackNotEmpty' });
    expect(moveStack(filled, catalog, PACK, inv(5))).toEqual({ ok: false, reason: 'backpackNotEmpty' });
    expect(discard(filled, catalog, PACK)).toEqual({ ok: false, reason: 'backpackNotEmpty' });
    const low = ok(moveStack(filled, catalog, fach(12), fach(3)));
    const smaller = ok(moveStack(low, catalog, inv(0), PACK));
    expect(smaller.rucksackfach).toHaveLength(8);
    expect(slotAt(smaller, fach(3))?.count).toBe(40);
    const emptied = ok(moveStack(ok(moveStack(smaller, catalog, fach(3), inv(20))), catalog, PACK, inv(25)));
    expect(emptied.rucksackfach).toHaveLength(0);
  });

  it('ein Rucksack wandert nie in sein eigenes Fach', () => {
    const eight = ok(moveStack(s, catalog, inv(0), PACK));
    expect(moveStack(eight, catalog, PACK, fach(0))).toEqual({ ok: false, reason: 'backpackInside' });
  });

  it('aufgenommene Rohstoffe füllen erst das Inventar, dann das Fach, zuletzt die Schnellleiste', () => {
    const eight = ok(moveStack(s, catalog, inv(0), PACK));
    // 28 free inventory slots + 8 compartment slots.
    const full = addStack(eight, catalog, stack('holz', 100 * 36)).state;
    expect(countItem(full, 'holz')).toBe(3600);
    expect(full.rucksackfach.every((x) => x?.item === 'holz')).toBe(true);
    expect(full.schnellleiste.every((x) => x === null)).toBe(true);
    const more = addStack(full, catalog, stack('holz', 100)).state;
    expect(slotAt(more, bar(0))?.count).toBe(100);
  });
});

describe('Teilen (Rechtsklick)', () => {
  const s = bags([
    [inv(0), stack('stein', 7)],
    [inv(1), stack('holz', 1)],
    [inv(2), stack('holz', 3)],
  ]);

  it('die kleinere Hälfte geht auf den nächsten freien Platz desselben Bereichs', () => {
    const r = ok(splitStack(s, catalog, inv(0)));
    expect(r.to).toEqual(inv(3));
    expect([slotAt(r, inv(0))?.count, slotAt(r, inv(3))?.count]).toEqual([4, 3]);
  });

  it('auf einen gewählten freien Platz; belegt, gleich oder einzeln wird abgelehnt', () => {
    const r = ok(splitStack(s, catalog, inv(0), bar(4)));
    expect(slotAt(r, bar(4))?.count).toBe(3);
    expect(splitStack(s, catalog, inv(0), inv(2))).toEqual({ ok: false, reason: 'occupied' });
    expect(splitStack(s, catalog, inv(0), inv(0))).toEqual({ ok: false, reason: 'sameSlot' });
    expect(splitStack(s, catalog, inv(1))).toEqual({ ok: false, reason: 'invalidCount' });
    expect(splitStack(s, catalog, inv(9))).toEqual({ ok: false, reason: 'slotEmpty' });
  });

  it('ohne freien Platz: noSpace', () => {
    const full = addStack(emptyBags(), catalog, stack('stein', 100 * 40)).state;
    expect(splitStack(full, catalog, inv(0))).toEqual({ ok: false, reason: 'noSpace' });
  });
});

describe('Zusammenführen (Doppelklick sammelt Gleiches)', () => {
  it('zieht gleiche Stapel aus Inventar, Fach und Schnellleiste auf einen Stapel bis zur Stapelgröße', () => {
    const s = bags([
      [inv(3), stack('stein', 30)],
      [inv(8), stack('stein', 50)],
      [bar(1), stack('stein', 40)],
      [inv(9), stack('holz', 10)],
    ]);
    const r = ok(collectSame(s, catalog, inv(3)));
    expect(r.collected).toBe(70);
    expect([slotAt(r, inv(3))?.count, slotAt(r, inv(8)), slotAt(r, bar(1))?.count, slotAt(r, inv(9))?.count]).toEqual([100, null, 20, 10]);
  });

  it('voller Stapel, nichts Passendes oder leerer Platz werden abgelehnt', () => {
    expect(collectSame(bags([[inv(0), stack('stein', 100)]]), catalog, inv(0))).toEqual({ ok: false, reason: 'stackFull' });
    expect(collectSame(bags([[inv(0), stack('stein', 10)]]), catalog, inv(0))).toEqual({ ok: false, reason: 'nothingToCollect' });
    expect(collectSame(emptyBags(), catalog, inv(0))).toEqual({ ok: false, reason: 'slotEmpty' });
  });
});

describe('Sortieren', () => {
  it('fügt Teilstapel zusammen und ordnet nach Kategorie, Stufe und Id; die Schnellleiste bleibt, wie sie ist', () => {
    const s = bags([
      [inv(0), stack('himbeeren', 5)],
      [inv(4), stack('stein', 30)],
      [inv(6), stack('salpeter', 3)],
      [inv(7), stack('probe_helm', 1)],
      [inv(9), stack('stein', 80)],
      [inv(12), stack('holz', 2)],
      [bar(5), stack('stein', 1)],
    ]);
    const r = sortBags(s, catalog);
    expect(counts(r, 'inventar').slice(0, 7)).toEqual(['holz×2', 'stein×100', 'stein×10', 'salpeter×3', 'himbeeren×5', 'probe_helm×1', null]);
    expect(counts(r, 'schnellleiste')[5]).toBe('stein×1');
    expect(sortBags(r, catalog).inventar).toEqual(r.inventar);
  });

  it('sortiert das Rucksackfach mit, hinter dem Inventar', () => {
    const packed = ok(moveStack(bags([[inv(0), stack('probe_rucksack_8', 1)]]), catalog, inv(0), PACK));
    const filled = addStack(packed, catalog, stack('holz', 100 * 31)).state;
    const s = withSlot(withSlot(filled, inv(4), null), fach(1), stack('stein', 9));
    const r = sortBags(s, catalog);
    expect(r.rucksackfach).toHaveLength(8);
    expect(countItem(r, 'holz')).toBe(countItem(s, 'holz'));
    expect(counts(r, 'rucksackfach').filter((c) => c === 'stein×9')).toHaveLength(1);
  });
});

describe('Shift-Klick und Wegwerfen', () => {
  it('Schnellleiste ↔ Inventar, Ausrüstung aus dem Inventar direkt anlegen, Getragenes zurück in die Taschen', () => {
    const s = bags([
      [bar(0), stack('stein', 30)],
      [inv(0), stack('stein', 90)],
      [inv(1), stack('probe_brust', 1)],
      [inv(2), stack('holz', 4)],
    ]);
    const down = ok(quickMove(s, catalog, bar(0)));
    expect([slotAt(down, inv(0))?.count, slotAt(down, inv(3))?.count, slotAt(down, bar(0))]).toEqual([100, 20, null]);
    const up = ok(quickMove(s, catalog, inv(2)));
    expect(slotAt(up, bar(1))?.item).toBe('holz');
    const worn = ok(quickMove(s, catalog, inv(1)));
    expect(slotAt(worn, equipmentRef('brust'))?.item).toBe('probe_brust');
    const back = ok(quickMove(worn, catalog, equipmentRef('brust')));
    expect(slotAt(back, equipmentRef('brust'))).toBeNull();
    expect(countItem(back, 'probe_brust')).toBe(1);
  });

  it('ohne Platz im Ziel: noSpace, nichts ändert sich', () => {
    let full = emptyBags();
    for (let i = 0; i < 10; i++) full = withSlot(full, bar(i), stack('holz', 100));
    full = withSlot(full, inv(0), stack('stein', 5));
    expect(quickMove(full, catalog, inv(0))).toEqual({ ok: false, reason: 'noSpace' });
  });

  it('Wegwerfen ganz oder teilweise', () => {
    const s = bags([[inv(0), stack('stein', 30)]]);
    const part = ok(discard(s, catalog, inv(0), 12));
    expect([slotAt(part, inv(0))?.count, part.discarded.count]).toEqual([18, 12]);
    expect(slotAt(ok(discard(s, catalog, inv(0))), inv(0))).toBeNull();
    expect(discard(s, catalog, inv(0), 31)).toEqual({ ok: false, reason: 'invalidCount' });
  });
});

describe('Entnehmen, Zählen, Schnellleiste', () => {
  it('removeItems nimmt zuerst aus Fach und Inventarende, zuletzt aus der Schnellleiste', () => {
    const s = bags([
      [bar(0), stack('stein', 10)],
      [inv(0), stack('stein', 10)],
      [inv(5), stack('stein', 10)],
    ]);
    const r = ok(removeItems(s, 'stein', 15));
    expect([slotAt(r, inv(5)), slotAt(r, inv(0))?.count, slotAt(r, bar(0))?.count]).toEqual([null, 5, 10]);
    expect(r.removed.map((x) => x.count)).toEqual([10, 5]);
    expect(countItem(r, 'stein')).toBe(15);
    expect(removeItems(s, 'stein', 31)).toEqual({ ok: false, reason: 'notEnough' });
    expect(removeItems(s, 'stein', 0)).toEqual({ ok: false, reason: 'invalidCount' });
  });

  it('Tasten 1–0 wählen, das Mausrad blättert ringsum; die Hand hält den gewählten Stapel', () => {
    const s = bags([[bar(9), stack('probe_axt', 1)]]);
    const nine = ok(selectHotbar(s, 9));
    expect(selectedStack(nine)?.item).toBe('probe_axt');
    expect(selectHotbar(s, 10)).toEqual({ ok: false, reason: 'invalidSlot' });
    expect(scrollHotbar(nine, 1).auswahl).toBe(0);
    expect(scrollHotbar(s, -1).auswahl).toBe(9);
    expect(scrollHotbar(s, 23).auswahl).toBe(3);
    expect(scrollHotbar(s, 10)).toBe(s);
  });
});

describe('Formeln', () => {
  it('transferAmount, splitAmount, scrolledIndex', () => {
    expect(transferAmount(60, 70, 100)).toBe(40);
    expect(transferAmount(60, 10, 100)).toBe(10);
    expect(transferAmount(100, 10, 100)).toBe(0);
    expect(transferAmount(120, 10, 100)).toBe(0);
    expect([splitAmount(1), splitAmount(2), splitAmount(7), splitAmount(100)]).toEqual([0, 1, 3, 50]);
    expect([scrolledIndex(0, -1, 10), scrolledIndex(9, 1, 10), scrolledIndex(4, -13, 10)]).toEqual([9, 0, 1]);
  });
});
