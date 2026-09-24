/**
 * M2-03: runtime id tables (docs/WORLD.md §4): sorted assignment, 0 = none, save id tables and
 * remapping of loaded chunks when content was added.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import {
  CHUNK_AREA,
  ChunkData,
  RUNTIME_ID_NONE,
  RuntimeIdError,
  RuntimeIdTable,
  U16_ID_CAPACITY,
  U8_ID_CAPACITY,
  chunkHash,
  contentWorldIdTables,
  createChunkIdRemap,
  createWorldIdTables,
  isIdentityRemap,
  parseWorldIdTablesSnapshot,
  remapChunk,
  serializeWorldIdTables,
} from '../../../src/world/model';

describe('RuntimeIdTable', () => {
  it('numbers ids from 1 in code unit order; 0 means none', () => {
    const t = RuntimeIdTable.fromIds('terrain', ['sand', 'erde', 'gras', 'ader_zinn', 'Z_upper'], U8_ID_CAPACITY);
    expect(t.ids()).toEqual(['Z_upper', 'ader_zinn', 'erde', 'gras', 'sand']);
    expect(t.runtimeId('Z_upper')).toBe(1);
    expect(t.runtimeId('sand')).toBe(5);
    expect(t.stringId(3)).toBe('erde');
    expect(t.size).toBe(5);
    expect(t.find('lava')).toBeUndefined();
    expect(t.has('gras')).toBe(true);
    expect(RUNTIME_ID_NONE).toBe(0);
    expect(() => t.runtimeId('lava')).toThrow(RuntimeIdError);
    expect(() => t.stringId(0)).toThrow(RuntimeIdError);
    expect(() => t.stringId(6)).toThrow(RuntimeIdError);
  });

  it('rejects duplicates and ids beyond the field capacity', () => {
    expect(() => RuntimeIdTable.fromIds('x', ['a', 'b', 'a'], U8_ID_CAPACITY)).toThrow(/duplicate id "a"/);
    const many = Array.from({ length: 256 }, (_, i) => `t${i}`);
    expect(() => RuntimeIdTable.fromIds('x', many, U8_ID_CAPACITY)).toThrow(/exceed/);
    expect(RuntimeIdTable.fromIds('x', many, U16_ID_CAPACITY).size).toBe(256);
  });

  it('remaps saved numbering onto the current one after content was added', () => {
    const saved = ['erde', 'gras', 'sand'];
    const current = RuntimeIdTable.fromIds('terrain', ['asche', 'erde', 'gras', 'sand', 'schnee'], U8_ID_CAPACITY);
    const remap = current.remapFrom(saved);
    expect(remap).not.toBeNull();
    expect(Array.from(remap as Uint16Array)).toEqual([0, 2, 3, 4]);
    // Appended at the end of the sort order: numbering unchanged, nothing to rewrite.
    expect(RuntimeIdTable.fromIds('terrain', ['erde', 'gras', 'sand', 'strasse'], U8_ID_CAPACITY).remapFrom(saved)).toBeNull();
    expect(() => current.remapFrom(['erde', 'lehm', 'kies'])).toThrow(/no longer exists: lehm, kies/);
  });
});

describe('world id tables', () => {
  it('cover the content registry and fit their chunk fields', () => {
    const t = contentWorldIdTables();
    expect(t).toBe(contentWorldIdTables());
    expect(t.terrain.size).toBe(CONTENT.collection('terrain').size);
    expect(t.biomes.size).toBe(11);
    expect(t.objects.size).toBe(CONTENT.collection('worldObjects').size);
    expect(t.terrain.size).toBeLessThanOrEqual(U8_ID_CAPACITY);
    expect(t.objects.size).toBeLessThanOrEqual(U16_ID_CAPACITY);
    for (const id of CONTENT.collection('terrain').ids()) expect(t.terrain.stringId(t.terrain.runtimeId(id))).toBe(id);
    // Sorted by string id, independent of the definition order in the content files.
    expect([...t.biomes.ids()]).toEqual([...CONTENT.collection('biomes').ids()].sort());
  });

  it('saves the id lists and validates them on load', () => {
    const t = contentWorldIdTables();
    const snapshot = serializeWorldIdTables(t);
    expect(parseWorldIdTablesSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(isIdentityRemap(createChunkIdRemap(snapshot, t))).toBe(true);
    expect(() => parseWorldIdTablesSnapshot({ terrain: [], biomes: [] })).toThrow(TypeError);
    expect(() => parseWorldIdTablesSnapshot({ terrain: [''], biomes: [], objects: [] })).toThrow(TypeError);
  });

  it('remaps a chunk saved with an older content version', () => {
    const old = createWorldIdTables({ terrain: ['erde', 'fels', 'gras'], biomes: ['gruenhain', 'nebelmoor'], objects: ['baum_eiche', 'fels_klein_gruenhain'] });
    const now = createWorldIdTables({
      terrain: ['asche', 'erde', 'fels', 'gras', 'sand'],
      biomes: ['frostkamm', 'gruenhain', 'nebelmoor'],
      objects: ['baum_birke', 'baum_eiche', 'busch_beeren', 'fels_klein_gruenhain'],
    });
    const chunk = new ChunkData(-1, 2, 3);
    for (let i = 0; i < CHUNK_AREA; i++) {
      chunk.ground[i] = old.terrain.runtimeId(i % 2 === 0 ? 'gras' : 'erde');
      chunk.solid[i] = i % 3 === 0 ? old.terrain.runtimeId('fels') : 0;
      chunk.biome[i] = old.biomes.runtimeId(i < 512 ? 'gruenhain' : 'nebelmoor');
      chunk.object[i] = i % 5 === 0 ? old.objects.runtimeId('baum_eiche') : i % 7 === 0 ? old.objects.runtimeId('fels_klein_gruenhain') : 0;
    }
    const remap = createChunkIdRemap(serializeWorldIdTables(old), now);
    expect(isIdentityRemap(remap)).toBe(false);
    remapChunk(chunk, remap);
    for (let i = 0; i < CHUNK_AREA; i++) {
      expect(now.terrain.stringId(chunk.ground[i] as number)).toBe(i % 2 === 0 ? 'gras' : 'erde');
      expect(chunk.solid[i]).toBe(i % 3 === 0 ? now.terrain.runtimeId('fels') : 0);
      expect(now.biomes.stringId(chunk.biome[i] as number)).toBe(i < 512 ? 'gruenhain' : 'nebelmoor');
      const o = chunk.object[i] as number;
      expect(o === 0 ? null : now.objects.stringId(o)).toBe(i % 5 === 0 ? 'baum_eiche' : i % 7 === 0 ? 'fels_klein_gruenhain' : null);
    }
    // An identity remap leaves the chunk untouched.
    const before = chunkHash(chunk);
    remapChunk(chunk, createChunkIdRemap(serializeWorldIdTables(now), now));
    expect(chunkHash(chunk)).toBe(before);
  });

  it('reports chunk values outside the saved table', () => {
    const old = createWorldIdTables({ terrain: ['erde', 'gras'], biomes: ['gruenhain'], objects: [] });
    const now = createWorldIdTables({ terrain: ['asche', 'erde', 'gras'], biomes: ['gruenhain'], objects: [] });
    const chunk = new ChunkData(0, 0, 0);
    chunk.ground[10] = 9;
    expect(() => remapChunk(chunk, createChunkIdRemap(serializeWorldIdTables(old), now))).toThrow(/terrain runtime id 9 at tile 10/);
  });
});
