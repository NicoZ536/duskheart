/**
 * M4-25 Bauen ändern (MASTERPROMPT §16.6 "Aufwerten an Ort und Stelle (Holz → Stein), Flächenreparatur, Abbauen
 * (100 % zurück in den ersten 30 s, danach 60 %)"):
 * - upgrading in place: the wooden wall becomes a stone wall where it stands – the new piece from the bags or a chest
 *   near it, the old one back like dismantling it; roofs on it stay carried;
 * - dismantling: the whole piece within 30 s, afterwards 60 % of its materials;
 * - area repair with the hammer: every damaged part of the rectangle within reach back to full hit points for a share
 *   of its materials (half of them for a part at 0 %, rounded up per material), from the bags and chests; refusals.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { repairCost } from '../../../src/game/building/repair';
import { contentMaterialBook } from '../../../src/game/building/materials';
import { lagerWelt, px, type LagerWelt } from './lager-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

const B = BALANCE.building;
const TICK_HZ = BALANCE.time.tickHz;

function world(): LagerWelt {
  return lagerWelt(meadow(40, 20), { x: 10, y: 10 });
}

function goTo(w: LagerWelt, x: number, y: number): void {
  const p = px(x, y);
  w.act({ type: 'player.teleport', x: p.x, y: p.y, layer: 0 });
}

function hpAt(w: LagerWelt, x: number, y: number): number {
  return w.building.structures.hp(0, 1, OFFSET + x, OFFSET + y);
}

describe('Aufwerten an Ort und Stelle (Holz → Stein)', () => {
  it('die Holzwand wird zur Steinwand; das neue Teil kommt aus einer Kiste, das alte zurück', () => {
    const w = world();
    expect(w.build('wand_holz', 12, 8)).toBeNull();
    expect(w.build('dach_stroh', 12, 9)).toBeNull();
    goTo(w, 16, 9);
    expect(w.build('kiste_holz', 17, 9)).toBeNull();
    const chest = w.storage.chests[0]?.id ?? 0;
    w.give('wand_stein', 1);
    w.act({ type: 'storage.put', chest, from: w.slotOf('wand_stein') });
    goTo(w, 10, 10);
    const ev = w.act({ type: 'build.upgrade', tx: OFFSET + 12, ty: OFFSET + 8, part: 'wand_stein' });
    expect(w.rejection(ev)).toBeNull();
    expect(ev.get('partUpgraded')?.[0]).toMatchObject({ from: 'wand_holz', to: 'wand_stein', material: 'stein' });
    expect(ev.get('chestTaken')?.[0]).toMatchObject({ taken: 'wand_stein', by: 'bau' });
    expect(w.building.partAt(0, 'struktur', OFFSET + 12, OFFSET + 8)?.id).toBe('wand_stein');
    expect(hpAt(w, 12, 8)).toBe(B.materials.stein.wallHp);
    // Placed seconds ago: the wooden wall comes back whole; the roof on it stays.
    expect(w.count('wand_holz')).toBe(1);
    expect(w.building.roofed(0, OFFSET + 12, OFFSET + 9)).toBe(true);
    // Another kind or size is no upgrade.
    w.give('tor_holz', 1);
    expect(w.rejection(w.act({ type: 'build.upgrade', tx: OFFSET + 12, ty: OFFSET + 8, part: 'tor_holz' }))).toBe('notUpgradable');
  });
});

describe('Abbauen: 100 % in den ersten 30 s, danach 60 %', () => {
  it('bis 30 s das ganze Teil, danach 60 % der Zutaten', () => {
    const w = world();
    expect(B.refund).toMatchObject({ fullSeconds: 30, lateShare: 0.6 });
    expect(w.build('wand_holz', 12, 8)).toBeNull();
    w.run(29 * TICK_HZ);
    expect(w.act({ type: 'build.remove', tx: OFFSET + 12, ty: OFFSET + 8 }).get('partRemoved')?.[0]).toMatchObject({ refund: 'ganz' });
    expect(w.count('wand_holz')).toBe(1);
    expect(w.build('tuer_holz', 12, 8)).toBeNull();
    w.run(31 * TICK_HZ);
    const ev = w.act({ type: 'build.remove', tx: OFFSET + 12, ty: OFFSET + 8 });
    expect(ev.get('partRemoved')?.[0]).toMatchObject({ refund: 'anteilig' });
    // A door holds 4 planks and a rope: 60 % → 2,4 → 2 planks, 0,6 → no rope (rounded down: never more than 60 %,
    // review M4 #10; half-up rounding gave the rope back whole).
    expect([w.count('brett'), w.count('faserseil')]).toEqual([2, 0]);
  });
});

describe('Flächenreparatur (§16.6)', () => {
  it('die Kosten: halbe Zutaten bei 0 %, anteilig zum fehlenden Leben, je Zutat aufgerundet', () => {
    const book = contentMaterialBook();
    expect(B.repair.materialShare).toBe(0.5);
    expect(repairCost(book.materials('wand_holz'), 150, 300, 0.5)).toEqual([{ item: 'brett', count: 1 }]);
    expect(repairCost(book.materials('wand_holz'), 30, 300, 0.5)).toEqual([{ item: 'brett', count: 2 }]);
    expect(repairCost(book.materials('wand_stein'), 450, 900, 0.5)).toEqual([
      { item: 'steinblock', count: 1 },
      { item: 'lehmputz', count: 1 },
    ]);
    expect(repairCost(book.materials('wand_holz'), 300, 300, 0.5)).toEqual([]);
  });

  it('der Hammer bessert jede beschädigte Wand der Fläche in Reichweite aus – Material aus Taschen und Kisten', () => {
    const w = world();
    for (let x = 12; x <= 15; x++) expect(w.build('wand_holz', x, 8)).toBeNull();
    goTo(w, 24, 8);
    expect(w.build('wand_holz', 26, 8)).toBeNull();
    goTo(w, 10, 10);
    for (const x of [12, 13, 15]) w.building.damage(w.sim, 0, 'struktur', OFFSET + x, OFFSET + 8, 150);
    w.building.damage(w.sim, 0, 'struktur', OFFSET + 26, OFFSET + 8, 150);
    expect(w.rejection(w.act({ type: 'build.repair', tx0: OFFSET + 11, ty0: OFFSET + 7, tx1: OFFSET + 27, ty1: OFFSET + 9 }))).toBe('noHammer');
    w.hold('steinhammer');
    expect(w.rejection(w.act({ type: 'build.repair', tx0: OFFSET + 11, ty0: OFFSET + 7, tx1: OFFSET + 27, ty1: OFFSET + 9 }))).toBe('noMaterial');
    // Two planks in the bags, one in a crate next to the walls.
    w.give('brett', 2);
    expect(w.build('kiste_holz', 13, 10)).toBeNull();
    const chest = w.storage.chests[0]?.id ?? 0;
    w.give('brett', 1);
    w.act({ type: 'storage.put', chest, from: w.slotOf('brett'), count: 1 });
    const ev = w.act({ type: 'build.repair', tx0: OFFSET + 11, ty0: OFFSET + 7, tx1: OFFSET + 27, ty1: OFFSET + 9 });
    expect(w.rejection(ev)).toBeNull();
    expect(ev.get('partRepaired')?.map((e) => (e as { tx: number }).tx - OFFSET)).toEqual([12, 13, 15]);
    expect([hpAt(w, 12, 8), hpAt(w, 13, 8), hpAt(w, 14, 8), hpAt(w, 15, 8)]).toEqual([300, 300, 300, 300]);
    // The wall 16 tiles away is beyond the build reach and stays damaged.
    expect(hpAt(w, 26, 8)).toBe(150);
    expect(w.count('brett')).toBe(0);
    expect(ev.get('chestTaken')?.[0]).toMatchObject({ taken: 'brett', count: 1, by: 'bau' });
    expect(w.rejection(w.act({ type: 'build.repair', tx0: OFFSET + 11, ty0: OFFSET + 7, tx1: OFFSET + 16, ty1: OFFSET + 9 }))).toBe('nothingToRepair');
    expect(w.rejection(w.act({ type: 'build.repair', tx0: OFFSET, ty0: OFFSET, tx1: OFFSET + B.repair.maxAreaTiles, ty1: OFFSET + 1 }))).toBe('areaTooLarge');
  });
});
