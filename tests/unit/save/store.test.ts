/**
 * Contract tests for both `SaveStore` adapters: IndexedDB (via fake-indexeddb) and in-memory.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { SAVE_DB_NAME, SAVE_DB_VERSION, deleteSaveDb, openSaveDb } from '../../../src/save/db';
import { MemorySaveStore } from '../../../src/save/memoryStore';
import { SaveStoreError, type SaveStore, type WorldMeta } from '../../../src/save/store';

function meta(id: string, savedAt: number, extra: Partial<WorldMeta> = {}): WorldMeta {
  return {
    id,
    name: `Welt ${id}`,
    seed: 42,
    config: { seed: 42, worldSize: 'medium', dayLengthMinutes: 24 },
    saveFormat: 1,
    tick: 100,
    day: 1,
    createdAt: 1,
    savedAt,
    ...extra,
  };
}

const HASH = '0123456789abcdef';

interface Adapter {
  name: string;
  open(): Promise<SaveStore>;
}

const open: SaveStore[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

const adapters: Adapter[] = [
  {
    name: 'IndexedDB (fake-indexeddb)',
    async open() {
      const s = await openSaveDb(new IDBFactory());
      open.push(s);
      return s;
    },
  },
  {
    name: 'memory',
    async open() {
      const s = new MemorySaveStore();
      open.push(s);
      return s;
    },
  },
];

describe.each(adapters)('SaveStore contract: $name', (adapter) => {
  it('stores, lists and reads worlds, slots, chunks and blobs', async () => {
    const store = await adapter.open();
    expect(await store.listWorlds()).toEqual([]);
    await store.write((b) => {
      b.putWorld(meta('alpha', 10));
      b.putWorld(meta('beta', 20));
      b.putSlot({ worldId: 'alpha', slot: 'main', savedAt: 10, hash: HASH, snapshot: { format: 1, participants: {} } });
      b.putSlot({ worldId: 'alpha', slot: 'autosave-1', savedAt: 11, hash: HASH, snapshot: { n: 1 } });
      b.putChunk({ worldId: 'alpha', key: '0:3:-2', data: { ground: new Uint16Array([1, 2, 3]) } });
      b.putChunk({ worldId: 'alpha', key: '0:0:0', data: { ground: new Uint16Array([9]) } });
      b.putBlob({ worldId: 'alpha', name: 'map-reveal', data: new Uint8Array([255, 0]) });
      b.putChunk({ worldId: 'beta', key: '0:0:0', data: null });
    });
    expect((await store.listWorlds()).map((w) => w.id)).toEqual(['beta', 'alpha']);
    expect(await store.getWorld('alpha')).toEqual(meta('alpha', 10));
    expect(await store.getWorld('gamma')).toBeUndefined();
    expect(await store.listSlots('alpha')).toEqual(['autosave-1', 'main']);
    expect((await store.getSlot('alpha', 'autosave-1'))?.snapshot).toEqual({ n: 1 });
    expect(await store.getSlot('alpha', 'nope')).toBeUndefined();
    expect(await store.listChunkKeys('alpha')).toEqual(['0:0:0', '0:3:-2']);
    const chunk = await store.getChunk('alpha', '0:3:-2');
    const ground = (chunk?.data as { ground: Uint16Array }).ground;
    expect(ground).toBeInstanceOf(Uint16Array);
    expect(Array.from(ground)).toEqual([1, 2, 3]);
    const blob = await store.getBlob('alpha', 'map-reveal');
    expect(blob?.data).toBeInstanceOf(Uint8Array);
    expect(await store.getBlob('alpha', 'stats')).toBeUndefined();
    expect(await store.listChunkKeys('beta')).toEqual(['0:0:0']);
  });

  it('returns copies: later mutations of written or read values do not leak', async () => {
    const store = await adapter.open();
    const data = { ground: new Uint16Array([1, 2]) };
    await store.write((b) => b.putChunk({ worldId: 'w', key: 'k', data }));
    data.ground[0] = 99;
    const read = await store.getChunk('w', 'k');
    expect(Array.from((read?.data as typeof data).ground)).toEqual([1, 2]);
    (read?.data as typeof data).ground[1] = 77;
    expect(Array.from(((await store.getChunk('w', 'k'))?.data as typeof data).ground)).toEqual([1, 2]);
  });

  it('overwrites by key and deletes single records', async () => {
    const store = await adapter.open();
    await store.write((b) => {
      b.putWorld(meta('w', 1));
      b.putSlot({ worldId: 'w', slot: 'main', savedAt: 1, hash: HASH, snapshot: 1 });
      b.putChunk({ worldId: 'w', key: 'a', data: 1 });
      b.putBlob({ worldId: 'w', name: 'stats', data: 1 });
    });
    await store.write((b) => {
      b.putWorld(meta('w', 5, { name: 'Neu' }));
      b.putSlot({ worldId: 'w', slot: 'main', savedAt: 5, hash: HASH, snapshot: 2 });
    });
    expect((await store.getWorld('w'))?.name).toBe('Neu');
    expect((await store.getSlot('w', 'main'))?.snapshot).toBe(2);
    await store.write((b) => {
      b.deleteSlot('w', 'main');
      b.deleteChunk('w', 'a');
      b.deleteBlob('w', 'stats');
    });
    expect(await store.listSlots('w')).toEqual([]);
    expect(await store.listChunkKeys('w')).toEqual([]);
    expect(await store.getBlob('w', 'stats')).toBeUndefined();
    expect(await store.getWorld('w')).toBeDefined();
  });

  it('deleteWorld removes meta and all data of that world only', async () => {
    const store = await adapter.open();
    await store.write((b) => {
      for (const id of ['a', 'b']) {
        b.putWorld(meta(id, 1));
        b.putSlot({ worldId: id, slot: 'main', savedAt: 1, hash: HASH, snapshot: id });
        b.putChunk({ worldId: id, key: 'c1', data: id });
        b.putChunk({ worldId: id, key: 'c2', data: id });
        b.putBlob({ worldId: id, name: 'stats', data: id });
      }
    });
    await store.deleteWorld('a');
    expect((await store.listWorlds()).map((w) => w.id)).toEqual(['b']);
    expect(await store.listSlots('a')).toEqual([]);
    expect(await store.listChunkKeys('a')).toEqual([]);
    expect(await store.getBlob('a', 'stats')).toBeUndefined();
    expect(await store.listSlots('b')).toEqual(['main']);
    expect(await store.listChunkKeys('b')).toEqual(['c1', 'c2']);
  });

  it('applies batch operations in order (delete then re-create a world)', async () => {
    const store = await adapter.open();
    await store.write((b) => {
      b.putWorld(meta('w', 1));
      b.putSlot({ worldId: 'w', slot: 'old', savedAt: 1, hash: HASH, snapshot: 1 });
    });
    await store.write((b) => {
      b.deleteWorld('w');
      b.putWorld(meta('w', 2));
      b.putSlot({ worldId: 'w', slot: 'new', savedAt: 2, hash: HASH, snapshot: 2 });
    });
    expect(await store.listSlots('w')).toEqual(['new']);
    expect((await store.getWorld('w'))?.savedAt).toBe(2);
  });

  it('is atomic: an invalid operation discards the whole batch', async () => {
    const store = await adapter.open();
    await store.write((b) => b.putWorld(meta('w', 1)));
    await expect(
      store.write((b) => {
        b.putWorld(meta('w', 9));
        b.putSlot({ worldId: 'w', slot: 'main', savedAt: 1, hash: 'not-a-hash', snapshot: 1 });
      }),
    ).rejects.toThrow(SaveStoreError);
    expect((await store.getWorld('w'))?.savedAt).toBe(1);
    await expect(
      store.write((b) => {
        b.putWorld(meta('w', 9));
        b.putChunk({ worldId: 'w', key: 'k', data: { f: () => 1 } });
      }),
    ).rejects.toThrow();
    expect((await store.getWorld('w'))?.savedAt).toBe(1);
    expect(await store.listChunkKeys('w')).toEqual([]);
    await expect(store.write((b) => b.putWorld({ ...meta('x', 1), day: 0 }))).rejects.toThrow(/World meta invalid: day/);
    await store.write(() => undefined);
  });

  it('fails after close', async () => {
    const store = await adapter.open();
    store.close();
    await expect(store.listWorlds()).rejects.toThrow(SaveStoreError);
    await expect(store.write((b) => b.putWorld(meta('w', 1)))).rejects.toThrow(SaveStoreError);
  });
});

describe('IndexedDB adapter', () => {
  it('persists across connections and reports its schema version', async () => {
    const factory = new IDBFactory();
    const a = await openSaveDb(factory);
    expect(a.version).toBe(SAVE_DB_VERSION);
    expect(a.name).toBe(SAVE_DB_NAME);
    await a.write((b) => b.putWorld(meta('persisted', 3)));
    a.close();
    const b = await openSaveDb(factory);
    expect((await b.getWorld('persisted'))?.savedAt).toBe(3);
    b.close();
    await deleteSaveDb(factory);
    const c = await openSaveDb(factory);
    expect(await c.listWorlds()).toEqual([]);
    c.close();
  });

  it('detects corrupt records written by someone else', async () => {
    const factory = new IDBFactory();
    const store = await openSaveDb(factory, 'corrupt-test');
    store.close();
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('corrupt-test');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('worlds', 'readwrite');
        tx.objectStore('worlds').put({ id: 'bad', name: 3 });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error('write failed'));
      };
      req.onerror = () => reject(req.error ?? new Error('open failed'));
    });
    const again = await openSaveDb(factory, 'corrupt-test');
    await expect(again.getWorld('bad')).rejects.toThrow(/Stored world "bad" is corrupt/);
    await expect(again.listWorlds()).rejects.toThrow(SaveStoreError);
    again.close();
  });

  it('refuses a database created by a newer schema version', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('future', SAVE_DB_VERSION + 1);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error('open failed'));
    });
    await expect(openSaveDb(factory, 'future')).rejects.toThrow(/Cannot open save database "future"/);
  });

  it('closes itself when another connection upgrades the schema', async () => {
    const factory = new IDBFactory();
    const store = await openSaveDb(factory, 'upgrade');
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('upgrade', SAVE_DB_VERSION + 1);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error('open failed'));
    });
    await expect(store.listWorlds()).rejects.toThrow(/closed/);
  });
});
