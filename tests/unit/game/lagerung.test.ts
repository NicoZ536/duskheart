/**
 * M4-21 Lagerung (MASTERPROMPT §16.7 "Holzkiste 16 · Truhe 24 · … · Lagerregal 48 (nur Rohstoffe) … Umbenennen +
 * Icon-Etikett, Sortieren, Schnellablage in passende Kisten (10 Tiles), „Alles einlagern" (außer Schnellleiste),
 * Suche über alle Kisten der Basis"; §15.1 "Crafting nimmt aus Inventar und Kisten im Umkreis von 8 Tiles"):
 * - the containers are items with recipes and build parts (furniture `lager`), placed on the build grid;
 * - put in, take out, take all; the shelf takes raw materials and ingots only; full chests and far chests refuse;
 * - a chest that holds items is not taken down or replaced, a destroyed one spills its stacks;
 * - rename, icon label, sort, "Alles einlagern", quick stash into matching chests within 10 tiles;
 * - the search runs over the chests of the base (the hearth zone, else 12 tiles);
 * - crafting takes from the chests within 8 tiles.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { TILE_PX } from '../../../src/world/model/coords';
import { lagerWelt, px, type LagerWelt } from './lager-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

const S = BALANCE.storage;

/** A 40 × 20 meadow, the player on (10, 10). */
function world(): LagerWelt {
  return lagerWelt(meadow(40, 20), { x: 10, y: 10 });
}

/** Places a container on drawn tile (x, y) and returns its id. */
function chest(w: LagerWelt, item: string, x: number, y: number, rot?: number): number {
  const r = w.build(item, x, y, rot);
  if (r !== null) throw new Error(`${item} at ${x},${y}: ${r}`);
  const c = w.storage.chestAt(0, OFFSET + x, OFFSET + y);
  if (c === undefined) throw new Error(`no chest at ${x},${y}`);
  return c.id;
}

/** Moves the player to drawn tile (x, y). */
function goTo(w: LagerWelt, x: number, y: number): void {
  const p = px(x, y);
  w.act({ type: 'player.teleport', x: p.x, y: p.y, layer: 0 });
}

function slotsOf(w: LagerWelt, id: number): Array<{ item: string; count: number } | null> {
  return (w.storage.chest(id)?.slots ?? []).map((s) => (s === null ? null : { item: s.item, count: s.count }));
}

describe('Behälter T0–T1 (§16.7)', () => {
  it('Holzkiste 16, Truhe 24, Lagerregal 48 nur Rohstoffe – Items mit Rezept und Bauteil (Möbel „lager“)', () => {
    expect(S.containers).toEqual({ kiste_holz: { slots: 16 }, truhe: { slots: 24 }, lagerregal: { slots: 48, only: ['rohstoff', 'barren'] } });
    const parts = CONTENT.collection('buildParts');
    const recipes = CONTENT.collection('recipes');
    for (const id of Object.keys(S.containers)) {
      expect(CONTENT.collection('items').has(id), id).toBe(true);
      expect(recipes.has(`rezept_${id}`), id).toBe(true);
      expect(parts.get(id)).toMatchObject({ art: 'moebel', kategorie: 'lager' });
    }
    expect(parts.get('lagerregal').groesse).toEqual({ b: 2, t: 1 });
    expect(recipes.get('rezept_truhe').station).toBe('werkbank_2');
    expect(S.quickStashTiles).toBe(10);
  });

  it('aufgestellt wird ein Behälter mit seinen Plätzen; das Regal belegt gedreht 1 × 2', () => {
    const w = world();
    const a = chest(w, 'kiste_holz', 12, 10);
    const b = chest(w, 'truhe', 12, 12);
    const c = chest(w, 'lagerregal', 14, 8, 1);
    expect(w.storage.chest(a)?.slots).toHaveLength(16);
    expect(w.storage.chest(b)?.slots).toHaveLength(24);
    expect(w.storage.chest(c)).toMatchObject({ w: 1, h: 2 });
    expect(w.storage.chestAt(0, OFFSET + 14, OFFSET + 9)?.id).toBe(c);
    expect(w.storage.chests.map((x) => x.item)).toEqual(['kiste_holz', 'truhe', 'lagerregal']);
  });
});

describe('Einlagern und Entnehmen', () => {
  it('Stapel vereinen sich, dann freie Plätze; Entnehmen gibt in die Taschen zurück', () => {
    const w = world();
    const id = chest(w, 'kiste_holz', 11, 10);
    w.give('holz', 30);
    let ev = w.act({ type: 'storage.put', chest: id, from: w.slotOf('holz'), count: 20 });
    expect(w.rejection(ev)).toBeNull();
    expect(ev.get('chestStored')?.[0]).toMatchObject({ chest: id, stored: 'holz', count: 20, by: 'spieler' });
    w.act({ type: 'storage.put', chest: id, from: w.slotOf('holz') });
    expect(slotsOf(w, id).slice(0, 2)).toEqual([{ item: 'holz', count: 30 }, null]);
    expect(w.count('holz')).toBe(0);
    ev = w.act({ type: 'storage.take', chest: id, index: 0, count: 12 });
    expect(ev.get('chestTaken')?.[0]).toMatchObject({ taken: 'holz', count: 12, by: 'spieler' });
    expect(w.count('holz')).toBe(12);
    ev = w.act({ type: 'storage.takeAll', chest: id });
    expect(w.count('holz')).toBe(30);
    expect(w.rejection(w.act({ type: 'storage.take', chest: id, index: 0 }))).toBe('slotEmpty');
  });

  it('das Lagerregal nimmt nur Rohstoffe und Barren; volle Kisten, ferne Kisten, Ausrüstungsplätze lehnen ab', () => {
    const w = world();
    const shelf = chest(w, 'lagerregal', 11, 10);
    w.give('steinaxt', 1);
    w.give('kupferbarren', 5);
    expect(w.rejection(w.act({ type: 'storage.put', chest: shelf, from: w.slotOf('steinaxt') }))).toBe('wrongItem');
    expect(w.rejection(w.act({ type: 'storage.put', chest: shelf, from: w.slotOf('kupferbarren') }))).toBeNull();
    // A crate of 16 slots takes 16 axes (durability: one per slot), the 17th does not fit.
    const box = chest(w, 'kiste_holz', 12, 12);
    w.give('steinaxt', 16);
    for (let k = 0; k < 16; k++) expect(w.rejection(w.act({ type: 'storage.put', chest: box, from: w.slotOf('steinaxt') }))).toBeNull();
    expect(w.rejection(w.act({ type: 'storage.put', chest: box, from: w.slotOf('steinaxt') }))).toBe('chestFull');
    expect(w.rejection(w.act({ type: 'storage.put', chest: box, from: { bereich: 'ausruestung', index: 0 } }))).toBe('invalidSlot');
    goTo(w, 25, 10);
    expect(w.rejection(w.act({ type: 'storage.open', chest: box }))).toBe('outOfReach');
    expect(w.rejection(w.act({ type: 'storage.open', chest: 99 }))).toBe('unknownChest');
    goTo(w, 11, 11);
    expect(w.act({ type: 'storage.open', chest: box }).get('chestOpened')?.[0]).toMatchObject({ chest: box, item: 'kiste_holz' });
    expect(w.act({ type: 'storage.close', chest: box }).get('chestClosed')).toHaveLength(1);
  });

  it('eine Kiste mit Inhalt wird nicht abgebaut oder ersetzt; leer ja; zerstört verschüttet sie ihren Inhalt', () => {
    const w = world();
    const id = chest(w, 'kiste_holz', 11, 10);
    w.give('stein', 7);
    w.act({ type: 'storage.put', chest: id, from: w.slotOf('stein') });
    expect(w.rejection(w.act({ type: 'build.remove', tx: OFFSET + 11, ty: OFFSET + 10 }))).toBe('notEmpty');
    w.give('truhe', 1);
    expect(w.rejection(w.act({ type: 'build.upgrade', tx: OFFSET + 11, ty: OFFSET + 10, part: 'truhe' }))).toBe('notEmpty');
    w.act({ type: 'storage.takeAll', chest: id });
    const ev = w.act({ type: 'build.remove', tx: OFFSET + 11, ty: OFFSET + 10 });
    expect(w.rejection(ev)).toBeNull();
    expect(ev.get('chestRemoved')?.[0]).toMatchObject({ chest: id, spilled: 0 });
    expect(w.storage.chests).toHaveLength(0);
    // Destroyed (fire, §16.8): the stacks fall out.
    const id2 = chest(w, 'kiste_holz', 11, 12);
    w.give('holz', 3);
    w.act({ type: 'storage.put', chest: id2, from: w.slotOf('stein'), count: 5 });
    w.act({ type: 'storage.put', chest: id2, from: w.slotOf('holz') });
    w.building.damage(w.sim, 0, 'objekt', OFFSET + 11, OFFSET + 12, 10_000);
    expect(w.storage.chest(id2)).toBeUndefined();
    expect(w.spilled.map((s) => [s.stack.item, s.stack.count])).toEqual([
      ['stein', 5],
      ['holz', 3],
    ]);
  });
});

describe('Umbenennen, Etikett, Sortieren, Alles einlagern, Schnellablage', () => {
  it('Name (gekürzt) und Icon-Etikett; unbekannte Items lehnen ab', () => {
    const w = world();
    const id = chest(w, 'kiste_holz', 11, 10);
    expect(w.act({ type: 'storage.rename', chest: id, name: '  Erze  ' }).get('chestRenamed')?.[0]).toMatchObject({ name: 'Erze' });
    expect(w.act({ type: 'storage.label', chest: id, item: 'kupfererz' }).get('chestLabeled')?.[0]).toMatchObject({ label: 'kupfererz' });
    expect(w.rejection(w.act({ type: 'storage.label', chest: id, item: 'mondstein' }))).toBe('unknownItem');
    expect(w.storage.chest(id)).toMatchObject({ name: 'Erze', label: 'kupfererz' });
    w.act({ type: 'storage.label', chest: id });
    expect(w.storage.chest(id)?.label).toBeNull();
  });

  it('Sortieren vereint Stapel und ordnet nach Kategorie, Stufe und Id', () => {
    const w = world();
    const id = chest(w, 'kiste_holz', 11, 10);
    for (const [item, n] of [['stein', 10], ['apfel', 3], ['holz', 20], ['stein', 15], ['kupferbarren', 2]] as const) {
      w.give(item, n);
      w.act({ type: 'storage.put', chest: id, from: w.slotOf(item) });
    }
    w.act({ type: 'storage.sort', chest: id });
    expect(slotsOf(w, id).filter((s) => s !== null)).toEqual([
      { item: 'holz', count: 20 },
      { item: 'stein', count: 25 },
      { item: 'kupferbarren', count: 2 },
      { item: 'apfel', count: 3 },
    ]);
  });

  it('„Alles einlagern“ nimmt Inventar und Rucksack, nicht die Schnellleiste; das Regal nur Rohstoffe', () => {
    const w = world();
    const shelf = chest(w, 'lagerregal', 11, 10);
    w.hold('steinaxt');
    w.give('holz', 40);
    w.give('apfel', 4);
    const ev = w.act({ type: 'storage.storeAll', chest: shelf });
    expect(w.rejection(ev)).toBeNull();
    expect(ev.get('chestStored')?.map((e) => (e as { stored: string }).stored)).toEqual(['holz']);
    expect(w.count('holz')).toBe(0);
    expect(w.count('apfel')).toBe(4);
    expect(w.inventory.state.schnellleiste[0]?.item).toBe('steinaxt');
    expect(w.rejection(w.act({ type: 'storage.storeAll', chest: shelf }))).toBe('nothingToStore');
  });

  it('Schnellablage: in Kisten im Umkreis von 10 Tiles, die das Item schon halten – die nächste zuerst', () => {
    const w = world();
    const near = chest(w, 'kiste_holz', 12, 10);
    const mid = chest(w, 'kiste_holz', 16, 10);
    goTo(w, 22, 10);
    const far = chest(w, 'kiste_holz', 23, 10);
    goTo(w, 10, 10);
    for (const [id, item, x] of [
      [near, 'stein', 11],
      [mid, 'holz', 15],
      [far, 'fasern', 22],
    ] as const) {
      w.give(item, 1);
      goTo(w, x, 10);
      expect(w.rejection(w.act({ type: 'storage.put', chest: id, from: w.slotOf(item) }))).toBeNull();
    }
    goTo(w, 10, 10);
    w.give('stein', 20);
    w.give('holz', 30);
    w.give('fasern', 9);
    w.give('apfel', 2);
    const ev = w.act({ type: 'storage.quickStash' });
    expect(w.rejection(ev)).toBeNull();
    expect(ev.get('quickStashed')?.[0]).toMatchObject({ count: 50, chests: 2 });
    expect(slotsOf(w, near)[0]).toEqual({ item: 'stein', count: 21 });
    expect(slotsOf(w, mid)[0]).toEqual({ item: 'holz', count: 31 });
    expect(w.count('fasern')).toBe(9);
    expect(w.count('apfel')).toBe(2);
    expect(Math.hypot(px(23, 10).x - w.pos().x, 0) / TILE_PX).toBeGreaterThan(S.quickStashTiles);
    expect(w.rejection(w.act({ type: 'storage.quickStash' }))).toBe('nothingToStore');
  });
});

describe('Suche über die Kisten der Basis und Handwerk aus Kisten', () => {
  it('die Suche findet in den Kisten der Basis (Herdfeuer-Umkreis, sonst 12 Tiles)', () => {
    const w = world();
    const a = chest(w, 'kiste_holz', 12, 10);
    goTo(w, 25, 10);
    const b = chest(w, 'kiste_holz', 28, 10);
    for (const [id, x] of [
      [a, 10],
      [b, 25],
    ] as const) {
      goTo(w, x, 10);
      w.give('kupfererz', 3);
      w.act({ type: 'storage.put', chest: id, from: w.slotOf('kupfererz') });
    }
    const find = (x: number) => w.storage.search(0, OFFSET + x, OFFSET + 10, (item) => item === 'kupfererz').map((f) => f.chest);
    expect(find(12)).toEqual([a]);
    // A hearth at (18, 12) makes its base: radius 12 around its centre covers both chests.
    goTo(w, 18, 10);
    expect(w.build('herdfeuer', 17, 11)).toBeNull();
    expect(find(12).sort()).toEqual([a, b].sort());
  });

  it('Handwerk nimmt aus Kisten im Umkreis von 8 Tiles', () => {
    const w = world();
    const id = chest(w, 'kiste_holz', 12, 10);
    w.give('fasern', 3);
    // Once owned, the rope's recipe is known (§15.1 "sobald jede Zutat einmal besessen wurde").
    w.run(1);
    w.act({ type: 'storage.put', chest: id, from: w.slotOf('fasern') });
    expect(w.count('fasern')).toBe(0);
    expect(w.crafting.available(w.sim, 'fasern')).toBe(3);
    const ev = w.act({ type: 'craft.start', recipe: 'rezept_faserseil', count: 1 });
    expect(w.rejection(ev)).toBeNull();
    expect(ev.get('chestTaken')?.[0]).toMatchObject({ chest: id, taken: 'fasern', count: 3, by: 'handwerk' });
    w.run(BALANCE.crafting.durationSeconds.handgriff * BALANCE.time.tickHz + 10);
    expect(w.count('faserseil')).toBe(1);
    expect(w.storage.chest(id)?.slots.every((x) => x === null)).toBe(true);
  });

  it('wer tot ist oder schläft, benutzt keine Kiste', () => {
    const w = world();
    const id = chest(w, 'kiste_holz', 11, 10);
    w.act({ type: 'death.kill' });
    w.run(2);
    expect(w.rejection(w.act({ type: 'storage.open', chest: id }))).toBe('dead');
  });
});
