/**
 * World meta (M2-27, MASTERPROMPT §28): seed, settings, version, play time and day in the `worlds`
 * store plus the world record (blob `world`) with versions and runtime id tables.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSimConfig } from '../../../src/game/sim';
import { openSaveDb } from '../../../src/save/db';
import { MemorySaveStore } from '../../../src/save/memoryStore';
import { SAVE_SNAPSHOT_FORMAT, SaveError } from '../../../src/save/registry';
import type { SaveStore } from '../../../src/save/store';
import { WORLD_RECORD_BLOB, WORLD_RECORD_FORMAT, checkWorldRecord, createWorldMeta, readWorldMeta, writeWorldMeta, type WorldMetaInput } from '../../../src/save/worldMeta';
import { contentWorldIdTables, createWorldIdTables, isIdentityRemap, serializeWorldIdTables } from '../../../src/world/model/runtimeIds';
import { CHUNK_DIFF_FORMAT } from '../../../src/world/stream/diff';

const opened: SaveStore[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
});

function input(extra: Partial<WorldMetaInput> = {}): WorldMetaInput {
  return {
    worldId: 'w1',
    name: 'Grauheide',
    config: resolveSimConfig({ seed: 123, worldSize: 'large', dayLengthMinutes: 36 }),
    tick: 777_000,
    day: 4,
    now: 1_700_000_500_000,
    gameVersion: '0.2.0',
    generatorVersion: 3,
    tables: contentWorldIdTables(),
    ...extra,
  };
}

describe.each([
  { name: 'IndexedDB (fake-indexeddb)', open: async () => openSaveDb(new IDBFactory(), 'meta-test') },
  { name: 'in-memory', open: async () => new MemorySaveStore() as SaveStore },
])('world meta: $name', ({ open }) => {
  it('stores seed, settings, versions, play time and day and reads them back', async () => {
    const store = await open();
    opened.push(store);
    const world = createWorldMeta(input());
    await store.write((b) => writeWorldMeta(b, world));
    const read = await readWorldMeta(store, 'w1');
    expect(read).toEqual(world);
    expect(read.meta).toMatchObject({ seed: 123, config: { seed: 123, worldSize: 'large', dayLengthMinutes: 36 }, saveFormat: SAVE_SNAPSHOT_FORMAT, tick: 777_000, day: 4 });
    expect(read.record).toEqual({
      format: WORLD_RECORD_FORMAT,
      gameVersion: '0.2.0',
      generatorVersion: 3,
      chunkFormat: CHUNK_DIFF_FORMAT,
      ids: serializeWorldIdTables(contentWorldIdTables()),
    });
    expect((await store.listWorlds()).map((w) => w.id)).toEqual(['w1']);
  });

  it('keeps the creation time on later saves', async () => {
    const store = await open();
    opened.push(store);
    const first = createWorldMeta(input({ now: 1000 }));
    await store.write((b) => writeWorldMeta(b, first));
    const later = createWorldMeta(input({ now: 5000, tick: 800_000, day: 5 }), (await readWorldMeta(store, 'w1')).meta);
    expect([later.meta.createdAt, later.meta.savedAt, later.meta.tick, later.meta.day]).toEqual([1000, 5000, 800_000, 5]);
  });

  it('reports missing worlds and corrupt records; old worlds have no record', async () => {
    const store = await open();
    opened.push(store);
    await expect(readWorldMeta(store, 'nichts')).rejects.toThrow(SaveError);
    const world = createWorldMeta(input());
    await store.write((b) => b.putWorld(world.meta));
    expect((await readWorldMeta(store, 'w1')).record).toBeUndefined();
    await store.write((b) => b.putBlob({ worldId: 'w1', name: WORLD_RECORD_BLOB, data: { ...world.record, format: 9 } }));
    await expect(readWorldMeta(store, 'w1')).rejects.toThrow(/corrupt/);
  });
});

describe('world meta input and compatibility', () => {
  it('rejects invalid input', () => {
    expect(() => createWorldMeta(input({ tick: -1 }))).toThrow(SaveError);
    expect(() => createWorldMeta(input({ day: 0 }))).toThrow(SaveError);
    expect(() => createWorldMeta(input({ gameVersion: '' }))).toThrow(SaveError);
    expect(() => createWorldMeta(input({ generatorVersion: 0 }))).toThrow(SaveError);
    expect(() => createWorldMeta(input({ worldId: '' }))).toThrow(SaveError);
  });

  it('maps saved ids onto the running build and flags generator changes', () => {
    const current = contentWorldIdTables();
    const same = checkWorldRecord(createWorldMeta(input()).record, { tables: current, generatorVersion: 3 });
    expect(isIdentityRemap(same.remap)).toBe(true);
    expect(same.generatorChanged).toBe(false);
    const ids = serializeWorldIdTables(current);
    const older = createWorldMeta(input({ tables: createWorldIdTables({ ...ids, objects: ids.objects.slice(1) }) })).record;
    const upgraded = checkWorldRecord(older, { tables: current, generatorVersion: 4 });
    expect(upgraded.remap.objects).not.toBeNull();
    expect(upgraded.generatorChanged).toBe(true);
  });

  it('refuses saves with removed content or a newer chunk format', () => {
    const current = contentWorldIdTables();
    const ids = serializeWorldIdTables(current);
    const withGhost = createWorldMeta(input({ tables: createWorldIdTables({ ...ids, terrain: [...ids.terrain, 'zuckerwatte'] }) })).record;
    expect(() => checkWorldRecord(withGhost, { tables: current, generatorVersion: 3 })).toThrow(/zuckerwatte/);
    const newer = { ...createWorldMeta(input()).record, chunkFormat: CHUNK_DIFF_FORMAT + 1 };
    expect(() => checkWorldRecord(newer, { tables: current, generatorVersion: 3 })).toThrow(SaveError);
  });
});
