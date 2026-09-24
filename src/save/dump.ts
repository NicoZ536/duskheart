/**
 * World dumps (MASTERPROMPT §28 "Export/Import", "Versioniert mit Migrationen (Tests mit
 * Fixture-Spielständen jeder Version)"; M3-34): every record of one world in a save store – world meta,
 * blobs (world record …), changed chunks, slots – as one plain value together with the save version that
 * wrote it (src/save/versions.ts; ADR-0030).
 *
 * - `exportWorld` reads a world out of a store, `importWorld` writes one into a store in a single
 *   transaction (replacing a world with the same id); `loadWorld` then restores it like any save,
 *   migrations included.
 * - `worldDumpText` / `parseWorldDumpText`: the dump as text – canonical JSON (sorted keys, typed arrays
 *   of the chunk diffs as tagged base64, src/save/canonical.ts), indented one space per level so fixture
 *   files diff line by line in review. Parsing validates the envelope and every record.
 * The fixture saves (`tests/fixtures/saves/v<n>.json`, `npm run fixture:save`) are dumps; the `.dhsave`
 * export (M7-58) compresses the same text.
 */
import { z } from 'zod';
import { canonicalJson, parseCanonical } from './canonical';
import { SaveError } from './registry';
import { blobRecordSchema, chunkRecordSchema, slotRecordSchema, worldMetaSchema, type BlobRecord, type ChunkRecord, type SaveStore, type SlotRecord, type WorldMeta } from './store';
import { CURRENT_SAVE_VERSION, saveVersionOf } from './versions';

/** Format version of `WorldDump`. */
export const WORLD_DUMP_FORMAT = 1;
/** Indentation of the dump text [spaces per level]. */
const DUMP_TEXT_INDENT = 1;

/** zod schema of a world dump (records validated like the store validates them). */
export const worldDumpSchema = z
  .object({
    format: z.literal(WORLD_DUMP_FORMAT),
    /** Save version of the slots (the build that wrote them). */
    saveVersion: z.number().int().min(1),
    world: worldMetaSchema,
    blobs: z.array(blobRecordSchema),
    chunks: z.array(chunkRecordSchema),
    slots: z.array(slotRecordSchema),
  })
  .strict();

/** Every record of one world. */
export interface WorldDump {
  readonly format: typeof WORLD_DUMP_FORMAT;
  readonly saveVersion: number;
  readonly world: WorldMeta;
  /** Sorted by name. */
  readonly blobs: readonly BlobRecord[];
  /** Sorted by chunk key. */
  readonly chunks: readonly ChunkRecord[];
  /** Sorted by slot name. */
  readonly slots: readonly SlotRecord[];
}

function describe(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.map(String).join('.') || '(dump)'}: ${i.message}`).join('; ');
}

/** The save version of `slot`'s snapshot, or the running build's when the snapshot names none of the known ones. */
function slotSaveVersion(slot: SlotRecord | undefined): number {
  const participants = (slot?.snapshot as { participants?: unknown } | undefined)?.participants;
  if (typeof participants !== 'object' || participants === null) return CURRENT_SAVE_VERSION.version;
  return saveVersionOf(participants as Record<string, { version: number }>)?.version ?? CURRENT_SAVE_VERSION.version;
}

/** Reads every record of world `worldId`. Throws `SaveError` if the world does not exist. */
export async function exportWorld(store: SaveStore, worldId: string): Promise<WorldDump> {
  const world = await store.getWorld(worldId);
  if (world === undefined) throw new SaveError(`World "${worldId}" does not exist`);
  const blobs: BlobRecord[] = [];
  for (const name of await store.listBlobNames(worldId)) blobs.push((await store.getBlob(worldId, name)) as BlobRecord);
  const chunks: ChunkRecord[] = [];
  for (const key of await store.listChunkKeys(worldId)) chunks.push((await store.getChunk(worldId, key)) as ChunkRecord);
  const slots: SlotRecord[] = [];
  for (const slot of await store.listSlots(worldId)) slots.push((await store.getSlot(worldId, slot)) as SlotRecord);
  // The newest save version among the slots names the dump (autosaves of one world come from one build).
  const saveVersion = slots.reduce((v, s) => Math.max(v, slotSaveVersion(s)), slots.length === 0 ? CURRENT_SAVE_VERSION.version : 1);
  return { format: WORLD_DUMP_FORMAT, saveVersion, world, blobs, chunks, slots };
}

/** Validates `raw` as a world dump: envelope, records, and every record belonging to the dump's world. Throws `SaveError`. */
export function parseWorldDump(raw: unknown): WorldDump {
  const parsed = worldDumpSchema.safeParse(raw);
  if (!parsed.success) throw new SaveError(`World dump invalid: ${describe(parsed.error)}`);
  const dump = parsed.data;
  const id = dump.world.id;
  const foreign = [...dump.blobs, ...dump.chunks, ...dump.slots].find((r) => r.worldId !== id);
  if (foreign !== undefined) throw new SaveError(`World dump invalid: a record of world "${foreign.worldId}" in the dump of "${id}"`);
  if (dump.saveVersion > CURRENT_SAVE_VERSION.version) {
    throw new SaveError(`World dump of "${id}" has save version ${dump.saveVersion}, newer than this build's version ${CURRENT_SAVE_VERSION.version}`);
  }
  return dump;
}

/**
 * Writes the world of `raw` (validated, `parseWorldDump`) into `store` in one transaction; a world with the
 * same id is replaced completely. Returns the stored world meta.
 */
export async function importWorld(store: SaveStore, raw: unknown): Promise<WorldMeta> {
  const dump = parseWorldDump(raw);
  await store.write((b) => {
    b.deleteWorld(dump.world.id);
    b.putWorld(dump.world);
    for (const r of dump.blobs) b.putBlob(r);
    for (const r of dump.chunks) b.putChunk(r);
    for (const r of dump.slots) b.putSlot(r);
  });
  return dump.world;
}

/** The dump as text: canonical JSON (typed arrays tagged), indented, with a final newline. */
export function worldDumpText(dump: WorldDump): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(dump)), null, DUMP_TEXT_INDENT)}\n`;
}

/** Parses and validates a dump text (`worldDumpText`). Throws `SaveError`. */
export function parseWorldDumpText(text: string): WorldDump {
  let raw: unknown;
  try {
    raw = parseCanonical(text);
  } catch (err) {
    throw new SaveError(`World dump text is not canonical JSON: ${(err as Error).message}`);
  }
  return parseWorldDump(raw);
}
