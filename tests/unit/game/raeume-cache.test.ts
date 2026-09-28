/**
 * Region cache of the room detection without garbage per query (§30 "Keine Allokationen in Hot-Loops", M4-Gate):
 * the outdoor fills – asked for with every new tile the player steps on in the open – stay out of the per-tile map of
 * the rooms (a short list of the most recent ones, `BALANCE.rooms.outdoorFills`), and a fill keeps its queue and
 * visited set in reused typed arrays. A sampling heap profile of `fluessiges-laufen` had shown the map's growth and
 * clearing and the fill's regrowing `Set` as the largest share of the objects that outlived the young generation.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { RoomMap, TileKeySet, keyTx, keyTy } from '../../../src/game/rooms/detect';
import { BUILD_LAYER_INDEX, anchorCell } from '../../../src/world/structures/cells';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { bauWelt, type BauWelt } from './bau-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

const R = BALANCE.rooms;
/** Tiles of an outdoor fill: it stops past `maxTiles`. */
const FILL_TILES = R.maxTiles + 1;
/** Distance between the start tiles of fills that must not overlap [tiles] (a fill reaches about 15 tiles). */
const APART = 40;

/** A room detection over an open meadow (everything outside the drawn rows is grass). */
function openWorld(): { w: BauWelt; map: RoomMap } {
  const w = bauWelt(meadow(30, 20));
  w.spawn(1, 1);
  const grid = w.collision.grid;
  const map = new RoomMap({ store: w.building.structures, catalog: w.building.catalog, beginQuery: () => grid.beginQuery(), info: (l, x, y) => grid.info(l, x, y) });
  return { w, map };
}

/** A finished wooden wall on tile (tx, ty), reported to the collision and the room detection like the building system. */
function wallAt(w: BauWelt, map: RoomMap, tx: number, ty: number): void {
  const wall = w.building.catalog.get('wand_holz');
  w.building.structures.set(0, BUILD_LAYER_INDEX.struktur, tx, ty, anchorCell(wall.rid, 0, false, false, false), wall.hp);
  w.collision.invalidateTile(0, tx, ty);
  map.invalidate(0, tx, ty, tx, ty);
}

/** Start tile of the n-th outdoor fill far from the others. */
function farTile(n: number): [number, number] {
  return [OFFSET + 20 + (n % 8) * APART, OFFSET + 20 + Math.floor(n / 8) * APART];
}

describe('TileKeySet', () => {
  it('hält Schlüssel, auch negative und kollidierende, und leert sich ohne neue Tabelle', () => {
    const set = new TileKeySet(40);
    const keys = [0, -1, 7, 4096 * 4096 * 3, -4096, 1 << 20, 3 << 20, 5 << 20];
    for (const k of keys) set.add(k);
    set.add(7);
    expect(set.size).toBe(keys.length);
    for (const k of keys) expect(set.has(k)).toBe(true);
    expect(set.has(8)).toBe(false);
    expect(set.has(-2)).toBe(false);
    set.clear();
    expect(set.size).toBe(0);
    for (const k of keys) expect(set.has(k)).toBe(false);
    // After clearing, the same slots serve new keys.
    for (let k = 0; k < 40; k++) set.add(k * 128);
    for (let k = 0; k < 40; k++) expect(set.has(k * 128)).toBe(true);
    expect(set.has(40 * 128)).toBe(false);
  });

  it('meldet, wenn mehr Schlüssel kommen, als die Füllung fassen kann', () => {
    const set = new TileKeySet(3);
    set.add(1);
    set.add(2);
    set.add(3);
    expect(() => set.add(4)).toThrow(RangeError);
  });
});

describe('Außenflächen im Regionen-Cache', () => {
  it('eine Außenfüllung liegt nicht in der Kachel-Map: jede ihrer Kacheln findet dieselbe Region, jenseits davon beginnt eine neue', () => {
    const { map } = openWorld();
    const [x, y] = farTile(0);
    const region = map.regionAt(0, x, y);
    expect(region?.room).toBe(false);
    expect(region?.size).toBe(FILL_TILES);
    expect(map.cachedTiles).toBe(FILL_TILES);
    expect(map.cachedRooms()).toEqual([]);
    for (const key of region?.tiles ?? []) expect(map.regionAt(0, keyTx(key), keyTy(key))).toBe(region);
    // A tile just outside the fill starts another one.
    const other = map.regionAt(0, (region?.x1 ?? 0) + 1, y);
    expect(other).not.toBe(region);
    expect(other?.room).toBe(false);
  });

  it('hält höchstens `outdoorFills` Füllungen, die älteste weicht zuerst; neu gefüllt ist sie dieselbe Region', () => {
    const { map } = openWorld();
    const first = map.regionAt(0, ...farTile(0));
    for (let n = 1; n <= R.outdoorFills; n++) {
      expect(map.regionAt(0, ...farTile(n))?.room).toBe(false);
      expect(map.cachedTiles).toBeLessThanOrEqual(R.outdoorFills * FILL_TILES);
    }
    // The most recent fills are still cached …
    expect(map.regionAt(0, ...farTile(R.outdoorFills))).toBe(map.regionAt(0, ...farTile(R.outdoorFills)));
    // … the first one went and is filled again: another object, the same region.
    const again = map.regionAt(0, ...farTile(0));
    expect(again).not.toBe(first);
    expect(again?.id).toBe(first?.id);
    expect(again?.tiles).toEqual(first?.tiles);
  });

  it('ein Bau an einer Außenfüllung verwirft genau sie, eine ferne bleibt', () => {
    const { w, map } = openWorld();
    const near = map.regionAt(0, ...farTile(0));
    const far = map.regionAt(0, ...farTile(2));
    const key = near?.tiles[Math.floor((near?.tiles.length ?? 0) / 2)] ?? 0;
    const tx = keyTx(key);
    const ty = keyTy(key);
    wallAt(w, map, tx, ty);
    expect(map.regionAt(0, ...farTile(2))).toBe(far);
    expect(map.regionAt(0, tx, ty)).toBeNull();
    const refilled = map.regionAt(0, ...farTile(0));
    expect(refilled).not.toBe(near);
    expect(refilled?.room).toBe(false);
    // A changed chunk drops the fills that reach into it.
    map.invalidateChunk(0, Math.floor(farTile(2)[0] / 32), Math.floor(farTile(2)[1] / 32));
    expect(map.regionAt(0, ...farTile(2))).not.toBe(far);
  });

  it('Räume bleiben pro Kachel im Cache, während die Außenfüllungen wechseln', () => {
    const { w, map } = openWorld();
    // A closed ring of walls around 3 × 3 tiles, away from the fills.
    const x0 = OFFSET + 4;
    const y0 = OFFSET + 4;
    for (let d = -1; d <= 3; d++) {
      wallAt(w, map, x0 + d, y0 - 1);
      wallAt(w, map, x0 + d, y0 + 3);
      wallAt(w, map, x0 - 1, y0 + d);
      wallAt(w, map, x0 + 3, y0 + d);
    }
    const room = map.regionAt(0, x0 + 1, y0 + 1);
    expect(room?.room).toBe(true);
    expect(room?.size).toBe(9);
    for (let n = 0; n < 2 * R.outdoorFills; n++) expect(map.regionAt(0, ...farTile(n))?.room).toBe(false);
    expect(map.regionAt(0, x0 + 2, y0 + 2)).toBe(room);
    expect(map.cachedRooms()).toEqual([room]);
    expect(map.cachedTiles).toBeLessThanOrEqual(9 + R.outdoorFills * FILL_TILES);
  });
});

describe('Regionen-Abfragen ohne Müll (§30)', () => {
  let session: Session;
  beforeAll(async () => {
    session = new Session();
    session.connect();
    await session.post('HeapProfiler.enable');
  });
  afterAll(() => session.disconnect());

  /** Bytes allocated below `RoomMap.regionAt` while `run` runs (sampling heap profile, collected objects included). */
  async function regionAtBytes(run: () => void): Promise<{ bytes: number; top: unknown }> {
    await session.post('HeapProfiler.collectGarbage');
    await session.post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    run();
    const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
    const alloc = pathAllocation(profile, (f) => f.functionName === 'regionAt' && /rooms\/detect/.test(f.url));
    return { bytes: alloc.inPath, top: alloc.top };
  }

  it('eine Außenfüllung legt nur ihre Region an (Kachelliste, Region), keine wachsenden Tabellen', async () => {
    const { map } = openWorld();
    const fills = 3 * R.outdoorFills;
    // Warm-up: optimized code, the first fills.
    for (let n = 0; n < fills; n++) map.regionAt(0, ...farTile(n));
    map.clear();
    const { bytes, top } = await regionAtBytes(() => {
      for (let round = 0; round < 4; round++) {
        map.clear();
        for (let n = 0; n < fills; n++) map.regionAt(0, ...farTile(n));
      }
    });
    const perFill = bytes / (4 * fills);
    // The region itself: its sorted tile list (401 numbers, 3.2 KB) and a few small objects – measured 4.1 KB per fill
    // with the numbers the unoptimized loops box. Mutation probes: a visited `Set` regrowing after every clear 25 KB,
    // a sort with a comparator 29 KB, the outdoor fill's 401 entries in the per-tile map 43 KB per fill.
    const bound = 2 * FILL_TILES * Float64Array.BYTES_PER_ELEMENT;
    expect(perFill, `bytes per fill: ${JSON.stringify(top)}`).toBeLessThan(bound);
  });

  it('eine Abfrage im Cache legt nichts an', async () => {
    const { map } = openWorld();
    const regions = Array.from({ length: R.outdoorFills }, (_, n) => map.regionAt(0, ...farTile(n)));
    const tiles = regions.flatMap((r) => (r?.tiles ?? []).filter((_, i) => i % 7 === 0));
    const query = (): void => {
      for (const key of tiles) map.regionAt(0, keyTx(key), keyTy(key));
    };
    for (let i = 0; i < 20; i++) query();
    const rounds = 50;
    const { bytes, top } = await regionAtBytes(() => {
      for (let i = 0; i < rounds; i++) query();
    });
    expect(bytes / (rounds * tiles.length), `bytes per cached query: ${JSON.stringify(top)}`).toBeLessThan(1);
  });
});
