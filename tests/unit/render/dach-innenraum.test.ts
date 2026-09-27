/**
 * M4-27 (MASTERPROMPT §16.4, §6.2): the roof of an interior fades out completely when the player enters, the walls
 * below the roof's top row are cut; roofs of other buildings stay; a doorway keeps the last decision; the fade
 * follows the presentation clock and settles frame by frame while the clock stands still (frozen screenshots).
 * Also the row kinds of a roof column (sprite contract `nord`/`first`/`sued`).
 */
import { describe, expect, it } from 'vitest';
import { BUILD_PARTS } from '../../../src/content/buildParts';
import { anchorCell, BUILD_LAYER_INDEX } from '../../../src/world/structures/cells';
import { createPartCatalog } from '../../../src/world/structures/catalog';
import { StructureStore } from '../../../src/world/structures/store';
import { FADE_FRAMES, FADE_SECONDS, InteriorView, ROOF_ROW, roofColumn, roofTileKey } from '../../../src/render/game/roofs';

const CATALOG = createPartCatalog(BUILD_PARTS);
const ROOF = BUILD_LAYER_INDEX.dach;
const KEYS = { tx: (k: number) => k % 4096, ty: (k: number) => Math.floor(k / 4096) % 4096 };

function roofs(store: StructureStore, x0: number, y0: number, x1: number, y1: number, part = 'dach_stroh', blueprint = false): void {
  const def = CATALOG.get(part);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) store.set(0, ROOF, x, y, anchorCell(def.rid, 0, false, false, blueprint), def.hp);
}

/** A room of the tiles (x0, y0)–(x1, y1) (keys like src/game/rooms/detect.ts on layer 0). */
function room(id: number, x0: number, y0: number, x1: number, y1: number, interior = true): { id: number; interior: boolean; tiles: number[] } {
  const tiles: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push((3 * 4096 + y) * 4096 + x);
  return { id, interior, tiles };
}

describe('Dachreihen (Vertrag bau_dach_*)', () => {
  it('eine Spalte von sechs Dachtiles: zwei Rückseite, First auf der dritten, drei Vorderseite; die Traufe ist die unterste', () => {
    const store = new StructureStore();
    roofs(store, 10, 10, 12, 15);
    const run = { top: 0, bottom: 0 };
    const kinds = [10, 11, 12, 13, 14, 15].map((ty) => roofColumn(store, 0, 11, ty, run));
    expect(kinds).toEqual([ROOF_ROW.nord, ROOF_ROW.nord, ROOF_ROW.first, ROOF_ROW.sued, ROOF_ROW.sued, ROOF_ROW.sued]);
    expect(run).toEqual({ top: 10, bottom: 15 });
  });

  it('ein einzelnes Dachtile ist First; zwei: First und Vorderseite', () => {
    const store = new StructureStore();
    roofs(store, 3, 3, 3, 3);
    roofs(store, 6, 3, 6, 4);
    const run = { top: 0, bottom: 0 };
    expect(roofColumn(store, 0, 3, 3, run)).toBe(ROOF_ROW.first);
    expect(roofColumn(store, 0, 6, 3, run)).toBe(ROOF_ROW.first);
    expect(roofColumn(store, 0, 6, 4, run)).toBe(ROOF_ROW.sued);
  });
});

describe('Innenansicht (M4-27)', () => {
  it('betritt der Spieler einen Innenraum, blendet das ganze zusammenhängende Dach aus – ein fremdes Dach bleibt', () => {
    const store = new StructureStore();
    roofs(store, 10, 10, 16, 15);
    roofs(store, 30, 10, 33, 13);
    const v = new InteriorView();
    v.update(store, 0, room(1, 11, 11, 15, 14), KEYS, store.revision, 0, true);
    expect(v.inside).toBe(true);
    expect(v.fade).toBe(1);
    expect(v.roofTiles).toBe(42);
    expect(v.fadesRoof(10, 10)).toBe(true);
    expect(v.fadesRoof(16, 15)).toBe(true);
    expect(v.fadesRoof(30, 10)).toBe(false);
    expect([v.x0, v.y0, v.x1, v.y1]).toEqual([10, 10, 16, 15]);
  });

  it('gekappt werden die Wände unterhalb der obersten Dachreihe, auch ein Tile um das Dach herum; die Rückwand bleibt voll', () => {
    const store = new StructureStore();
    roofs(store, 10, 10, 16, 15);
    const v = new InteriorView();
    v.update(store, 0, room(1, 11, 11, 15, 14), KEYS, store.revision, 0, true);
    expect(v.cutsWall(12, 10)).toBe(false);
    expect(v.cutsWall(10, 12)).toBe(true);
    expect(v.cutsWall(13, 15)).toBe(true);
    expect(v.cutsWall(13, 16)).toBe(true);
    expect(v.cutsWall(9, 12)).toBe(true);
    expect(v.cutsWall(13, 17)).toBe(false);
    expect(v.cutsWall(18, 12)).toBe(false);
  });

  it('die Blende folgt der Präsentationszeit in FADE_SECONDS und steht ein stehendes Bild in FADE_FRAMES Frames durch', () => {
    const store = new StructureStore();
    roofs(store, 10, 10, 14, 14);
    const r = room(7, 11, 11, 13, 13);
    const v = new InteriorView();
    v.update(store, 0, null, KEYS, store.revision, 1, false);
    v.update(store, 0, r, KEYS, store.revision, 1 + FADE_SECONDS / 2, false);
    expect(v.fade).toBeCloseTo(0.5, 5);
    v.update(store, 0, r, KEYS, store.revision, 1 + FADE_SECONDS, false);
    expect(v.fade).toBeCloseTo(1, 5);
    // Frozen clock: back out frame by frame.
    let frames = 0;
    while (v.fade > 0 && frames < 100) {
      v.update(store, 0, null, KEYS, store.revision, 1 + FADE_SECONDS, false);
      frames++;
    }
    expect(frames).toBeGreaterThanOrEqual(FADE_FRAMES);
    expect(frames).toBeLessThanOrEqual(FADE_FRAMES + 1);
    expect(v.roofTiles).toBe(0);
  });

  it('auf einer Türschwelle (kein Raum) bleibt die letzte Entscheidung; draußen kehrt das Dach zurück', () => {
    const store = new StructureStore();
    roofs(store, 10, 10, 14, 14);
    const v = new InteriorView();
    v.update(store, 0, room(1, 11, 11, 13, 13), KEYS, store.revision, 0, true);
    v.update(store, 0, undefined, KEYS, store.revision, 0, true);
    expect(v.inside).toBe(true);
    expect(v.fade).toBe(1);
    v.update(store, 0, null, KEYS, store.revision, 0, true);
    expect(v.inside).toBe(false);
    expect(v.fade).toBe(0);
  });

  it('ein Raum ohne Innenraum-Status (unter 90 % überdacht) und Blaupausen-Dächer blenden nichts aus', () => {
    const store = new StructureStore();
    roofs(store, 10, 10, 14, 14, 'dach_stroh', true);
    const v = new InteriorView();
    v.update(store, 0, room(1, 11, 11, 13, 13), KEYS, store.revision, 0, true);
    expect(v.roofTiles).toBe(0);
    expect(v.fade).toBe(0);
    roofs(store, 10, 10, 14, 14);
    v.update(store, 0, room(1, 11, 11, 13, 13, false), KEYS, store.revision, 0, true);
    expect(v.inside).toBe(false);
    expect(v.fade).toBe(0);
  });

  it('eine Bauänderung sammelt das Dach neu; ein Ebenenwechsel und reset vergessen es', () => {
    const store = new StructureStore();
    roofs(store, 10, 10, 12, 12);
    const v = new InteriorView();
    const r = room(1, 11, 11, 11, 11);
    v.update(store, 0, r, KEYS, store.revision, 0, true);
    expect(v.roofTiles).toBe(9);
    roofs(store, 13, 10, 13, 12);
    v.update(store, 0, r, KEYS, store.revision, 0, true);
    expect(v.roofTiles).toBe(12);
    expect(v.fadesRoof(13, 11)).toBe(true);
    expect(roofTileKey(13, 11)).toBe(11 * 4096 + 13);
    v.update(store, -1, undefined, KEYS, store.revision, 0, true);
    expect(v.roofTiles).toBe(0);
    v.update(store, 0, r, KEYS, store.revision, 0, true);
    v.reset();
    expect(v.roofTiles).toBe(0);
    expect(v.fade).toBe(0);
    expect(v.inside).toBe(false);
  });
});
