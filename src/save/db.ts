/**
 * IndexedDB adapter of `SaveStore` (MASTERPROMPT §3.1 "IndexedDB für Spielstände", §28).
 *
 * The `IDBFactory` is injected (browser: `window.indexedDB`; tests: `new IDBFactory()` from
 * fake-indexeddb), so this module touches no globals. The database schema is versioned: each
 * entry of `DB_UPGRADES` brings the database from version n to n + 1 inside `onupgradeneeded`.
 * `write()` runs all operations of a batch in one readwrite transaction over every store, strictly
 * in order (each operation is issued after the previous one's requests), and resolves only after
 * the transaction committed; any failure aborts and rolls back the whole batch.
 */
import {
  SAVE_STORES,
  SaveStoreError,
  blobRecordSchema,
  chunkRecordSchema,
  collectOps,
  compareWorlds,
  parseStored,
  slotRecordSchema,
  worldMetaSchema,
  type BlobRecord,
  type ChunkRecord,
  type SaveOp,
  type SaveStore,
  type SaveStoreName,
  type SaveWriteBatch,
  type SlotRecord,
  type WorldMeta,
} from './store';

/** Default database name. */
export const SAVE_DB_NAME = 'duskhearth';
/** Name of the per-world index on `slots`, `chunks` and `blobs`. */
const BY_WORLD = 'byWorld';
/** Stores holding per-world data (cleared when a world is deleted). */
const WORLD_DATA_STORES = ['slots', 'chunks', 'blobs'] as const satisfies readonly SaveStoreName[];

/** Schema upgrades; entry n upgrades from version n to n + 1. */
const DB_UPGRADES: ReadonlyArray<(db: IDBDatabase) => void> = [
  (db) => {
    db.createObjectStore('worlds', { keyPath: 'id' });
    db.createObjectStore('slots', { keyPath: ['worldId', 'slot'] }).createIndex(BY_WORLD, 'worldId');
    db.createObjectStore('chunks', { keyPath: ['worldId', 'key'] }).createIndex(BY_WORLD, 'worldId');
    db.createObjectStore('blobs', { keyPath: ['worldId', 'name'] }).createIndex(BY_WORLD, 'worldId');
  },
];

/** Current database schema version. */
export const SAVE_DB_VERSION = DB_UPGRADES.length;

function errorText(error: DOMException | null | undefined): string {
  return error === null || error === undefined ? 'unknown error' : `${error.name}: ${error.message}`;
}

/** Second component of a compound primary key `[worldId, name]`. */
function secondKey(key: IDBValidKey): string {
  if (!Array.isArray(key) || typeof key[1] !== 'string') throw new SaveStoreError(`Unexpected key ${String(key)} in save database`);
  return key[1];
}

/** Opens (and creates or upgrades) the save database. */
export function openSaveDb(factory: IDBFactory, name: string = SAVE_DB_NAME): Promise<IdbSaveStore> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name, SAVE_DB_VERSION);
    } catch (err) {
      reject(new SaveStoreError(`Cannot open save database "${name}": ${(err as Error).message}`));
      return;
    }
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      for (let v = ev.oldVersion; v < SAVE_DB_VERSION; v++) (DB_UPGRADES[v] as (db: IDBDatabase) => void)(db);
    };
    req.onsuccess = () => resolve(new IdbSaveStore(req.result, name));
    req.onerror = () => reject(new SaveStoreError(`Cannot open save database "${name}": ${errorText(req.error)}`));
  });
}

/** Deletes the whole save database (all worlds). */
export function deleteSaveDb(factory: IDBFactory, name: string = SAVE_DB_NAME): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = factory.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(new SaveStoreError(`Cannot delete save database "${name}": ${errorText(req.error)}`));
  });
}

/** `SaveStore` on an open IndexedDB connection. */
export class IdbSaveStore implements SaveStore {
  private closed = false;

  constructor(
    private readonly db: IDBDatabase,
    readonly name: string,
  ) {
    // Another tab upgrades the schema: release the connection so the upgrade can proceed.
    db.onversionchange = () => this.close();
  }

  /** Schema version of the open database. */
  get version(): number {
    return this.db.version;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  async listWorlds(): Promise<WorldMeta[]> {
    const raw = await this.read('worlds', (s) => s.getAll());
    return raw.map((r, i) => parseStored(worldMetaSchema, r, `world #${i}`)).sort(compareWorlds);
  }

  async getWorld(worldId: string): Promise<WorldMeta | undefined> {
    const raw: unknown = await this.read('worlds', (s) => s.get(worldId));
    return raw === undefined ? undefined : parseStored(worldMetaSchema, raw, `world "${worldId}"`);
  }

  deleteWorld(worldId: string): Promise<void> {
    return this.write((b) => b.deleteWorld(worldId));
  }

  async getSlot(worldId: string, slot: string): Promise<SlotRecord | undefined> {
    const raw: unknown = await this.read('slots', (s) => s.get([worldId, slot]));
    return raw === undefined ? undefined : parseStored(slotRecordSchema, raw, `slot "${worldId}/${slot}"`);
  }

  async listSlots(worldId: string): Promise<string[]> {
    return (await this.read('slots', (s) => s.index(BY_WORLD).getAllKeys(worldId))).map(secondKey).sort();
  }

  async getChunk(worldId: string, key: string): Promise<ChunkRecord | undefined> {
    const raw: unknown = await this.read('chunks', (s) => s.get([worldId, key]));
    return raw === undefined ? undefined : parseStored(chunkRecordSchema, raw, `chunk "${worldId}/${key}"`);
  }

  async listChunkKeys(worldId: string): Promise<string[]> {
    return (await this.read('chunks', (s) => s.index(BY_WORLD).getAllKeys(worldId))).map(secondKey).sort();
  }

  async getBlob(worldId: string, name: string): Promise<BlobRecord | undefined> {
    const raw: unknown = await this.read('blobs', (s) => s.get([worldId, name]));
    return raw === undefined ? undefined : parseStored(blobRecordSchema, raw, `blob "${worldId}/${name}"`);
  }

  async listBlobNames(worldId: string): Promise<string[]> {
    return (await this.read('blobs', (s) => s.index(BY_WORLD).getAllKeys(worldId))).map(secondKey).sort();
  }

  write(build: (batch: SaveWriteBatch) => void): Promise<void> {
    let ops: SaveOp[];
    try {
      this.assertOpen();
      ops = collectOps(build);
    } catch (err) {
      return Promise.reject(err as Error);
    }
    if (ops.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = this.db.transaction(SAVE_STORES, 'readwrite');
      } catch (err) {
        reject(new SaveStoreError(`Save transaction could not start: ${(err as Error).message}`));
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new SaveStoreError(`Save transaction aborted: ${errorText(tx.error)}`));
      const run = (i: number): void => {
        const op = ops[i];
        if (op === undefined) return; // No further requests: the transaction commits.
        const next = (): void => run(i + 1);
        try {
          this.issue(tx, op, next);
        } catch (err) {
          tx.abort();
          reject(new SaveStoreError(`Save operation ${op.op} failed: ${(err as Error).message}`));
        }
      };
      run(0);
    });
  }

  /** Issues the requests of one operation; calls `done` once they succeeded. */
  private issue(tx: IDBTransaction, op: SaveOp, done: () => void): void {
    const after = (req: IDBRequest): void => {
      req.onsuccess = () => done();
    };
    switch (op.op) {
      case 'putWorld':
        return after(tx.objectStore('worlds').put(op.meta));
      case 'putSlot':
        return after(tx.objectStore('slots').put(op.record));
      case 'putChunk':
        return after(tx.objectStore('chunks').put(op.record));
      case 'putBlob':
        return after(tx.objectStore('blobs').put(op.record));
      case 'deleteSlot':
        return after(tx.objectStore('slots').delete([op.worldId, op.slot]));
      case 'deleteChunk':
        return after(tx.objectStore('chunks').delete([op.worldId, op.key]));
      case 'deleteBlob':
        return after(tx.objectStore('blobs').delete([op.worldId, op.name]));
      case 'deleteWorld': {
        tx.objectStore('worlds').delete(op.worldId);
        // Clear the per-world stores one after another; deletes are issued before the next step.
        const clear = (s: number): void => {
          const storeName = WORLD_DATA_STORES[s];
          if (storeName === undefined) {
            done();
            return;
          }
          const store = tx.objectStore(storeName);
          const keysReq = store.index(BY_WORLD).getAllKeys(op.worldId);
          keysReq.onsuccess = () => {
            for (const k of keysReq.result) store.delete(k);
            clear(s + 1);
          };
        };
        clear(0);
        return;
      }
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new SaveStoreError(`Save database "${this.name}" is closed`);
  }

  private read<T>(storeName: SaveStoreName, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      try {
        this.assertOpen();
        const tx = this.db.transaction(storeName, 'readonly');
        const req = request(tx.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new SaveStoreError(`Reading ${storeName} failed: ${errorText(req.error)}`));
      } catch (err) {
        reject(err instanceof SaveStoreError ? err : new SaveStoreError(`Reading ${storeName} failed: ${(err as Error).message}`));
      }
    });
  }
}
