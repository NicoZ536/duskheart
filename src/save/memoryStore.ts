/**
 * In-memory adapter of `SaveStore` for Node (tests, headless balancing). Same semantics as the
 * IndexedDB adapter: values are structured-cloned on write and on read, and a batch is applied to
 * copies of the tables that replace the live tables only when every operation succeeded.
 */
import {
  SaveStoreError,
  collectOps,
  compareWorlds,
  type BlobRecord,
  type ChunkRecord,
  type SaveOp,
  type SaveStore,
  type SaveWriteBatch,
  type SlotRecord,
  type WorldMeta,
} from './store';

interface Tables {
  worlds: Map<string, WorldMeta>;
  /** Per world: name → record (slots, chunks, blobs). */
  slots: Map<string, Map<string, SlotRecord>>;
  chunks: Map<string, Map<string, ChunkRecord>>;
  blobs: Map<string, Map<string, BlobRecord>>;
}

function emptyTables(): Tables {
  return { worlds: new Map(), slots: new Map(), chunks: new Map(), blobs: new Map() };
}

function copyNested<V>(m: Map<string, Map<string, V>>): Map<string, Map<string, V>> {
  return new Map([...m].map(([k, inner]) => [k, new Map(inner)]));
}

function inner<V>(m: Map<string, Map<string, V>>, worldId: string): Map<string, V> {
  let t = m.get(worldId);
  if (t === undefined) {
    t = new Map();
    m.set(worldId, t);
  }
  return t;
}

function apply(t: Tables, op: SaveOp): void {
  switch (op.op) {
    case 'putWorld':
      t.worlds.set(op.meta.id, structuredClone(op.meta));
      return;
    case 'deleteWorld':
      t.worlds.delete(op.worldId);
      t.slots.delete(op.worldId);
      t.chunks.delete(op.worldId);
      t.blobs.delete(op.worldId);
      return;
    case 'putSlot':
      inner(t.slots, op.record.worldId).set(op.record.slot, structuredClone(op.record));
      return;
    case 'deleteSlot':
      t.slots.get(op.worldId)?.delete(op.slot);
      return;
    case 'putChunk':
      inner(t.chunks, op.record.worldId).set(op.record.key, structuredClone(op.record));
      return;
    case 'deleteChunk':
      t.chunks.get(op.worldId)?.delete(op.key);
      return;
    case 'putBlob':
      inner(t.blobs, op.record.worldId).set(op.record.name, structuredClone(op.record));
      return;
    case 'deleteBlob':
      t.blobs.get(op.worldId)?.delete(op.name);
      return;
  }
}

/** `SaveStore` kept in memory. */
export class MemorySaveStore implements SaveStore {
  private tables = emptyTables();
  private closed = false;

  async listWorlds(): Promise<WorldMeta[]> {
    this.assertOpen();
    return [...this.tables.worlds.values()].map((w) => structuredClone(w)).sort(compareWorlds);
  }

  async getWorld(worldId: string): Promise<WorldMeta | undefined> {
    this.assertOpen();
    const w = this.tables.worlds.get(worldId);
    return w === undefined ? undefined : structuredClone(w);
  }

  deleteWorld(worldId: string): Promise<void> {
    return this.write((b) => b.deleteWorld(worldId));
  }

  async getSlot(worldId: string, slot: string): Promise<SlotRecord | undefined> {
    this.assertOpen();
    const r = this.tables.slots.get(worldId)?.get(slot);
    return r === undefined ? undefined : structuredClone(r);
  }

  async listSlots(worldId: string): Promise<string[]> {
    this.assertOpen();
    return [...(this.tables.slots.get(worldId)?.keys() ?? [])].sort();
  }

  async getChunk(worldId: string, key: string): Promise<ChunkRecord | undefined> {
    this.assertOpen();
    const r = this.tables.chunks.get(worldId)?.get(key);
    return r === undefined ? undefined : structuredClone(r);
  }

  async listChunkKeys(worldId: string): Promise<string[]> {
    this.assertOpen();
    return [...(this.tables.chunks.get(worldId)?.keys() ?? [])].sort();
  }

  async getBlob(worldId: string, name: string): Promise<BlobRecord | undefined> {
    this.assertOpen();
    const r = this.tables.blobs.get(worldId)?.get(name);
    return r === undefined ? undefined : structuredClone(r);
  }

  async write(build: (batch: SaveWriteBatch) => void): Promise<void> {
    this.assertOpen();
    const ops = collectOps(build);
    if (ops.length === 0) return;
    const next: Tables = {
      worlds: new Map(this.tables.worlds),
      slots: copyNested(this.tables.slots),
      chunks: copyNested(this.tables.chunks),
      blobs: copyNested(this.tables.blobs),
    };
    for (const op of ops) {
      try {
        apply(next, op);
      } catch (err) {
        throw new SaveStoreError(`Save operation ${op.op} failed: ${(err as Error).message}`);
      }
    }
    this.tables = next;
  }

  close(): void {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new SaveStoreError('Memory save store is closed');
  }
}
