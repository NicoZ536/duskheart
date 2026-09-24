/**
 * World meta (MASTERPROMPT §28 "IndexedDB: Weltmeta (Seed, Einstellungen, Version, Spielzeit,
 * Tag)", M2-27).
 *
 * A chunk world stores two records, always in the same transaction:
 * - `WorldMeta` in the `worlds` store (menu listing, `store.ts`): id, name, seed, settings
 *   (`config`), snapshot format, play time [ticks], day, timestamps;
 * - the world record (blob `world`): what rebuilding the chunk world needs beyond that – the game
 *   version that wrote it, the generator version, the chunk diff format and the runtime id tables
 *   the chunk records are written in (docs/WORLD.md §4: saves store the id tables and are remapped
 *   on load, so content added later never breaks old saves).
 * Worlds saved before chunk worlds existed have no world record; they have no chunk records either.
 */
import { z } from 'zod';
import type { SimConfig } from '../game/sim';
import { createChunkIdRemap, RuntimeIdError, serializeWorldIdTables, worldIdTablesSnapshotSchema, type ChunkIdRemap, type WorldIdTables } from '../world/model/runtimeIds';
import { CHUNK_DIFF_FORMAT } from '../world/stream/diff';
import { SAVE_SNAPSHOT_FORMAT, SaveError } from './registry';
import { parseStored, worldMetaSchema, type SaveStore, type SaveWriteBatch, type WorldMeta } from './store';

/** Blob name of the world record. */
export const WORLD_RECORD_BLOB = 'world';
/** Format version of the world record. */
export const WORLD_RECORD_FORMAT = 1;

/** zod schema of the world record. */
export const worldRecordSchema = z
  .object({
    format: z.literal(WORLD_RECORD_FORMAT),
    /** Build that wrote the save (`package.json` version). */
    gameVersion: z.string().min(1),
    /** Version of the world generator the diffs were taken against. */
    generatorVersion: z.number().int().min(1),
    /** `ChunkDiff` format of the chunk records. */
    chunkFormat: z.number().int().min(1),
    /** Runtime id tables the chunk records use. */
    ids: worldIdTablesSnapshotSchema,
  })
  .strict();

/** The world record (blob `world`). */
export type WorldRecord = z.output<typeof worldRecordSchema>;

/** World meta of a chunk world: menu listing plus world record. */
export interface ChunkWorldMeta {
  readonly meta: WorldMeta;
  readonly record: WorldRecord;
}

/** What the caller knows when saving. Wall-clock time and versions are passed in, never read here. */
export interface WorldMetaInput {
  readonly worldId: string;
  /** World name shown in the menu. */
  readonly name: string;
  /** Settings of the world (seed, size, day length). */
  readonly config: SimConfig;
  /** Play time [ticks]. */
  readonly tick: number;
  /** Current day (from 1). */
  readonly day: number;
  /** Wall-clock time of the save [epoch ms]. */
  readonly now: number;
  /** Build version (`__DH_VERSION__`). */
  readonly gameVersion: string;
  /** Version of the world generator. */
  readonly generatorVersion: number;
  /** Runtime id tables the chunks are written in. */
  readonly tables: WorldIdTables;
}

function describe(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.map(String).join('.') || '(record)'}: ${i.message}`).join('; ');
}

/** Builds both records; `previous` keeps the creation time of an existing world. Throws `SaveError` on invalid input. */
export function createWorldMeta(input: WorldMetaInput, previous?: WorldMeta): ChunkWorldMeta {
  const meta = worldMetaSchema.safeParse({
    id: input.worldId,
    name: input.name,
    seed: input.config.seed,
    config: { ...input.config },
    saveFormat: SAVE_SNAPSHOT_FORMAT,
    tick: input.tick,
    day: input.day,
    createdAt: previous?.createdAt ?? input.now,
    savedAt: input.now,
  });
  if (!meta.success) throw new SaveError(`World meta invalid: ${describe(meta.error)}`);
  const record = worldRecordSchema.safeParse({
    format: WORLD_RECORD_FORMAT,
    gameVersion: input.gameVersion,
    generatorVersion: input.generatorVersion,
    chunkFormat: CHUNK_DIFF_FORMAT,
    ids: serializeWorldIdTables(input.tables),
  });
  if (!record.success) throw new SaveError(`World record invalid: ${describe(record.error)}`);
  return { meta: meta.data, record: record.data };
}

/** Adds both records to a write batch. */
export function writeWorldMeta(batch: SaveWriteBatch, world: ChunkWorldMeta): void {
  batch.putWorld(world.meta);
  batch.putBlob({ worldId: world.meta.id, name: WORLD_RECORD_BLOB, data: world.record });
}

/** Reads the world meta and its world record (`undefined` for worlds saved before chunk worlds). Throws `SaveError` if the world is missing or a record is corrupt. */
export async function readWorldMeta(store: SaveStore, worldId: string): Promise<{ readonly meta: WorldMeta; readonly record: WorldRecord | undefined }> {
  const meta = await store.getWorld(worldId);
  if (meta === undefined) throw new SaveError(`World "${worldId}" does not exist`);
  const blob = await store.getBlob(worldId, WORLD_RECORD_BLOB);
  if (blob === undefined) return { meta, record: undefined };
  try {
    return { meta, record: parseStored(worldRecordSchema, blob.data, `world record of "${worldId}"`) };
  } catch (err) {
    throw new SaveError((err as Error).message);
  }
}

/** How a saved world relates to the running build. */
export interface WorldCompatibility {
  /** Remapping of the chunk records' runtime ids onto the current tables. */
  readonly remap: ChunkIdRemap;
  /** The world was generated by another generator version (changed tiles keep their saved values). */
  readonly generatorChanged: boolean;
}

/**
 * Checks a world record against the running build: chunk format supported, every saved content id
 * still known. Throws `SaveError` otherwise (a save from a newer build, or content removed).
 */
export function checkWorldRecord(record: WorldRecord, current: { readonly tables: WorldIdTables; readonly generatorVersion: number }): WorldCompatibility {
  if (record.chunkFormat > CHUNK_DIFF_FORMAT) throw new SaveError(`World record: chunk format ${record.chunkFormat} is newer than supported format ${CHUNK_DIFF_FORMAT}`);
  let remap: ChunkIdRemap;
  try {
    remap = createChunkIdRemap(record.ids, current.tables);
  } catch (err) {
    if (err instanceof RuntimeIdError) throw new SaveError(err.message);
    throw err;
  }
  return { remap, generatorChanged: record.generatorVersion !== current.generatorVersion };
}
