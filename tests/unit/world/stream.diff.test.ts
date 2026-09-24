/**
 * Chunk diffs against the generated state (docs/WORLD.md §5, M2-27): sparse run-length patches of
 * the typed arrays plus the complete object state set.
 */
import { describe, expect, it } from 'vitest';
import { ChunkData, chunkHash } from '../../../src/world/model/chunk';
import { CHUNK_AREA } from '../../../src/world/model/coords';
import { RuntimeIdError, createChunkIdRemap, createWorldIdTables } from '../../../src/world/model/runtimeIds';
import { CHUNK_DIFF_FORMAT, applyChunkDiff, chunkDiffBytes, chunkDiffHash, diffChunk, objectStateQuads, parseChunkDiff, remapChunkDiff } from '../../../src/world/stream/diff';
import { fixtureGenerate } from './streamFixture';

const PLAN = { seed: 3 };

function modified(): { base: ChunkData; cur: ChunkData } {
  const base = fixtureGenerate(PLAN, 0, 4, 5);
  const cur = base.clone();
  cur.ground[0] = 9;
  cur.ground[1] = 9;
  cur.ground[500] = 7;
  cur.flags[CHUNK_AREA - 1] = 0b1000_0000;
  cur.setObject(40, 1234);
  cur.setObjectState(77, 2, 0.5, 9000);
  return { base, cur };
}

describe('chunk diff', () => {
  it('is null for an unchanged chunk and for identical object states', () => {
    const base = fixtureGenerate(PLAN, -1, 2, 2);
    expect(diffChunk(base, base.clone())).toBeNull();
  });

  it('patches only the changed tiles and restores the exact chunk', () => {
    const { base, cur } = modified();
    const diff = diffChunk(base, cur);
    expect(diff).not.toBeNull();
    const d = diff as NonNullable<typeof diff>;
    expect(d.format).toBe(CHUNK_DIFF_FORMAT);
    expect(Object.keys(d.fields).sort()).toEqual(['flags', 'ground', 'object']);
    expect(Array.from(d.fields.ground?.runs ?? [])).toEqual([0, 2, 498, 1]);
    expect(Array.from(d.fields.ground?.values ?? [])).toEqual([9, 9, 7]);
    expect(d.fields.object?.values).toBeInstanceOf(Uint16Array);
    expect(Array.from(d.fields.object?.values ?? [])).toEqual([1234]);
    const restored = fixtureGenerate(PLAN, 0, 4, 5);
    applyChunkDiff(restored, d);
    expect(chunkHash(restored)).toBe(chunkHash(cur));
    expect(chunkDiffBytes(d)).toBeLessThan(200);
  });

  it('records object state changes without tile changes', () => {
    const base = fixtureGenerate(PLAN, 0, 1, 1);
    const cur = base.clone();
    cur.setObjectState(3, 1, 0);
    const d = diffChunk(base, cur);
    expect(d?.fields).toEqual({});
    expect(Array.from(d?.objects ?? [])).toEqual(Array.from(objectStateQuads(cur)));
  });

  it('survives structured clone (IndexedDB) and validates untrusted data', () => {
    const { base, cur } = modified();
    const d = diffChunk(base, cur) as NonNullable<ReturnType<typeof diffChunk>>;
    const copy = parseChunkDiff(structuredClone(d));
    expect(chunkDiffHash(copy)).toBe(chunkDiffHash(d));
    const bad: unknown[] = [
      null,
      { ...d, format: 99 },
      { ...d, layer: 5 },
      { ...d, fields: { nope: d.fields.ground } },
      { ...d, fields: { ground: { runs: Uint16Array.of(0, 2), values: Uint8Array.of(1) } } },
      { ...d, fields: { ground: { runs: Uint16Array.of(1020, 5), values: Uint8Array.of(1, 1, 1, 1, 1) } } },
      { ...d, fields: { ground: { runs: Uint16Array.of(0, 0), values: new Uint8Array(0) } } },
      { ...d, fields: { object: { runs: Uint16Array.of(0, 1), values: Uint8Array.of(1) } } },
      { ...d, objects: Float64Array.of(5, 1, 1) },
      { ...d, objects: Float64Array.of(5, 1, 1, -1, 4, 1, 1, -1) },
      { ...d, objects: [1, 2, 3, 4] },
    ];
    for (const b of bad) expect(() => parseChunkDiff(b)).toThrow(TypeError);
  });

  it('refuses to apply a diff to another address or past the chunk', () => {
    const { base, cur } = modified();
    const d = diffChunk(base, cur) as NonNullable<ReturnType<typeof diffChunk>>;
    expect(() => applyChunkDiff(fixtureGenerate(PLAN, 0, 4, 6), d)).toThrow(RangeError);
    const broken = { ...d, fields: { ground: { runs: Uint16Array.of(1023, 3), values: Uint8Array.of(1, 2, 3) } } };
    expect(() => applyChunkDiff(fixtureGenerate(PLAN, 0, 4, 5), broken)).toThrow(RangeError);
  });

  it('hashes every part of the diff', () => {
    const { base, cur } = modified();
    const d = diffChunk(base, cur) as NonNullable<ReturnType<typeof diffChunk>>;
    const h = chunkDiffHash(d);
    const variants = [
      { ...d, cx: 5 },
      { ...d, fields: { ...d.fields, ground: { runs: d.fields.ground?.runs ?? new Uint16Array(0), values: Uint8Array.of(9, 9, 8) } } },
      { ...d, fields: { ...d.fields, flags: undefined } },
      { ...d, objects: Float64Array.of(77, 2, 0.5, 9001) },
    ];
    for (const v of variants) expect(chunkDiffHash(v)).not.toBe(h);
  });

  it('remaps saved runtime ids onto the current tables', () => {
    const saved = { terrain: ['erde', 'gras', 'sand'], biomes: ['gruenhain', 'salzkueste'], objects: ['baum_eiche', 'fels_klein'] };
    const current = createWorldIdTables({ terrain: ['asche', 'erde', 'gras', 'sand'], biomes: ['frostkamm', 'gruenhain', 'salzkueste'], objects: ['baum_birke', 'baum_eiche', 'fels_klein'] });
    const base = new ChunkData(0, 0, 0);
    const cur = base.clone();
    cur.ground[5] = 2; // gras
    cur.solid[6] = 3; // sand
    cur.biome[7] = 1; // gruenhain
    cur.object[8] = 2; // fels_klein
    cur.water[9] = 1; // not an id: unchanged by remapping
    const d = diffChunk(base, cur) as NonNullable<ReturnType<typeof diffChunk>>;
    const r = remapChunkDiff(d, createChunkIdRemap(saved, current));
    const target = new ChunkData(0, 0, 0);
    applyChunkDiff(target, r);
    expect(current.terrain.stringId(target.ground[5] as number)).toBe('gras');
    expect(current.terrain.stringId(target.solid[6] as number)).toBe('sand');
    expect(current.biomes.stringId(target.biome[7] as number)).toBe('gruenhain');
    expect(current.objects.stringId(target.object[8] as number)).toBe('fels_klein');
    expect(target.water[9]).toBe(1);
    const tooHigh = { ...d, fields: { ground: { runs: Uint16Array.of(0, 1), values: Uint8Array.of(9) } } };
    expect(() => remapChunkDiff(tooHigh, createChunkIdRemap(saved, current))).toThrow(RuntimeIdError);
  });
});
