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
 * export (M7-58, src/save/dhsave.ts) compresses the same text.
 *
 * Format 2 (M7-57): every chunk record names its slot, and packed chunk records (src/save/chunkPack.ts) are written as plain
 * ones, so a dump is canonical JSON whatever the store holds. Dumps of format 1 (the fixtures v1–v3) have no slots: their
 * chunk records belong to `main`. `exportWorldSlot` takes one slot only – the newest intact one by default – as `main`
 * (what the `.dhsave` export carries); `importWorld` can file a dump under a new id and name (an imported world never
 * replaces one of the player's).
 */
import { z } from 'zod';
import { canonicalJson, parseCanonical } from './canonical';
import { decodeStoredChunk } from './chunkPack';
import { encodeChunkRecord } from './chunks';
import { SaveError } from './registry';
import { MAIN_SLOT } from './slots';
import {
  blobRecordSchema,
  chunkRecordSchema,
  chunkSlotOf,
  slotRecordSchema,
  worldMetaSchema,
  type BlobRecord,
  type ChunkRecord,
  type SaveStore,
  type SlotRecord,
  type WorldMeta,
} from './store';
import { CURRENT_SAVE_VERSION, saveVersionOf } from './versions';
import { readNewestIntactSave } from './world';

/** Format version of `WorldDump` (2: chunk records per slot, M7-57). */
export const WORLD_DUMP_FORMAT = 2;
/** Dump format before slots (the fixtures v1–v3): chunk records without a slot, all of `main`. */
const WORLD_DUMP_FORMAT_UNSLOTTED = 1;
/** Indentation of the dump text [spaces per level]. */
const DUMP_TEXT_INDENT = 1;

/** zod schema of a world dump (records validated like the store validates them). */
export const worldDumpSchema = z
  .object({
    format: z.union([z.literal(WORLD_DUMP_FORMAT_UNSLOTTED), z.literal(WORLD_DUMP_FORMAT)]),
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
  readonly format: typeof WORLD_DUMP_FORMAT | typeof WORLD_DUMP_FORMAT_UNSLOTTED;
  readonly saveVersion: number;
  readonly world: WorldMeta;
  /** Sorted by name. */
  readonly blobs: readonly BlobRecord[];
  /** Sorted by slot, then chunk key (format 1: no slot, all of `main`). */
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

/** A chunk record as a dump holds it: plain (packed records inflated and written as plain ones), naming its slot. */
async function plainChunkRecord(record: ChunkRecord): Promise<ChunkRecord> {
  const slot = chunkSlotOf(record);
  const diff = await decodeStoredChunk(record.key, record.data);
  return { worldId: record.worldId, slot, key: record.key, data: encodeChunkRecord(diff) };
}

/** The chunk records of `slot` of world `worldId`, plain, sorted by key. */
async function slotChunks(store: SaveStore, worldId: string, slot: string): Promise<ChunkRecord[]> {
  const out: ChunkRecord[] = [];
  for (const key of await store.listChunkKeys(worldId, slot)) out.push(await plainChunkRecord((await store.getChunk(worldId, key, slot)) as ChunkRecord));
  return out;
}

/** Reads every record of world `worldId` (every slot with its chunk records). Throws `SaveError` if the world does not exist or a chunk record is corrupt. */
export async function exportWorld(store: SaveStore, worldId: string): Promise<WorldDump> {
  const world = await store.getWorld(worldId);
  if (world === undefined) throw new SaveError(`World "${worldId}" does not exist`);
  const blobs: BlobRecord[] = [];
  for (const name of await store.listBlobNames(worldId)) blobs.push((await store.getBlob(worldId, name)) as BlobRecord);
  const chunks: ChunkRecord[] = [];
  for (const slot of await store.listChunkSlots(worldId)) chunks.push(...(await slotChunks(store, worldId, slot)));
  const slots: SlotRecord[] = [];
  for (const slot of await store.listSlots(worldId)) slots.push((await store.getSlot(worldId, slot)) as SlotRecord);
  // The newest save version among the slots names the dump (autosaves of one world come from one build).
  const saveVersion = slots.reduce((v, s) => Math.max(v, slotSaveVersion(s)), slots.length === 0 ? CURRENT_SAVE_VERSION.version : 1);
  return { format: WORLD_DUMP_FORMAT, saveVersion, world, blobs, chunks, slots };
}

/**
 * One slot of world `worldId` as a dump of its own (the `.dhsave` export, M7-58): the world meta, the blobs, the slot – by
 * default the newest intact one (`readNewestIntactSave`), checked – filed as `main` with its chunk records. Throws
 * `SaveError` if the world does not exist or has no intact slot.
 */
export async function exportWorldSlot(store: SaveStore, worldId: string, slot?: string): Promise<WorldDump> {
  const world = await store.getWorld(worldId);
  if (world === undefined) throw new SaveError(`World "${worldId}" does not exist`);
  const chosen = slot ?? (await readNewestIntactSave(store, worldId)).save.slot;
  const record = await store.getSlot(worldId, chosen);
  if (record === undefined) throw new SaveError(`World "${worldId}" has no save in slot "${chosen}"`);
  const blobs: BlobRecord[] = [];
  for (const name of await store.listBlobNames(worldId)) blobs.push((await store.getBlob(worldId, name)) as BlobRecord);
  const chunks = (await slotChunks(store, worldId, chosen)).map((c) => ({ ...c, slot: MAIN_SLOT }));
  return { format: WORLD_DUMP_FORMAT, saveVersion: slotSaveVersion(record), world: { ...world, savedAt: record.savedAt }, blobs, chunks, slots: [{ ...record, slot: MAIN_SLOT }] };
}

/** Validates `raw` as a world dump: envelope, records, and every record belonging to the dump's world. Throws `SaveError`. */
export function parseWorldDump(raw: unknown): WorldDump {
  const parsed = worldDumpSchema.safeParse(raw);
  if (!parsed.success) throw new SaveError(`World dump invalid: ${describe(parsed.error)}`);
  const parsedDump = parsed.data;
  // Format 1 knew no slots: every chunk record belongs to `main`.
  const dump = parsedDump.format === WORLD_DUMP_FORMAT_UNSLOTTED ? { ...parsedDump, chunks: parsedDump.chunks.map((c) => ({ ...c, slot: chunkSlotOf(c) })) } : parsedDump;
  const id = dump.world.id;
  const foreign = [...dump.blobs, ...dump.chunks, ...dump.slots].find((r) => r.worldId !== id);
  if (foreign !== undefined) throw new SaveError(`World dump invalid: a record of world "${foreign.worldId}" in the dump of "${id}"`);
  if (dump.saveVersion > CURRENT_SAVE_VERSION.version) {
    throw new SaveError(`World dump of "${id}" has save version ${dump.saveVersion}, newer than this build's version ${CURRENT_SAVE_VERSION.version}`);
  }
  return dump;
}

/** Options of `importWorld`: file the world under another id and name (an import beside the player's worlds). */
export interface ImportWorldOptions {
  readonly worldId?: string;
  readonly name?: string;
}

/**
 * Writes the world of `raw` (validated, `parseWorldDump`) into `store` in one transaction – under `options.worldId` and
 * `options.name` when given (every record moves to that id) –; a world with the same id is replaced completely. Returns
 * the stored world meta.
 */
export async function importWorld(store: SaveStore, raw: unknown, options: ImportWorldOptions = {}): Promise<WorldMeta> {
  const dump = parseWorldDump(raw);
  const worldId = options.worldId ?? dump.world.id;
  const world: WorldMeta = { ...dump.world, id: worldId, ...(options.name === undefined ? {} : { name: options.name }) };
  await store.write((b) => {
    b.deleteWorld(worldId);
    b.putWorld(world);
    for (const r of dump.blobs) b.putBlob({ ...r, worldId });
    for (const r of dump.chunks) b.putChunk({ ...r, worldId });
    for (const r of dump.slots) b.putSlot({ ...r, worldId });
  });
  return world;
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
