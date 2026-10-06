/**
 * Chunk saving (docs/WORLD.md §5, MASTERPROMPT §28, M2-27): changed chunks as diffs against the
 * generated state (typed arrays, run lengths, `ChunkDiff`) in the `chunks` store, keyed by
 * (world, chunk key). Unchanged chunks are never written; a chunk that returns to its generated
 * state has its record deleted.
 *
 * - `saveChunkWorld` writes world meta, world record and exactly the changed chunk records in one
 *   atomic transaction (`ChunkManager.collectChanges`), and marks them saved only after the
 *   commit – a failed save leaves the changes pending for the next attempt. Into a store that does not
 *   hold the world yet, or whose records use other runtime ids (content added since they were written),
 *   it writes every change against the generated world (`forgetStorage`).
 * - `loadChunkWorld` reads meta and record, checks the build compatibility, and returns every
 *   stored diff remapped to the current runtime ids; `ChunkManager.loadStored` takes them.
 * - Each record carries the hash of its diff; a record whose content does not match is corrupt.
 * - Since M7-57 the records belong to a slot (`main` when none is named – everything here works on `main` unless a caller
 *   names another); the game's save writer (src/save/writer.ts) writes packed records per slot, read here as well
 *   (src/save/chunkPack.ts).
 * The frozen ticks of chunks travel in the simulation snapshot (participant `world-chunks`).
 */
import { canonicalJson } from '../game/canonical';
import { chunkKey } from '../world/model/coords';
import { isIdentityRemap, type ChunkIdRemap, type WorldIdTables } from '../world/model/runtimeIds';
import type { ChunkChangeSet } from '../world/stream/chunkManager';
import { chunkDiffHash, parseChunkDiff, remapChunkDiff, type ChunkDiff } from '../world/stream/diff';
import { decodeStoredChunk } from './chunkPack';
import { SaveError } from './registry';
import { DEFAULT_CHUNK_SLOT, type SaveStore, type SaveWriteBatch, type WorldMeta } from './store';
import { checkWorldRecord, createWorldMeta, readWorldMeta, writeWorldMeta, type ChunkWorldMeta, type WorldMetaInput, type WorldRecord } from './worldMeta';

/** Format version of a stored chunk record. */
export const CHUNK_RECORD_FORMAT = 1;

/** What a chunk record stores (`ChunkRecord.data`). */
export interface ChunkRecordData {
  readonly format: number;
  /** `chunkDiffHash` of `diff` (integrity check). */
  readonly hash: string;
  readonly diff: ChunkDiff;
}

/** Record payload of a diff. */
export function encodeChunkRecord(diff: ChunkDiff): ChunkRecordData {
  return { format: CHUNK_RECORD_FORMAT, hash: chunkDiffHash(diff), diff };
}

/** Validates a stored record of chunk `key` and returns its diff. Throws `SaveError` if it is corrupt. */
export function decodeChunkRecord(key: string, data: unknown): ChunkDiff {
  const fail = (reason: string): never => {
    throw new SaveError(`Chunk record "${key}" is corrupt: ${reason}`);
  };
  if (typeof data !== 'object' || data === null) fail('not an object');
  const r = data as Partial<Record<keyof ChunkRecordData, unknown>>;
  if (r.format !== CHUNK_RECORD_FORMAT) fail(`unsupported record format ${String(r.format)}`);
  let diff: ChunkDiff;
  try {
    diff = parseChunkDiff(r.diff);
  } catch (err) {
    return fail((err as Error).message);
  }
  if (chunkKey(diff.layer, diff.cx, diff.cy) !== key) fail(`holds chunk ${chunkKey(diff.layer, diff.cx, diff.cy)}`);
  const actual = chunkDiffHash(diff);
  if (actual !== r.hash) fail(`hash ${actual} ≠ stored ${String(r.hash)}`);
  return diff;
}

/** Keys written and deleted by one save, sorted. */
export interface ChunkWriteReport {
  readonly written: readonly string[];
  readonly deleted: readonly string[];
}

/** Adds the chunk records of a change set to a write batch of `slot` (default `main`): puts for diffs, deletes for reverted chunks. */
export function writeChunkChanges(batch: SaveWriteBatch, worldId: string, set: ChunkChangeSet, slot: string = DEFAULT_CHUNK_SLOT): ChunkWriteReport {
  const written: string[] = [];
  const deleted: string[] = [];
  for (const change of set.writes) {
    if (change.diff !== null) {
      batch.putChunk({ worldId, slot, key: change.key, data: encodeChunkRecord(change.diff) });
      written.push(change.key);
    } else {
      batch.deleteChunk(worldId, change.key, slot);
      deleted.push(change.key);
    }
  }
  return { written, deleted };
}

/**
 * Reads every chunk record of a world's `slot` (default `main`) – plain or packed –, validated and remapped to the current
 * runtime ids (`remap` from `checkWorldRecord`; `null` = ids unchanged). Throws `SaveError` on a corrupt record.
 */
export async function readChunkDiffs(store: SaveStore, worldId: string, remap: ChunkIdRemap | null, slot: string = DEFAULT_CHUNK_SLOT): Promise<ChunkDiff[]> {
  const keys = await store.listChunkKeys(worldId, slot);
  const records = await Promise.all(keys.map((key) => store.getChunk(worldId, key, slot)));
  const convert = remap !== null && !isIdentityRemap(remap);
  return Promise.all(
    keys.map(async (key, i) => {
      const record = records[i];
      if (record === undefined) throw new SaveError(`Chunk record "${key}" vanished while loading world "${worldId}"`);
      const diff = await decodeStoredChunk(key, record.data);
      return convert ? remapChunkDiff(diff, remap) : diff;
    }),
  );
}

/** The part of a `ChunkManager` that saving needs. */
export interface ChunkChangeSource {
  collectChanges(): ChunkChangeSet;
  markSaved(set: ChunkChangeSet): void;
  /** The target store holds nothing of this world: the next change set lists every change (`ChunkManager.forgetStorage`). */
  forgetStorage(): void;
}

/** Options of `saveChunkWorld`: world meta input plus the manager holding the chunks. */
export interface SaveChunkWorldOptions extends WorldMetaInput {
  readonly chunks: ChunkChangeSource;
  /** Further writes of the same transaction (e.g. the simulation snapshot slot, which names the world record it is written with). */
  readonly extra?: (batch: SaveWriteBatch, world: ChunkWorldMeta) => void;
}

/** What `saveChunkWorld` wrote. */
export interface ChunkWorldSaveReport extends ChunkWriteReport {
  readonly world: ChunkWorldMeta;
}

/**
 * Whether the stored world record of `worldId` names the same runtime id tables as `record`. A world saved before
 * chunk worlds has no record (nothing to renumber); an unreadable record counts as different, so everything is
 * written anew.
 */
async function sameIdTables(store: SaveStore, worldId: string, record: WorldRecord): Promise<boolean> {
  try {
    const stored = (await readWorldMeta(store, worldId)).record;
    return stored === undefined || canonicalJson(stored.ids) === canonicalJson(record.ids);
  } catch (err) {
    if (err instanceof SaveError) return false;
    throw err;
  }
}

/**
 * Saves a chunk world between two ticks: world meta, world record, changed chunk records and
 * `extra` in one transaction. Only chunks whose content differs from storage are written.
 */
export async function saveChunkWorld(store: SaveStore, options: SaveChunkWorldOptions): Promise<ChunkWorldSaveReport> {
  const previous: WorldMeta | undefined = await store.getWorld(options.worldId);
  const world = createWorldMeta(options, previous);
  // A world new to this store (first save, another id, a deleted world): write every change, not only the unsaved ones.
  // The same for records written in other runtime ids (content added since, e.g. a new terrain type, M4-36): the new
  // world record names the current tables, so the untouched records would otherwise be read in the wrong numbering.
  if (previous === undefined || !(await sameIdTables(store, options.worldId, world.record))) options.chunks.forgetStorage();
  const set = options.chunks.collectChanges();
  let report: ChunkWriteReport = { written: [], deleted: [] };
  await store.write((batch) => {
    writeWorldMeta(batch, world);
    report = writeChunkChanges(batch, options.worldId, set);
    options.extra?.(batch, world);
  });
  options.chunks.markSaved(set);
  return { world, ...report };
}

/** A loaded chunk world: meta, record and the diffs for `ChunkManager.loadStored`. */
export interface LoadedChunkWorld {
  readonly meta: WorldMeta;
  readonly record: WorldRecord | undefined;
  /** Stored diffs, remapped to the current runtime ids. */
  readonly diffs: readonly ChunkDiff[];
  /** The world was generated by another generator version. */
  readonly generatorChanged: boolean;
}

/** Which chunk records `loadChunkWorld` reads: a slot (default `main`) and the world record its records are written in. */
export interface ChunkSlotSource {
  readonly slot?: string;
  /** The slot's own world record (`SlotRecord.world`, M7-57); absent = the world's blob `world` (saves before M7). */
  readonly record?: WorldRecord;
}

/**
 * Loads the chunk side of a world (`source.slot`, default `main`). Throws `SaveError` when the world is missing, a record
 * is corrupt, the save is from a newer build or uses content that no longer exists.
 */
export async function loadChunkWorld(
  store: SaveStore,
  worldId: string,
  current: { readonly tables: WorldIdTables; readonly generatorVersion: number },
  source: ChunkSlotSource = {},
): Promise<LoadedChunkWorld> {
  const slot = source.slot ?? DEFAULT_CHUNK_SLOT;
  const read = await readWorldMeta(store, worldId);
  const meta = read.meta;
  const record = source.record ?? read.record;
  if (record === undefined) {
    const keys = await store.listChunkKeys(worldId, slot);
    if (keys.length > 0) throw new SaveError(`World "${worldId}" has ${keys.length} chunk records but no world record (runtime ids unknown)`);
    return { meta, record, diffs: [], generatorChanged: false };
  }
  const compatibility = checkWorldRecord(record, current);
  const diffs = await readChunkDiffs(store, worldId, compatibility.remap, slot);
  return { meta, record, diffs, generatorChanged: compatibility.generatorChanged };
}
