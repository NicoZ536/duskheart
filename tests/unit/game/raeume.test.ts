/**
 * M4-15 Raumerkennung (MASTERPROMPT §16.4): flood fill closed by walls, doors and windows, at most 400 tiles; an
 * interior is at least 90 % under a roof; the regions are recomputed incrementally when the buildings change.
 * Cases: open, closed, too big, door, window – plus fences, blueprints, rock around a room and the cache.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { RoomMap } from '../../../src/game/rooms/detect';
import { BUILD_LAYER_INDEX, anchorCell } from '../../../src/world/structures/cells';
import { bauWelt, hut, type BauWelt } from './bau-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

const STRUCTURE = BUILD_LAYER_INDEX.struktur;
const ROOF = BUILD_LAYER_INDEX.dach;

/** Writes part `part` on drawn tile (x, y) directly into the store (no reach, no material) and reports the change like the building system. */
function put(w: BauWelt, part: string, x: number, y: number, blueprint = false): void {
  const def = w.building.catalog.get(part);
  const tx = OFFSET + x;
  const ty = OFFSET + y;
  w.building.structures.set(0, def.layerIndex, tx, ty, anchorCell(def.rid, 0, false, false, blueprint), def.hp);
  w.collision.invalidateTile(0, tx, ty);
  w.rooms.map.invalidate(0, tx, ty, tx, ty);
}

/** Removes the part of build layer `li` on drawn tile (x, y) directly. */
function take(w: BauWelt, li: number, x: number, y: number): void {
  w.building.structures.set(0, li, OFFSET + x, OFFSET + y, 0, 0);
  w.collision.invalidateTile(0, OFFSET + x, OFFSET + y);
  w.rooms.map.invalidate(0, OFFSET + x, OFFSET + y, OFFSET + x, OFFSET + y);
}

/** A ring of `part` around the inner rectangle (x0, y0)–(x1, y1). */
function ring(w: BauWelt, x0: number, y0: number, x1: number, y1: number, part = 'wand_holz'): void {
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    put(w, part, x, y0 - 1);
    put(w, part, x, y1 + 1);
  }
  for (let y = y0; y <= y1; y++) {
    put(w, part, x0 - 1, y);
    put(w, part, x1 + 1, y);
  }
}

/** Roofs the rectangle. */
function roofOver(w: BauWelt, x0: number, y0: number, x1: number, y1: number, part = 'dach_stroh'): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(w, part, x, y);
}

describe('Raumerkennung (§16.4)', () => {
  it('geschlossen: Wände rundum mit Tür ergeben einen Raum; Wandtiles gehören zu keinem Raum', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 10);
    hut(w, 9, 9, 11, 11, 'wand_holz', 'tuer_holz', null);
    const room = w.roomAt(10, 10);
    expect(room?.region.room).toBe(true);
    expect(room?.region.size).toBe(9);
    expect(room?.region.interior).toBe(false);
    expect(w.roomAt(8, 10)).toBeNull();
    expect(w.roomAt(4, 4)).toBeNull();
    // Boundary faces: 12 faces of the 3 × 3 room, one of them the door.
    expect(room?.region.wallFaces).toBe(12);
  });

  it('offen: fehlt eine Wand, ist es kein Raum; wird sie gesetzt, wieder einer', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 10);
    ring(w, 9, 9, 11, 11);
    expect(w.roomAt(10, 10)?.region.room).toBe(true);
    take(w, STRUCTURE, 12, 10);
    expect(w.roomAt(10, 10)).toBeNull();
    put(w, 'wand_stein', 12, 10);
    expect(w.roomAt(10, 10)?.region.room).toBe(true);
  });

  it('zu groß: 400 Tiles sind ein Raum, 420 nicht', () => {
    const w = bauWelt(meadow(60, 60));
    w.spawn(1, 1);
    ring(w, 5, 5, 24, 24);
    expect(w.roomAt(10, 10)?.region.size).toBe(BALANCE.rooms.maxTiles);
    const big = bauWelt(meadow(60, 60));
    big.spawn(1, 1);
    ring(big, 5, 5, 25, 24);
    expect(big.roomAt(10, 10)).toBeNull();
  });

  it('Tür: offen oder zu – eine Tür schließt den Raum; offen dämmt sie nicht', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 10);
    hut(w, 9, 9, 11, 11, 'wand_holz', 'tuer_holz', null);
    const shut = w.roomAt(10, 10);
    expect(w.rejection(w.act({ type: 'build.door', tx: OFFSET + 10, ty: OFFSET + 12 }))).toBeNull();
    const open = w.roomAt(10, 10);
    expect(open?.region.room).toBe(true);
    expect(open?.region.wallInsulationSum).toBeLessThan(shut?.region.wallInsulationSum ?? 0);
  });

  it('Fenster schließen den Raum, Zäune und Blaupausen nicht', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 10);
    ring(w, 9, 9, 11, 11);
    put(w, 'fenster_glas', 12, 10);
    expect(w.roomAt(10, 10)?.region.room).toBe(true);
    put(w, 'fenster_offen', 12, 10);
    expect(w.roomAt(10, 10)?.region.room).toBe(true);
    put(w, 'zaun_holz', 12, 10);
    expect(w.roomAt(10, 10)).toBeNull();
    put(w, 'wand_holz', 12, 10, true);
    expect(w.roomAt(10, 10)).toBeNull();
  });

  it('Fels und Klippen schließen mit, aber ein Raum braucht mindestens eine gebaute Wand', () => {
    // A niche in the rock, closed by one wall.
    const rows = ['#####', '#...#', '#...#', '#####'];
    const w = bauWelt(rows);
    w.spawn(2, 2);
    expect(w.roomAt(2, 2)).toBeNull();
    const cave = w.rooms.map.regionAt(0, OFFSET + 2, OFFSET + 2);
    expect(cave?.room).toBe(false);
    expect(cave?.size).toBe(6);
    // The rock ring alone is a cave; a wall inside it makes the two halves rooms.
    put(w, 'wand_holz', 2, 1);
    put(w, 'wand_holz', 2, 2);
    expect(w.roomAt(1, 1)?.region.room).toBe(true);
    expect(w.roomAt(1, 1)?.region.size).toBe(2);
  });

  it('Innenraum ab 90 % überdacht', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(1, 1);
    ring(w, 5, 5, 14, 14);
    roofOver(w, 5, 5, 14, 13);
    // 90 of 100 tiles under a roof: an interior.
    expect(w.roomAt(8, 8)?.region.roofed).toBe(90);
    expect(w.roomAt(8, 8)?.region.interior).toBe(true);
    take(w, ROOF, 5, 5);
    expect(w.roomAt(8, 8)?.region.roofed).toBe(89);
    expect(w.roomAt(8, 8)?.region.interior).toBe(false);
  });
});

describe('Inkrementelle Neuberechnung', () => {
  it('eine Bauänderung verwirft nur die Regionen an der geänderten Stelle', () => {
    const w = bauWelt(meadow(30, 20));
    w.spawn(1, 1);
    ring(w, 3, 3, 5, 5);
    ring(w, 12, 3, 14, 5);
    const a = w.rooms.map.regionAt(0, OFFSET + 4, OFFSET + 4);
    const b = w.rooms.map.regionAt(0, OFFSET + 13, OFFSET + 4);
    expect(a?.room && b?.room).toBe(true);
    // Unchanged: the same cached regions.
    expect(w.rooms.map.regionAt(0, OFFSET + 3, OFFSET + 3)).toBe(a);
    // A wall inside room A splits it; room B is untouched.
    w.spawn(4, 8);
    expect(w.build('wand_holz', 4, 4)).toBeNull();
    expect(w.rooms.map.regionAt(0, OFFSET + 13, OFFSET + 4)).toBe(b);
    const a2 = w.rooms.map.regionAt(0, OFFSET + 3, OFFSET + 4);
    expect(a2).not.toBe(a);
    expect(a2?.size).toBe(8);
    // Furniture set inside a room renews that room (its contents changed), and only that one.
    w.run(1, [{ type: 'player.teleport', x: w.px(13, 8).x, y: w.px(13, 8).y, layer: 0 }]);
    expect(w.build('probe_moebel_kiste', 13, 4)).toBeNull();
    const b2 = w.rooms.map.regionAt(0, OFFSET + 13, OFFSET + 4);
    expect(b2).not.toBe(b);
    expect(b2?.furniture.lager).toBe(1);
    expect(w.rooms.map.regionAt(0, OFFSET + 3, OFFSET + 4)).toBe(a2);
  });

  it('der Cache bleibt beschränkt (M4-Gate): Freiflächen weichen jenseits von `cacheTiles`, Räume bleiben; eine neu gefüllte Region ist dieselbe', () => {
    const w = bauWelt(meadow(90, 60));
    w.spawn(1, 1);
    ring(w, 3, 3, 5, 5);
    // The game's cache holds 65 536 tiles; a map with a small bound shows the rule on a small meadow.
    expect(BALANCE.rooms.cacheTiles).toBeGreaterThan(64 * BALANCE.rooms.maxTiles);
    const limit = 3 * (BALANCE.rooms.maxTiles + 1);
    const grid = w.collision.grid;
    const map = new RoomMap({ store: w.building.structures, catalog: w.building.catalog, beginQuery: () => grid.beginQuery(), info: (l, x, y) => grid.info(l, x, y) }, limit);
    const room = map.regionAt(0, OFFSET + 4, OFFSET + 4);
    expect(room?.room).toBe(true);
    const first = map.regionAt(0, OFFSET + 20, OFFSET + 10);
    expect(first?.room).toBe(false);
    // Outdoor fills far apart: each caches up to 401 tiles.
    let fills = 0;
    for (let y = 8; y < 60; y += 24) {
      for (let x = 20; x < 90; x += 24) {
        expect(map.regionAt(0, OFFSET + x, OFFSET + y)?.room).toBe(false);
        expect(map.cachedTiles).toBeLessThanOrEqual(limit);
        fills++;
      }
    }
    expect(fills * (BALANCE.rooms.maxTiles + 1)).toBeGreaterThan(limit);
    // The room is still the cached region; the first outdoor fill, filled again, has the same id and tiles.
    expect(map.regionAt(0, OFFSET + 4, OFFSET + 4)).toBe(room);
    const again = map.regionAt(0, OFFSET + 20, OFFSET + 10);
    expect(again?.id).toBe(first?.id);
    expect(again?.size).toBe(first?.size);
  });

  it('gleicher Zustand ⇒ gleiche Räume, auch nach dem Neuaufbau des Caches', () => {
    const w = bauWelt(meadow(30, 20));
    w.spawn(1, 1);
    ring(w, 3, 3, 6, 5);
    roofOver(w, 3, 3, 6, 5);
    const before = w.roomAt(4, 4);
    w.rooms.map.clear();
    const after = w.roomAt(4, 4);
    expect(after).not.toBeNull();
    expect({ ...after?.region }).toEqual({ ...before?.region });
  });
});
