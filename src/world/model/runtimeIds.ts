/**
 * Runtime ids of world content (docs/WORLD.md §4, M2-03).
 *
 * Chunk arrays store terrain types, biomes and world objects as small integers. The tables are built
 * from the content registry by sorting the string ids (code unit order, identical on every platform)
 * and numbering them from 1; 0 always means "none" (no ground, open tile, no biome, no object).
 * `ground` and `solid` share the terrain table.
 *
 * Saves store the three id lists (`serializeWorldIdTables`). On load `createChunkIdRemap` maps the
 * saved numbering onto the current one, so content added in later versions never breaks old saves;
 * content that no longer exists is reported as an error (it would silently change the world).
 */
import { z } from 'zod';
import { CONTENT } from '../../content/index';
import { CHUNK_AREA } from './coords';
import type { ChunkData } from './chunk';

/** Runtime id meaning "none". */
export const RUNTIME_ID_NONE = 0;
/** Largest runtime id a Uint8 field can hold (terrain, biomes). */
export const U8_ID_CAPACITY = 0xff;
/** Largest runtime id a Uint16 field can hold (world objects). */
export const U16_ID_CAPACITY = 0xffff;

/** A save references content that no longer exists, or a table overflows its field. */
export class RuntimeIdError extends Error {
  override readonly name = 'RuntimeIdError';
}

/** Code unit order (not locale dependent). */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Bidirectional string id ↔ runtime id table of one content collection. */
export class RuntimeIdTable {
  private readonly byId = new Map<string, number>();
  /** Sorted string ids; runtime id = index + 1. */
  private readonly sorted: readonly string[];

  private constructor(
    /** Table name for messages (`terrain`, `biomes`, `objects`). */
    readonly name: string,
    ids: readonly string[],
    /** Largest runtime id the target field can store. */
    readonly capacity: number,
  ) {
    const sorted = [...ids].sort(compareIds);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1]) throw new RuntimeIdError(`Runtime id table "${name}": duplicate id "${String(sorted[i])}"`);
    }
    if (sorted.length > capacity) throw new RuntimeIdError(`Runtime id table "${name}": ${sorted.length} ids exceed the field capacity ${capacity}`);
    sorted.forEach((id, i) => this.byId.set(id, i + 1));
    this.sorted = Object.freeze(sorted);
  }

  /** Builds a table from string ids (any order). Throws on duplicates or overflow. */
  static fromIds(name: string, ids: readonly string[], capacity: number): RuntimeIdTable {
    return new RuntimeIdTable(name, ids, capacity);
  }

  /** Number of ids (the largest runtime id). */
  get size(): number {
    return this.sorted.length;
  }

  /** Runtime id of a string id; throws `RuntimeIdError` for unknown ids. */
  runtimeId(id: string): number {
    const rid = this.byId.get(id);
    if (rid === undefined) throw new RuntimeIdError(`Runtime id table "${this.name}": unknown id "${id}"`);
    return rid;
  }

  /** Runtime id of a string id, or `undefined`. */
  find(id: string): number | undefined {
    return this.byId.get(id);
  }

  /** Whether the table contains a string id. */
  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** String id of a runtime id (1…size); throws for 0 and out-of-range values. */
  stringId(runtimeId: number): string {
    const id = this.sorted[runtimeId - 1];
    if (!Number.isInteger(runtimeId) || runtimeId < 1 || id === undefined) throw new RuntimeIdError(`Runtime id table "${this.name}": no entry for runtime id ${String(runtimeId)}`);
    return id;
  }

  /** The sorted string ids (runtime id = index + 1); this is what saves store. */
  ids(): readonly string[] {
    return this.sorted;
  }

  /**
   * Maps runtime ids of a saved table onto this table: `remap[savedRuntimeId] = currentRuntimeId`,
   * `remap[0] = 0`. Returns `null` when the numbering is unchanged (no chunk needs rewriting).
   * Throws `RuntimeIdError` naming every saved id that no longer exists.
   */
  remapFrom(savedIds: readonly string[]): Uint16Array | null {
    const remap = new Uint16Array(savedIds.length + 1);
    const missing: string[] = [];
    let identity = savedIds.length <= this.sorted.length;
    savedIds.forEach((id, i) => {
      const current = this.byId.get(id);
      if (current === undefined) missing.push(id);
      else {
        remap[i + 1] = current;
        if (current !== i + 1) identity = false;
      }
    });
    if (missing.length > 0) throw new RuntimeIdError(`Runtime id table "${this.name}": the save uses content that no longer exists: ${missing.join(', ')}`);
    return identity ? null : remap;
  }
}

/** The three runtime id tables of the world. */
export interface WorldIdTables {
  /** Terrain types (`ground` and `solid`). */
  readonly terrain: RuntimeIdTable;
  readonly biomes: RuntimeIdTable;
  /** World objects (`object`). */
  readonly objects: RuntimeIdTable;
}

/** String ids per table (input of `createWorldIdTables`, stored in saves). */
export interface WorldIdTablesSnapshot {
  readonly terrain: readonly string[];
  readonly biomes: readonly string[];
  readonly objects: readonly string[];
}

/** zod schema of a saved id table set. */
export const worldIdTablesSnapshotSchema = z
  .object({
    terrain: z.array(z.string().min(1)).max(U8_ID_CAPACITY),
    biomes: z.array(z.string().min(1)).max(U8_ID_CAPACITY),
    objects: z.array(z.string().min(1)).max(U16_ID_CAPACITY),
  })
  .strict();

/** Builds the tables from string ids. */
export function createWorldIdTables(ids: WorldIdTablesSnapshot): WorldIdTables {
  return Object.freeze({
    terrain: RuntimeIdTable.fromIds('terrain', ids.terrain, U8_ID_CAPACITY),
    biomes: RuntimeIdTable.fromIds('biomes', ids.biomes, U8_ID_CAPACITY),
    objects: RuntimeIdTable.fromIds('objects', ids.objects, U16_ID_CAPACITY),
  });
}

let contentTables: WorldIdTables | undefined;

/** Tables of the game content (`src/content`), built once and shared. */
export function contentWorldIdTables(): WorldIdTables {
  contentTables ??= createWorldIdTables({
    terrain: CONTENT.collection('terrain').ids(),
    biomes: CONTENT.collection('biomes').ids(),
    objects: CONTENT.collection('worldObjects').ids(),
  });
  return contentTables;
}

/** The id lists to store in a save. */
export function serializeWorldIdTables(tables: WorldIdTables): WorldIdTablesSnapshot {
  return { terrain: [...tables.terrain.ids()], biomes: [...tables.biomes.ids()], objects: [...tables.objects.ids()] };
}

/** Validates saved id lists. Throws `TypeError` on malformed data. */
export function parseWorldIdTablesSnapshot(data: unknown): WorldIdTablesSnapshot {
  const parsed = worldIdTablesSnapshotSchema.safeParse(data);
  if (!parsed.success) throw new TypeError(`World id tables invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return parsed.data;
}

/** Runtime id remapping from a save's numbering to the current one (`null` = unchanged). */
export interface ChunkIdRemap {
  readonly terrain: Uint16Array | null;
  readonly biomes: Uint16Array | null;
  readonly objects: Uint16Array | null;
}

/** Remapping for chunks written with `saved` tables into the `current` tables. */
export function createChunkIdRemap(saved: WorldIdTablesSnapshot, current: WorldIdTables): ChunkIdRemap {
  return {
    terrain: current.terrain.remapFrom(saved.terrain),
    biomes: current.biomes.remapFrom(saved.biomes),
    objects: current.objects.remapFrom(saved.objects),
  };
}

/** Whether a remap changes nothing. */
export function isIdentityRemap(remap: ChunkIdRemap): boolean {
  return remap.terrain === null && remap.biomes === null && remap.objects === null;
}

function remapField(field: Uint8Array | Uint16Array, remap: Uint16Array | null, what: string, chunk: ChunkData): void {
  if (remap === null) {
    return;
  }
  for (let i = 0; i < CHUNK_AREA; i++) {
    const saved = field[i] as number;
    const current = remap[saved];
    if (current === undefined) throw new RuntimeIdError(`Chunk ${chunk.key}: ${what} runtime id ${saved} at tile ${i} is not in the saved id table`);
    field[i] = current;
  }
}

/** Rewrites the content ids of a loaded chunk in place (ground, solid, biome, object). */
export function remapChunk(chunk: ChunkData, remap: ChunkIdRemap): void {
  remapField(chunk.ground, remap.terrain, 'terrain', chunk);
  remapField(chunk.solid, remap.terrain, 'terrain', chunk);
  remapField(chunk.biome, remap.biomes, 'biome', chunk);
  remapField(chunk.object, remap.objects, 'object', chunk);
}
