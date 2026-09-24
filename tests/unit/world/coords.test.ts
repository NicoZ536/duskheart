/**
 * M2-03: coordinates ↔ chunk ↔ layer (docs/WORLD.md §1) and world sizes (§9.1).
 */
import { describe, expect, it } from 'vitest';
import { floorDiv, mod } from '../../../src/engine/math';
import {
  CHUNK_AREA,
  CHUNK_COORD_MAX,
  CHUNK_COORD_MIN,
  CHUNK_PX,
  CHUNK_SIZE,
  LAYERS,
  LAYER_COUNT,
  TILE_PX,
  chunkInWorld,
  chunkKey,
  chunkToTile,
  isLayer,
  isWorldSizePreset,
  layerAt,
  layerIndex,
  localIndex,
  localX,
  localY,
  packChunkId,
  parseChunkKey,
  pxToChunk,
  pxToTile,
  tileCenterPx,
  tileInWorld,
  tileLocalIndex,
  tileToChunk,
  tileToLocal,
  tileToPx,
  unpackChunkId,
  worldDimensions,
  worldTileX,
  worldTileY,
  type ChunkCoord,
  type Layer,
} from '../../../src/world/model';

describe('tile ↔ chunk ↔ local index', () => {
  it('uses 32×32 chunks of 16 px tiles', () => {
    expect([CHUNK_SIZE, CHUNK_AREA, TILE_PX, CHUNK_PX]).toEqual([32, 1024, 16, 512]);
  });

  it('matches floorDiv/mod for positive and negative tiles', () => {
    for (let t = -200; t <= 200; t++) {
      expect(tileToChunk(t)).toBe(floorDiv(t, 32));
      expect(tileToLocal(t)).toBe(mod(t, 32));
      expect(chunkToTile(tileToChunk(t)) + tileToLocal(t)).toBe(t);
    }
    expect([tileToChunk(-1), tileToLocal(-1)]).toEqual([-1, 31]);
    expect([tileToChunk(-32), tileToLocal(-32)]).toEqual([-1, 0]);
    expect([tileToChunk(-33), tileToLocal(-33)]).toEqual([-2, 31]);
    expect([tileToChunk(2047), tileToLocal(2047)]).toEqual([63, 31]);
  });

  it('local index i = (ty mod 32) × 32 + (tx mod 32) and back to world tiles', () => {
    const samples: Array<[number, number]> = [
      [0, 0],
      [31, 0],
      [0, 31],
      [31, 31],
      [100, 777],
      [-1, -1],
      [-33, 65],
      [1535, 1535],
    ];
    for (const [tx, ty] of samples) {
      const i = tileLocalIndex(tx, ty);
      expect(i).toBe(mod(ty, 32) * 32 + mod(tx, 32));
      expect(i).toBe(localIndex(tileToLocal(tx), tileToLocal(ty)));
      expect([localX(i), localY(i)]).toEqual([tileToLocal(tx), tileToLocal(ty)]);
      expect(worldTileX(tileToChunk(tx), i)).toBe(tx);
      expect(worldTileY(tileToChunk(ty), i)).toBe(ty);
    }
    const seen = new Set<number>();
    for (let ly = 0; ly < 32; ly++) for (let lx = 0; lx < 32; lx++) seen.add(localIndex(lx, ly));
    expect(seen.size).toBe(CHUNK_AREA);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(CHUNK_AREA - 1);
  });

  it('converts world pixels to tiles and chunks', () => {
    expect([pxToTile(0), pxToTile(15.99), pxToTile(16), pxToTile(-0.01), pxToTile(-16), pxToTile(-16.5)]).toEqual([0, 0, 1, -1, -1, -2]);
    expect([tileToPx(3), tileCenterPx(3)]).toEqual([48, 56]);
    expect([pxToChunk(511.9), pxToChunk(512), pxToChunk(-1)]).toEqual([0, 1, -1]);
    for (let px = -2000; px <= 2000; px += 37.5) expect(pxToChunk(px)).toBe(tileToChunk(pxToTile(px)));
  });
});

describe('layers', () => {
  it('surface and three underground layers share the coordinate system', () => {
    expect(LAYERS).toEqual([0, -1, -2, -3]);
    expect(LAYER_COUNT).toBe(4);
    LAYERS.forEach((layer, i) => {
      expect(layerIndex(layer)).toBe(i);
      expect(layerAt(i)).toBe(layer);
      expect(isLayer(layer)).toBe(true);
    });
    for (const v of [1, -4, 0.5, '0', null]) expect(isLayer(v)).toBe(false);
    expect(() => layerAt(4)).toThrow(RangeError);
  });
});

describe('chunk keys', () => {
  it('string keys layer:cx:cy roundtrip', () => {
    for (const layer of LAYERS) {
      for (const [cx, cy] of [
        [0, 0],
        [47, 12],
        [-3, -7],
      ] as const) {
        const key = chunkKey(layer, cx, cy);
        expect(key).toBe(`${layer}:${cx}:${cy}`);
        expect(parseChunkKey(key)).toEqual({ layer, cx, cy });
      }
    }
    for (const bad of ['', '0:1', '1:0:0', '0:a:0', '0:1:2:3', '0:1.5:2', '-0x1:0:0']) expect(() => parseChunkKey(bad), bad).toThrow(SyntaxError);
  });

  it('packed ids are unique, non-negative and roundtrip', () => {
    const out: ChunkCoord = { layer: 0, cx: 0, cy: 0 };
    const ids = new Set<number>();
    const coords = [CHUNK_COORD_MIN, -1, 0, 1, 63, CHUNK_COORD_MAX];
    for (const layer of LAYERS) {
      for (const cx of coords) {
        for (const cy of coords) {
          const id = packChunkId(layer, cx, cy);
          expect(Number.isSafeInteger(id) && id >= 0).toBe(true);
          ids.add(id);
          expect(unpackChunkId(id, out)).toEqual({ layer, cx, cy });
        }
      }
    }
    expect(ids.size).toBe(LAYER_COUNT * coords.length * coords.length);
    expect(() => packChunkId(0 as Layer, CHUNK_COORD_MAX + 1, 0)).toThrow(RangeError);
    expect(() => packChunkId(0, 0, 0.5)).toThrow(RangeError);
    expect(() => unpackChunkId(-1, out)).toThrow(RangeError);
  });
});

describe('world sizes (§9.1)', () => {
  it('Klein 1024² · Mittel 1536² · Groß 2048² tiles in whole chunks', () => {
    expect(['small', 'medium', 'large'].map((p) => (isWorldSizePreset(p) ? worldDimensions(p) : null))).toEqual([
      { preset: 'small', tiles: 1024, chunks: 32, pixels: 16384, chunksPerLayer: 1024, chunksTotal: 4096 },
      { preset: 'medium', tiles: 1536, chunks: 48, pixels: 24576, chunksPerLayer: 2304, chunksTotal: 9216 },
      { preset: 'large', tiles: 2048, chunks: 64, pixels: 32768, chunksPerLayer: 4096, chunksTotal: 16384 },
    ]);
    expect(isWorldSizePreset('huge')).toBe(false);
  });

  it('bounds checks for tiles and chunks', () => {
    const dim = worldDimensions('small');
    expect([tileInWorld(dim, 0, 0), tileInWorld(dim, 1023, 1023), tileInWorld(dim, 1024, 0), tileInWorld(dim, -1, 5)]).toEqual([true, true, false, false]);
    expect([chunkInWorld(dim, 31, 31), chunkInWorld(dim, 32, 0), chunkInWorld(dim, 0, -1)]).toEqual([true, false, false]);
    expect(Object.isFrozen(dim)).toBe(true);
  });
});
