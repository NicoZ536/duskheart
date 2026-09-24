/**
 * Storage contract for saves (MASTERPROMPT §28). Implemented by the IndexedDB adapter
 * (`db.ts`, browser) and the in-memory adapter (`memoryStore.ts`, Node/tests) with identical
 * behaviour, including value copies on write/read (structured clone) and atomic batches.
 *
 * Stores:
 * - `worlds`: world meta (seed, config, save format, play time, day, timestamps), key `id`
 * - `slots`: full simulation snapshots per world (`main`, rotating autosaves …), key (world, slot)
 * - `chunks`: changed chunk data (typed array diffs), key (world, chunk key)
 * - `blobs`: further per-world data (map reveal bitmask, statistics …), key (world, name)
 */
import { z } from 'zod';
import { U32_MAX } from '../engine/rng';
import { simConfigSchema } from '../game/sim';

/** Names of the object stores. */
export const SAVE_STORES = ['worlds', 'slots', 'chunks', 'blobs'] as const;
export type SaveStoreName = (typeof SAVE_STORES)[number];

const key = z.string().min(1);
const epochMs = z.number().int().min(0);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** World meta (list of worlds in the menu, seed sharing). Timestamps are passed in by the caller. */
export const worldMetaSchema = z
  .object({
    id: key,
    /** Player-chosen world name. */
    name: z.string(),
    seed: z.number().int().min(0).max(U32_MAX),
    config: simConfigSchema,
    /** Format version of the stored snapshot envelope. */
    saveFormat: z.number().int().min(1),
    /** Simulation ticks played. */
    tick: count,
    /** Day number at the time of saving. */
    day: z.number().int().min(1),
    createdAt: epochMs,
    savedAt: epochMs,
  })
  .strict();
export type WorldMeta = z.output<typeof worldMetaSchema>;

/** One saved simulation snapshot. `hash` is `stableHash64(snapshot)` for integrity checks. */
export const slotRecordSchema = z
  .object({
    worldId: key,
    slot: key,
    savedAt: epochMs,
    hash: z.string().regex(/^[0-9a-f]{16}$/),
    snapshot: z.unknown(),
  })
  .strict();
export type SlotRecord = z.output<typeof slotRecordSchema>;

export const chunkRecordSchema = z.object({ worldId: key, key, data: z.unknown() }).strict();
export type ChunkRecord = z.output<typeof chunkRecordSchema>;

export const blobRecordSchema = z.object({ worldId: key, name: key, data: z.unknown() }).strict();
export type BlobRecord = z.output<typeof blobRecordSchema>;

/** Write operations of one atomic batch (applied in order). */
export type SaveOp =
  | { readonly op: 'putWorld'; readonly meta: WorldMeta }
  | { readonly op: 'deleteWorld'; readonly worldId: string }
  | { readonly op: 'putSlot'; readonly record: SlotRecord }
  | { readonly op: 'deleteSlot'; readonly worldId: string; readonly slot: string }
  | { readonly op: 'putChunk'; readonly record: ChunkRecord }
  | { readonly op: 'deleteChunk'; readonly worldId: string; readonly key: string }
  | { readonly op: 'putBlob'; readonly record: BlobRecord }
  | { readonly op: 'deleteBlob'; readonly worldId: string; readonly name: string };

/** Collects the writes of one transaction. `deleteWorld` removes the meta and all its data. */
export interface SaveWriteBatch {
  putWorld(meta: WorldMeta): void;
  deleteWorld(worldId: string): void;
  putSlot(record: SlotRecord): void;
  deleteSlot(worldId: string, slot: string): void;
  putChunk(record: ChunkRecord): void;
  deleteChunk(worldId: string, key: string): void;
  putBlob(record: BlobRecord): void;
  deleteBlob(worldId: string, name: string): void;
}

/** Persistent save storage. All reads return copies; `write` is all-or-nothing. */
export interface SaveStore {
  /** All worlds, most recently saved first (ties by id). */
  listWorlds(): Promise<WorldMeta[]>;
  getWorld(worldId: string): Promise<WorldMeta | undefined>;
  /** Removes a world with all slots, chunks and blobs (atomic). */
  deleteWorld(worldId: string): Promise<void>;
  getSlot(worldId: string, slot: string): Promise<SlotRecord | undefined>;
  /** Slot names of a world, sorted. */
  listSlots(worldId: string): Promise<string[]>;
  getChunk(worldId: string, key: string): Promise<ChunkRecord | undefined>;
  /** Chunk keys of a world, sorted. */
  listChunkKeys(worldId: string): Promise<string[]>;
  getBlob(worldId: string, name: string): Promise<BlobRecord | undefined>;
  /** Blob names of a world, sorted (export of a whole world, src/save/dump.ts). */
  listBlobNames(worldId: string): Promise<string[]>;
  /** Runs `build` to collect writes and commits them in one atomic transaction. */
  write(build: (batch: SaveWriteBatch) => void): Promise<void>;
  /** Releases the storage; later calls fail. */
  close(): void;
}

/** Error of the storage layer (corrupt record, closed store, failed transaction). */
export class SaveStoreError extends Error {
  override readonly name = 'SaveStoreError';
}

/** Collects `build`'s writes into a validated op list (shared by both adapters). */
export function collectOps(build: (batch: SaveWriteBatch) => void): SaveOp[] {
  const ops: SaveOp[] = [];
  const check = <T>(schema: z.ZodType<T>, value: unknown, what: string): T => {
    const r = schema.safeParse(value);
    if (!r.success) throw new SaveStoreError(`${what} invalid: ${r.error.issues.map((i) => `${i.path.map(String).join('.') || '(record)'}: ${i.message}`).join('; ')}`);
    return r.data;
  };
  const id = (value: string, what: string): string => check(key, value, what);
  build({
    putWorld: (meta) => ops.push({ op: 'putWorld', meta: check(worldMetaSchema, meta, 'World meta') }),
    deleteWorld: (worldId) => ops.push({ op: 'deleteWorld', worldId: id(worldId, 'World id') }),
    putSlot: (record) => ops.push({ op: 'putSlot', record: check(slotRecordSchema, record, 'Slot record') }),
    deleteSlot: (worldId, slot) => ops.push({ op: 'deleteSlot', worldId: id(worldId, 'World id'), slot: id(slot, 'Slot name') }),
    putChunk: (record) => ops.push({ op: 'putChunk', record: check(chunkRecordSchema, record, 'Chunk record') }),
    deleteChunk: (worldId, k) => ops.push({ op: 'deleteChunk', worldId: id(worldId, 'World id'), key: id(k, 'Chunk key') }),
    putBlob: (record) => ops.push({ op: 'putBlob', record: check(blobRecordSchema, record, 'Blob record') }),
    deleteBlob: (worldId, name) => ops.push({ op: 'deleteBlob', worldId: id(worldId, 'World id'), name: id(name, 'Blob name') }),
  });
  return ops;
}

/** Validates a record read from storage; corrupt data raises `SaveStoreError` naming the record. */
export function parseStored<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new SaveStoreError(`Stored ${what} is corrupt: ${r.error.issues.map((i) => `${i.path.map(String).join('.') || '(record)'}: ${i.message}`).join('; ')}`);
  return r.data;
}

/** Sort order of `listWorlds`: newest save first, then by id. */
export function compareWorlds(a: WorldMeta, b: WorldMeta): number {
  if (a.savedAt !== b.savedAt) return b.savedAt - a.savedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
