/**
 * The game's save writer (MASTERPROMPT §28 "Autosave … inkrementell, nur geänderte Chunks, im Worker … atomar per
 * Transaktion; die letzten 3 Autosaves rotierend"; docs/SPIEL.md §25 "Speicherslots"; M7-57). It runs in the save worker
 * (src/save/save.worker.ts) – or, where no module worker starts (Node, tests), in this thread with the same code
 * (`createSaveWorkerHandlers`).
 *
 * The main thread does only what needs the simulation, between two ticks (src/save/autosave.ts): it serializes the
 * participants and collects the chunk changes since the last save of any slot (`ChunkManager.collectChanges`, marked saved at
 * once – the writer holds them from then on). Everything else happens here: the snapshot's integrity hash, the per-slot
 * bookkeeping, packing and gzipping the chunk diffs (src/save/chunkPack.ts) and one IndexedDB transaction with world meta,
 * world record, slot record and the slot's chunk records.
 *
 * Chunk records per slot (ADR-0020, M7-57: rotating autosaves share no chunk store): the writer keeps the current diff of
 * every changed chunk (`current`: what the world holds now) and, per slot, the hash of every chunk record that slot holds
 * (`mirrors`, read from the store when the session begins). Writing slot S puts exactly the chunks whose current hash S does
 * not hold and deletes S's records of chunks back at their generated state – an autosave written three saves ago gets the
 * chunks changed since. A slot whose records were written in other runtime ids differs in their hashes and is rewritten
 * the same way. A failed write leaves `current` intact and the slot's mirror untouched, so the next write repeats it.
 */
import { stableHash64 } from '../game/canonical';
import type { SimConfig } from '../game/sim';
import { CHUNK_DIFF_FORMAT, chunkDiffHash, type ChunkDiff } from '../world/stream/diff';
import type { WorldIdTablesSnapshot } from '../world/model/runtimeIds';
import { encodePackedChunkRecord, storedChunkHash } from './chunkPack';
import { SaveError, SAVE_SNAPSHOT_FORMAT, type SaveSnapshot } from './registry';
import type { SaveStore, WorldMeta } from './store';
import { WORLD_RECORD_BLOB, WORLD_RECORD_FORMAT, type WorldRecord } from './worldMeta';

/** One chunk change since the last save of any slot (`ChunkChange` of the chunk manager). */
export interface SaveChunkChange {
  readonly key: string;
  /** The chunk's diff, or null: back at its generated state. */
  readonly diff: ChunkDiff | null;
}

/** What the session hands the writer when it starts (a new world, or a slot it loaded). */
export interface SaveBeginRequest {
  readonly worldId: string;
  /** Diffs of every changed chunk the session starts with (a loaded slot's, remapped to the current ids; none for a new world). */
  readonly diffs: readonly ChunkDiff[];
}

/** One save. */
export interface SaveWriteRequest {
  readonly worldId: string;
  /** World name in the menu. */
  readonly name: string;
  readonly slot: string;
  /** Wall-clock time of the save [epoch ms] (the caller's clock). */
  readonly now: number;
  readonly gameVersion: string;
  readonly generatorVersion: number;
  readonly config: SimConfig;
  readonly tick: number;
  readonly day: number;
  /** Runtime id tables the chunk diffs are numbered in (`serializeWorldIdTables`). */
  readonly ids: WorldIdTablesSnapshot;
  readonly snapshot: SaveSnapshot;
  /** Chunk changes since the last request (the writer applies them to `current` first). */
  readonly changes: readonly SaveChunkChange[];
}

/** What a save wrote. */
export interface SaveWriteResult {
  readonly worldId: string;
  readonly slot: string;
  readonly savedAt: number;
  /** Integrity hash of the snapshot. */
  readonly hash: string;
  /** Chunk records put and deleted in the slot. */
  readonly written: number;
  readonly deleted: number;
  /** Compressed bytes of the chunk records put. */
  readonly bytes: number;
  readonly meta: WorldMeta;
}

/** The writer's RPC API (the save worker serves it; `createSaveWorkerHandlers` builds it). */
export interface SaveWorkerApi {
  begin(request: SaveBeginRequest): Promise<number>;
  write(request: SaveWriteRequest): Promise<SaveWriteResult>;
}

interface Held {
  readonly diff: ChunkDiff;
  readonly hash: string;
}

/** Writes saves of one session into a store (see the module comment). */
export class SaveWriter {
  private worldId: string | null = null;
  private readonly current = new Map<string, Held>();
  /** Per slot: chunk key → hash of the record the slot holds; absent slot = not read yet. */
  private readonly mirrors = new Map<string, Map<string, string>>();
  /** Requests run one after another in the order they came (two saves never interleave their reads and writes). */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly withStore: StoreAccess) {}

  /** Starts the session of `worldId` with the diffs it holds (after every write before it); resolves to how many chunks are changed. */
  begin(request: SaveBeginRequest): Promise<number> {
    return this.enqueue(async () => this.start(request));
  }

  private start(request: SaveBeginRequest): number {
    this.worldId = request.worldId;
    this.current.clear();
    this.mirrors.clear();
    for (const d of request.diffs) this.current.set(`${d.layer}:${d.cx}:${d.cy}`, { diff: d, hash: chunkDiffHash(d) });
    return this.current.size;
  }

  /** Writes one save after every request before it (see the module comment). Throws `SaveError` (nothing written, the next save repeats it). */
  write(request: SaveWriteRequest): Promise<SaveWriteResult> {
    return this.enqueue(() => this.writeNow(request));
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private writeNow(request: SaveWriteRequest): Promise<SaveWriteResult> {
    if (this.worldId !== request.worldId) {
      // A writer that did not begin this world (a new world's first save): its changes are all there is.
      this.start({ worldId: request.worldId, diffs: [] });
    }
    for (const c of request.changes) {
      if (c.diff === null) this.current.delete(c.key);
      else this.current.set(c.key, { diff: c.diff, hash: chunkDiffHash(c.diff) });
    }
    return this.withStore((store) => this.writeInto(store, request));
  }

  private async writeInto(store: SaveStore, request: SaveWriteRequest): Promise<SaveWriteResult> {
    try {
      const previous = await store.getWorld(request.worldId);
      const mirror = await this.mirror(store, request.worldId, request.slot);
      const puts: Array<{ key: string; hash: string; data: unknown }> = [];
      let bytes = 0;
      for (const [key, held] of this.current) {
        if (mirror.get(key) === held.hash) continue;
        const data = await encodePackedChunkRecord(held.diff);
        bytes += data.bytes.byteLength;
        puts.push({ key, hash: held.hash, data });
      }
      const deletes = [...mirror.keys()].filter((key) => !this.current.has(key)).sort();
      puts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const hash = stableHash64(request.snapshot);
      const record: WorldRecord = {
        format: WORLD_RECORD_FORMAT,
        gameVersion: request.gameVersion,
        generatorVersion: request.generatorVersion,
        chunkFormat: CHUNK_DIFF_FORMAT,
        ids: { terrain: [...request.ids.terrain], biomes: [...request.ids.biomes], objects: [...request.ids.objects] },
      };
      const meta: WorldMeta = {
        id: request.worldId,
        name: request.name,
        seed: request.config.seed,
        config: { ...request.config },
        saveFormat: SAVE_SNAPSHOT_FORMAT,
        tick: request.tick,
        day: request.day,
        createdAt: previous?.createdAt ?? request.now,
        savedAt: request.now,
      };
      await store.write((b) => {
        b.putWorld(meta);
        b.putBlob({ worldId: request.worldId, name: WORLD_RECORD_BLOB, data: record });
        for (const p of puts) b.putChunk({ worldId: request.worldId, slot: request.slot, key: p.key, data: p.data });
        for (const key of deletes) b.deleteChunk(request.worldId, key, request.slot);
        b.putSlot({ worldId: request.worldId, slot: request.slot, savedAt: request.now, hash, snapshot: request.snapshot, world: record });
      });
      for (const p of puts) mirror.set(p.key, p.hash);
      for (const key of deletes) mirror.delete(key);
      return { worldId: request.worldId, slot: request.slot, savedAt: request.now, hash, written: puts.length, deleted: deletes.length, bytes, meta };
    } catch (err) {
      // The slot's records are unknown after a failed transaction: read them again next time.
      this.mirrors.delete(request.slot);
      throw err instanceof SaveError ? err : new SaveError(`Saving "${request.worldId}/${request.slot}" failed: ${(err as Error).message}`);
    }
  }

  /** The record hashes slot `slot` of world `worldId` holds (read once per session; records without a hash count as missing). */
  private async mirror(store: SaveStore, worldId: string, slot: string): Promise<Map<string, string>> {
    let m = this.mirrors.get(slot);
    if (m !== undefined) return m;
    m = new Map();
    for (const key of await store.listChunkKeys(worldId, slot)) {
      let hash: string | null = null;
      try {
        hash = storedChunkHash((await store.getChunk(worldId, key, slot))?.data);
      } catch {
        // A record that cannot be read is rewritten.
        hash = null;
      }
      m.set(key, hash ?? '');
    }
    this.mirrors.set(slot, m);
    return m;
  }
}

/** Runs `use` with a store (the browser opens IndexedDB per save and closes it after: the worker holds no connection open). */
export type StoreAccess = <T>(use: (store: SaveStore) => Promise<T>) => Promise<T>;

/** Store access that opens a store per use and closes it afterwards. */
export function openPerUse(open: () => Promise<SaveStore>): StoreAccess {
  return async (use) => {
    const store = await open();
    try {
      return await use(store);
    } finally {
      store.close();
    }
  };
}

/** Store access to one store that stays open (the in-memory store of tests and tools). */
export function sharedStore(store: SaveStore): StoreAccess {
  return (use) => use(store);
}

/** The handlers of the save worker over `access`. */
export function createSaveWorkerHandlers(access: StoreAccess): SaveWorkerApi {
  const writer = new SaveWriter(access);
  return {
    begin: (request) => writer.begin(request),
    write: (request) => writer.write(request),
  };
}
