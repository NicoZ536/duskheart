/**
 * M2-03: ChunkData (docs/WORLD.md §3): layout of the seven typed arrays in one 8 KiB buffer, bit
 * fields, sparse object state, chunk hash and snapshot roundtrip.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/engine/rng';
import {
  CHUNK_AREA,
  CHUNK_BYTES,
  CHUNK_BYTES_PER_TILE,
  CHUNK_FIELDS,
  ChunkData,
  NO_REGROW_TICK,
  OBJECT_STATE_BYTES_ESTIMATE,
  TILE_FLAG_BRIDGE,
  TILE_FLAG_CLIFF_EDGE,
  TILE_FLAG_DUG,
  TILE_FLAG_FORD,
  TILE_FLAG_PLACE,
  TILE_FLAG_RAMP,
  TILE_FLAG_ROAD,
  TILE_FLAG_STAIRS,
  WATER_DEPTH_DEEP,
  WATER_DEPTH_MASK,
  WATER_DEPTH_SHALLOW,
  WATER_FROZEN,
  WATER_LAKE,
  WATER_RIVER,
  WATER_SEA,
  WATER_SPRING,
  chunkHash,
  deserializeChunk,
  packChunkId,
  serializeChunk,
  waterDepth,
  withWaterDepth,
  type ChunkField,
} from '../../../src/world/model';

/** A chunk with every field filled from a seeded stream plus a few object states. */
function randomChunk(seed: number): ChunkData {
  const rng = new Rng(seed);
  const c = new ChunkData(-2, 5, -3);
  for (let i = 0; i < CHUNK_AREA; i++) {
    // Runs of equal values like real terrain, so RLE has something to compress.
    const run = i >> 4;
    c.ground[i] = (run * 7 + (rng.bool(0.1) ? 1 : 0)) & 0xff;
    c.height[i] = rng.int(0, 5);
    c.biome[i] = 1 + (run % 3);
    c.water[i] = rng.bool(0.2) ? WATER_RIVER | WATER_DEPTH_SHALLOW : 0;
    c.solid[i] = rng.bool(0.5) ? 3 : 0;
    c.object[i] = rng.bool(0.05) ? rng.int(1, 600) : 0;
    c.flags[i] = rng.bool(0.02) ? TILE_FLAG_ROAD : 0;
  }
  c.setObjectState(17, 3.5, 0, NO_REGROW_TICK);
  c.setObjectState(1000, 0, 0.25, 123456);
  c.setObjectState(2, 12, 1, 7);
  c.frozenAtTick = 98765;
  return c;
}

describe('ChunkData layout (WORLD.md §3)', () => {
  it('8 bytes per tile, 8 KiB per chunk in one transferable buffer', () => {
    expect(CHUNK_BYTES_PER_TILE).toBe(8);
    expect(CHUNK_BYTES).toBe(8192);
    const c = new ChunkData(0, 1, 2);
    expect(c.buffer.byteLength).toBe(8192);
    for (const name of CHUNK_FIELDS) {
      const f = c.field(name);
      expect(f.length, name).toBe(CHUNK_AREA);
      expect(f.buffer, name).toBe(c.buffer);
    }
    expect(c.object).toBeInstanceOf(Uint16Array);
    expect(CHUNK_FIELDS).toEqual(['ground', 'height', 'biome', 'water', 'solid', 'object', 'flags']);
    expect(c.memoryBytes()).toBe(8192);
    c.setObjectState(0, 1, 0);
    expect(c.memoryBytes()).toBe(8192 + OBJECT_STATE_BYTES_ESTIMATE);
  });

  it('fields do not overlap', () => {
    const c = new ChunkData(0, 0, 0);
    CHUNK_FIELDS.forEach((name, k) => c.field(name).fill(k + 1));
    CHUNK_FIELDS.forEach((name, k) => {
      const f = c.field(name);
      for (let i = 0; i < CHUNK_AREA; i++) if (f[i] !== k + 1) throw new Error(`${name}[${i}] overwritten`);
    });
    c.object[5] = 0xffff;
    expect(c.object[5]).toBe(0xffff);
    expect(c.flags[CHUNK_AREA - 1]).toBe(CHUNK_FIELDS.indexOf('flags') + 1);
  });

  it('wraps a buffer received from a worker and validates its address', () => {
    const source = randomChunk(1);
    const copy = new ChunkData(-2, 5, -3, source.buffer.slice(0));
    expect(Array.from(copy.object)).toEqual(Array.from(source.object));
    expect(() => new ChunkData(0, 0, 0, new ArrayBuffer(100))).toThrow(RangeError);
    expect(() => new ChunkData(1 as 0, 0, 0)).toThrow(RangeError);
    expect(() => new ChunkData(0, 0.5, 0)).toThrow(RangeError);
    expect(source.key).toBe('-2:5:-3');
    expect(source.id).toBe(packChunkId(-2, 5, -3));
  });

  it('water and flag bits are distinct and fit in a byte', () => {
    const water = [WATER_RIVER, WATER_LAKE, WATER_SEA, WATER_FROZEN, WATER_SPRING];
    const flags = [TILE_FLAG_RAMP, TILE_FLAG_STAIRS, TILE_FLAG_ROAD, TILE_FLAG_FORD, TILE_FLAG_BRIDGE, TILE_FLAG_PLACE, TILE_FLAG_CLIFF_EDGE, TILE_FLAG_DUG];
    expect(water.reduce((a, b) => a | b, WATER_DEPTH_MASK)).toBe(0b111_1111);
    expect(water.every((b) => (b & WATER_DEPTH_MASK) === 0 && (b & (b - 1)) === 0)).toBe(true);
    expect(flags.reduce((a, b) => a | b, 0)).toBe(0xff);
    expect(new Set(flags).size).toBe(8);
    const w = WATER_LAKE | WATER_FROZEN | WATER_DEPTH_DEEP;
    expect(waterDepth(w)).toBe(WATER_DEPTH_DEEP);
    expect(withWaterDepth(w, WATER_DEPTH_SHALLOW)).toBe(WATER_LAKE | WATER_FROZEN | WATER_DEPTH_SHALLOW);
  });
});

describe('object state', () => {
  it('is sparse, reused per tile and dropped when the object changes', () => {
    const c = new ChunkData(0, 0, 0);
    c.object[40] = 9;
    const s = c.setObjectState(40, 10, 0);
    expect(c.setObjectState(40, 4, 0.5, 900)).toBe(s);
    expect(c.getObjectState(40)).toEqual({ hp: 4, growth: 0.5, regrowAtTick: 900 });
    c.setObject(40, 11);
    expect(c.getObjectState(40)).toBeUndefined();
    c.setObjectState(41, 1, 0);
    c.clearObjectState(41);
    expect(c.objectState.size).toBe(0);
    expect(() => c.setObjectState(CHUNK_AREA, 1, 0)).toThrow(RangeError);
  });

  it('clone and copyFrom are deep', () => {
    const a = randomChunk(2);
    const b = a.clone();
    expect(chunkHash(b)).toBe(chunkHash(a));
    expect(b.frozenAtTick).toBe(a.frozenAtTick);
    b.ground[0] = (b.ground[0] as number) + 1;
    (b.getObjectState(17) as { hp: number }).hp = 99;
    expect(a.getObjectState(17)?.hp).toBe(3.5);
    expect(chunkHash(b)).not.toBe(chunkHash(a));
  });
});

describe('chunkHash', () => {
  it('is deterministic and pinned (hash snapshot)', () => {
    expect(chunkHash(new ChunkData(0, 0, 0))).toBe(chunkHash(new ChunkData(0, 0, 0)));
    expect(chunkHash(randomChunk(3))).toBe(chunkHash(randomChunk(3)));
    expect(chunkHash(new ChunkData(0, 0, 0))).toBe('0cd79828107c4c24');
    expect(chunkHash(randomChunk(3))).toBe('ccafbb61b9ca51be');
  });

  it('changes with every field, every object state value and the address', () => {
    const base = randomChunk(4);
    const h = chunkHash(base);
    for (const name of CHUNK_FIELDS as readonly ChunkField[]) {
      const c = base.clone();
      const f = c.field(name);
      f[777] = ((f[777] as number) + 1) & 0xff;
      expect(chunkHash(c), name).not.toBe(h);
    }
    for (const key of ['hp', 'growth', 'regrowAtTick'] as const) {
      const c = base.clone();
      (c.getObjectState(1000) as Record<typeof key, number>)[key] += 1;
      expect(chunkHash(c), key).not.toBe(h);
    }
    const moved = new ChunkData(-2, 5, -2).copyFrom(base);
    expect(chunkHash(moved)).not.toBe(h);
    const other = new ChunkData(-1, 5, -3).copyFrom(base);
    expect(chunkHash(other)).not.toBe(h);
  });

  it('ignores frozenAtTick and the insertion order of object states', () => {
    const a = randomChunk(5);
    const b = a.clone();
    b.frozenAtTick = 1;
    expect(chunkHash(b)).toBe(chunkHash(a));
    const c = a.clone();
    c.objectState.clear();
    for (const i of [1000, 2, 17]) {
      const s = a.getObjectState(i);
      if (s !== undefined) c.setObjectState(i, s.hp, s.growth, s.regrowAtTick);
    }
    expect(chunkHash(c)).toBe(chunkHash(a));
  });
});

describe('chunk snapshot', () => {
  it('roundtrips through JSON and structured clone', () => {
    const a = randomChunk(6);
    for (const data of [JSON.parse(JSON.stringify(serializeChunk(a))), structuredClone(serializeChunk(a))]) {
      const b = deserializeChunk(data);
      expect(chunkHash(b)).toBe(chunkHash(a));
      expect([b.layer, b.cx, b.cy, b.frozenAtTick]).toEqual([-2, 5, -3, 98765]);
      expect(serializeChunk(b)).toEqual(serializeChunk(a));
    }
  });

  it('is compact for uniform chunks (RLE)', () => {
    const c = new ChunkData(0, 3, 4);
    c.ground.fill(5);
    c.biome.fill(2);
    const json = JSON.stringify(serializeChunk(c));
    expect(json.length).toBeLessThan(400);
  });

  it('rejects malformed snapshots', () => {
    const good = serializeChunk(randomChunk(7));
    const cases: unknown[] = [
      null,
      { ...good, version: 2 },
      { ...good, layer: 1 },
      { ...good, cx: 1.5 },
      { ...good, frozenAtTick: -1 },
      { ...good, fields: { ...good.fields, height: undefined } },
      { ...good, fields: { ...good.fields, ground: 'AQE=' } },
      { ...good, objects: [1, 2, 3] },
      { ...good, objects: [5, 1, 0, -1, 5, 1, 0, -1] },
      { ...good, objects: [2000, 1, 0, -1] },
      { ...good, objects: [5, Number.NaN, 0, -1] },
      { ...good, objects: [5, 1, 0, -2] },
    ];
    for (const data of cases) expect(() => deserializeChunk(data)).toThrow(TypeError);
  });
});
