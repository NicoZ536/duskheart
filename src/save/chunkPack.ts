/**
 * Compressed chunk records (MASTERPROMPT §3.1 "Worker: … Speicher-Kompression", §28; docs/SPIEL.md §25 "Kompression der
 * Chunk-Diffs … im Speicher-Worker"; M7-57).
 *
 * A chunk diff (src/world/stream/diff.ts) is packed into one binary buffer (`packChunkDiff`: address, every field patch with
 * its run lengths and values, the object state quadruples – little endian, no alignment) and gzipped through the platform's
 * `CompressionStream` (browser and Node ≥ 18, in the save worker or in this thread – the same code). The record keeps the
 * hash of the diff (`chunkDiffHash`), so a stored record is checked after inflating exactly like a plain one.
 *
 * Records of both kinds live side by side in the store: plain ones (`CHUNK_RECORD_FORMAT`, src/save/chunks.ts – saves
 * before M7, the in-thread `saveWorld` of tools and tests, the fixtures) and packed ones (`PACKED_CHUNK_FORMAT`, the game's
 * save writer). `decodeStoredChunk` reads either.
 */
import { CHUNK_FIELDS, type ChunkField } from '../world/model/chunk';
import { CHUNK_DIFF_FORMAT, chunkDiffHash, parseChunkDiff, type ChunkDiff, type ChunkFieldPatch } from '../world/stream/diff';
import { decodeChunkRecord } from './chunks';
import { SaveError } from './registry';

/** Format tag of a packed chunk record (differs from the plain record's number, so the plain decoder refuses it). */
export const PACKED_CHUNK_FORMAT = 'gzip-1';
/** First four bytes of a packed diff ("DHCD" little endian): a buffer that is no diff is refused at once. */
const PACK_MAGIC = 0x44434844;
/** Version of the binary layout. */
const PACK_VERSION = 1;
/** Bytes of the header: magic u32, version u8, layer i8, cx i32, cy i32, field count u8. */
const HEADER_BYTES = 4 + 1 + 1 + 4 + 4 + 1;
/** Bytes of a field header: field index u8, value width u8, run count u32, value count u32. */
const FIELD_HEADER_BYTES = 1 + 1 + 4 + 4;
const U16 = 2;
const U32 = 4;
const F64 = 8;

/** What a packed chunk record stores (`ChunkRecord.data`). */
export interface PackedChunkRecordData {
  readonly format: typeof PACKED_CHUNK_FORMAT;
  /** `chunkDiffHash` of the diff (integrity check after inflating). */
  readonly hash: string;
  /** The gzipped packed diff. */
  readonly bytes: Uint8Array;
}

/** Whether stored record data is a packed record. */
export function isPackedChunkRecord(data: unknown): data is PackedChunkRecordData {
  return typeof data === 'object' && data !== null && (data as { format?: unknown }).format === PACKED_CHUNK_FORMAT;
}

/** The diff as one binary buffer. */
export function packChunkDiff(diff: ChunkDiff): Uint8Array {
  let size = HEADER_BYTES + U32 + diff.objects.length * F64;
  let fields = 0;
  for (const name of CHUNK_FIELDS) {
    const p = diff.fields[name];
    if (p === undefined) continue;
    fields++;
    size += FIELD_HEADER_BYTES + p.runs.length * U16 + p.values.length * p.values.BYTES_PER_ELEMENT;
  }
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let o = 0;
  v.setUint32(o, PACK_MAGIC, true);
  o += U32;
  v.setUint8(o++, PACK_VERSION);
  v.setInt8(o++, diff.layer);
  v.setInt32(o, diff.cx, true);
  o += U32;
  v.setInt32(o, diff.cy, true);
  o += U32;
  v.setUint8(o++, fields);
  for (let f = 0; f < CHUNK_FIELDS.length; f++) {
    const p = diff.fields[CHUNK_FIELDS[f] as ChunkField];
    if (p === undefined) continue;
    const width = p.values.BYTES_PER_ELEMENT;
    v.setUint8(o++, f);
    v.setUint8(o++, width);
    v.setUint32(o, p.runs.length, true);
    o += U32;
    v.setUint32(o, p.values.length, true);
    o += U32;
    for (let i = 0; i < p.runs.length; i++, o += U16) v.setUint16(o, p.runs[i] as number, true);
    for (let i = 0; i < p.values.length; i++, o += width) {
      if (width === U16) v.setUint16(o, p.values[i] as number, true);
      else v.setUint8(o, p.values[i] as number);
    }
  }
  v.setUint32(o, diff.objects.length, true);
  o += U32;
  for (let i = 0; i < diff.objects.length; i++, o += F64) v.setFloat64(o, diff.objects[i] as number, true);
  return out;
}

/** The diff of a buffer `packChunkDiff` wrote (validated like a stored diff, `parseChunkDiff`). Throws `SaveError`. */
export function unpackChunkDiff(bytes: Uint8Array): ChunkDiff {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const need = (n: number): void => {
    if (o + n > bytes.byteLength) throw new SaveError(`Packed chunk diff truncated at byte ${o} (${bytes.byteLength} bytes)`);
  };
  need(HEADER_BYTES);
  if (v.getUint32(o, true) !== PACK_MAGIC) throw new SaveError('Packed chunk diff: wrong magic');
  o += U32;
  const version = v.getUint8(o++);
  if (version !== PACK_VERSION) throw new SaveError(`Packed chunk diff: unsupported version ${version}`);
  const layer = v.getInt8(o++);
  const cx = v.getInt32(o, true);
  o += U32;
  const cy = v.getInt32(o, true);
  o += U32;
  const count = v.getUint8(o++);
  const fields: Partial<Record<ChunkField, ChunkFieldPatch>> = {};
  for (let k = 0; k < count; k++) {
    need(FIELD_HEADER_BYTES);
    const index = v.getUint8(o++);
    const width = v.getUint8(o++);
    const runCount = v.getUint32(o, true);
    o += U32;
    const valueCount = v.getUint32(o, true);
    o += U32;
    const name = CHUNK_FIELDS[index];
    if (name === undefined || (width !== 1 && width !== U16)) throw new SaveError(`Packed chunk diff: field ${index} of width ${width} invalid`);
    need(runCount * U16 + valueCount * width);
    const runs = new Uint16Array(runCount);
    for (let i = 0; i < runCount; i++, o += U16) runs[i] = v.getUint16(o, true);
    const values = width === U16 ? new Uint16Array(valueCount) : new Uint8Array(valueCount);
    for (let i = 0; i < valueCount; i++, o += width) values[i] = width === U16 ? v.getUint16(o, true) : v.getUint8(o);
    fields[name] = { runs, values };
  }
  need(U32);
  const objectCount = v.getUint32(o, true);
  o += U32;
  need(objectCount * F64);
  const objects = new Float64Array(objectCount);
  for (let i = 0; i < objectCount; i++, o += F64) objects[i] = v.getFloat64(o, true);
  if (o !== bytes.byteLength) throw new SaveError(`Packed chunk diff: ${bytes.byteLength - o} bytes left over`);
  try {
    return parseChunkDiff({ format: CHUNK_DIFF_FORMAT, layer, cx, cy, fields, objects });
  } catch (err) {
    throw new SaveError(`Packed chunk diff invalid: ${(err as Error).message}`);
  }
}

/** Runs `bytes` through a compression or decompression stream of `format`. */
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.readable.getReader();
  const read = async (): Promise<void> => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      chunks.push(value);
      total += value.byteLength;
    }
  };
  // Both sides together: a corrupt stream rejects both, and neither rejection is left unobserved.
  await Promise.all([writer.write(bytes as Uint8Array<ArrayBuffer>).then(() => writer.close()), read()]);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** gzip of `bytes` (CompressionStream). */
export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream('gzip'));
}

/** The bytes of a gzip stream (DecompressionStream). Throws `SaveError` on data that is no gzip stream. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    return await pipe(bytes, new DecompressionStream('gzip'));
  } catch (err) {
    throw new SaveError(`Not a gzip stream: ${(err as Error).message}`);
  }
}

/** The packed, gzipped record of a diff (in the save worker). */
export async function encodePackedChunkRecord(diff: ChunkDiff): Promise<PackedChunkRecordData> {
  return { format: PACKED_CHUNK_FORMAT, hash: chunkDiffHash(diff), bytes: await gzip(packChunkDiff(diff)) };
}

/** The stored hash of a record of either kind, or null for data that is no chunk record. */
export function storedChunkHash(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const hash = (data as { hash?: unknown }).hash;
  return typeof hash === 'string' ? hash : null;
}

/**
 * Validates a stored record of chunk `key` – plain (`decodeChunkRecord`) or packed (inflated, unpacked, address and hash
 * checked) – and returns its diff. Throws `SaveError` if it is corrupt.
 */
export async function decodeStoredChunk(key: string, data: unknown): Promise<ChunkDiff> {
  if (!isPackedChunkRecord(data)) return decodeChunkRecord(key, data);
  if (!(data.bytes instanceof Uint8Array) || typeof data.hash !== 'string') throw new SaveError(`Chunk record "${key}" is corrupt: packed record without bytes or hash`);
  let diff: ChunkDiff;
  try {
    diff = unpackChunkDiff(await gunzip(data.bytes));
  } catch (err) {
    throw new SaveError(`Chunk record "${key}" is corrupt: ${(err as Error).message}`);
  }
  const at = `${diff.layer}:${diff.cx}:${diff.cy}`;
  if (at !== key) throw new SaveError(`Chunk record "${key}" is corrupt: holds chunk ${at}`);
  const actual = chunkDiffHash(diff);
  if (actual !== data.hash) throw new SaveError(`Chunk record "${key}" is corrupt: hash ${actual} ≠ stored ${data.hash}`);
  return diff;
}
