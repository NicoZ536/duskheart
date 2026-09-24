/**
 * Chunk diffs against the generated state (docs/WORLD.md §5 "Geänderte Chunks werden als Diff gegen
 * den generierten Zustand gespeichert (Arrays + Objektzustände, RLE), unveränderte nie").
 *
 * Format (`CHUNK_DIFF_FORMAT` 1), typed arrays throughout so IndexedDB stores it natively:
 * - per changed field a patch: `runs` = run lengths `[skip, take, skip, take, …]` over the 1024
 *   tiles in local index order (trailing unchanged tiles are not listed) and `values` = the new
 *   values of the taken tiles in order (`Uint16Array` for `object`, `Uint8Array` otherwise);
 * - `objects`: the complete object state set of the chunk as quadruples
 *   `[tileIndex, hp, growth, regrowAtTick]` in ascending tile order (it replaces the generated set).
 *
 * Patches store new values rather than an XOR against the generated values: saved runtime ids can
 * then be remapped when content is added (`remapChunkDiff`), and a tile the player changed keeps its
 * value even if a later generator version produces something else underneath.
 */
import { Fnv1a64 } from '../../engine/binary';
import { CHUNK_FIELDS, ChunkData, NO_REGROW_TICK, type ChunkField, type ObjectState } from '../model/chunk';
import { CHUNK_AREA, isLayer, type Layer } from '../model/coords';
import { RuntimeIdError, type ChunkIdRemap } from '../model/runtimeIds';

/** Format version of `ChunkDiff`. */
export const CHUNK_DIFF_FORMAT = 1;
/** Numbers per object state quadruple. */
export const OBJECT_QUAD = 4;
/** Offsets inside a quadruple. */
const QUAD_HP = 1;
const QUAD_GROWTH = 2;
const QUAD_REGROW = 3;

/** Changed tiles of one field. */
export interface ChunkFieldPatch {
  /** Run lengths `[skip, take, …]` in local index order. */
  readonly runs: Uint16Array;
  /** New values of the taken tiles, in order. */
  readonly values: Uint8Array | Uint16Array;
}

/** Difference of a chunk from its generated state. */
export interface ChunkDiff {
  readonly format: number;
  readonly layer: Layer;
  readonly cx: number;
  readonly cy: number;
  /** Patches of the fields that differ (absent = unchanged). */
  readonly fields: Readonly<Partial<Record<ChunkField, ChunkFieldPatch>>>;
  /** Complete object state set as quadruples in ascending tile order. */
  readonly objects: Float64Array;
}

/** Object states of a chunk as quadruples in ascending tile order. */
export function objectStateQuads(chunk: ChunkData): Float64Array {
  const indices = [...chunk.objectState.keys()].sort((a, b) => a - b);
  const out = new Float64Array(indices.length * OBJECT_QUAD);
  let o = 0;
  for (const i of indices) {
    const s = chunk.objectState.get(i) as ObjectState;
    out[o++] = i;
    out[o++] = s.hp;
    out[o++] = s.growth;
    out[o++] = s.regrowAtTick;
  }
  return out;
}

/** Replaces the object states of `chunk` with quadruples (validated). */
export function setObjectStateQuads(chunk: ChunkData, quads: Float64Array): void {
  if (quads.length % OBJECT_QUAD !== 0) throw new RangeError(`Chunk ${chunk.key}: object states must be quadruples, got ${quads.length} numbers`);
  chunk.objectState.clear();
  let previous = -1;
  for (let k = 0; k < quads.length; k += OBJECT_QUAD) {
    const i = quads[k] as number;
    const hp = quads[k + QUAD_HP] as number;
    const growth = quads[k + QUAD_GROWTH] as number;
    const regrow = quads[k + QUAD_REGROW] as number;
    if (!Number.isInteger(i) || i <= previous || i >= CHUNK_AREA) throw new RangeError(`Chunk ${chunk.key}: object state tile index ${i} invalid or not ascending`);
    if (!Number.isFinite(hp) || !Number.isFinite(growth) || !Number.isSafeInteger(regrow) || regrow < NO_REGROW_TICK) {
      throw new RangeError(`Chunk ${chunk.key}: object state at tile ${i} invalid`);
    }
    chunk.setObjectState(i, hp, growth, regrow);
    previous = i;
  }
}

function sameObjectStates(a: ChunkData, b: ChunkData): boolean {
  if (a.objectState.size !== b.objectState.size) return false;
  for (const [i, s] of a.objectState) {
    const t = b.objectState.get(i);
    if (t === undefined || t.hp !== s.hp || t.growth !== s.growth || t.regrowAtTick !== s.regrowAtTick) return false;
  }
  return true;
}

function patchField(base: Uint8Array | Uint16Array, cur: Uint8Array | Uint16Array, wide: boolean): ChunkFieldPatch | undefined {
  const runs: number[] = [];
  const values: number[] = [];
  let i = 0;
  let last = 0;
  while (i < CHUNK_AREA) {
    if (base[i] === cur[i]) {
      i++;
      continue;
    }
    const startTake = i;
    while (i < CHUNK_AREA && base[i] !== cur[i]) values.push(cur[i++] as number);
    runs.push(startTake - last, i - startTake);
    last = i;
  }
  if (values.length === 0) return undefined;
  return { runs: Uint16Array.from(runs), values: wide ? Uint16Array.from(values) : Uint8Array.from(values) };
}

/**
 * Diff of `current` against its generated `baseline` (same address), or `null` when the chunk is
 * unchanged (tile data and object states equal): unchanged chunks are never stored.
 */
export function diffChunk(baseline: ChunkData, current: ChunkData): ChunkDiff | null {
  if (baseline.layer !== current.layer || baseline.cx !== current.cx || baseline.cy !== current.cy) {
    throw new RangeError(`diffChunk: baseline ${baseline.key} and chunk ${current.key} differ in address`);
  }
  const fields: Partial<Record<ChunkField, ChunkFieldPatch>> = {};
  let changed = false;
  for (const name of CHUNK_FIELDS) {
    const patch = patchField(baseline.field(name), current.field(name), name === 'object');
    if (patch !== undefined) {
      fields[name] = patch;
      changed = true;
    }
  }
  if (!changed && sameObjectStates(baseline, current)) return null;
  return { format: CHUNK_DIFF_FORMAT, layer: current.layer, cx: current.cx, cy: current.cy, fields, objects: objectStateQuads(current) };
}

/** Applies a diff to a freshly generated chunk of the same address (in place). Throws `RangeError` on malformed patches. */
export function applyChunkDiff(chunk: ChunkData, diff: ChunkDiff): void {
  if (diff.layer !== chunk.layer || diff.cx !== chunk.cx || diff.cy !== chunk.cy) throw new RangeError(`applyChunkDiff: diff for ${diff.layer}:${diff.cx}:${diff.cy} applied to chunk ${chunk.key}`);
  for (const name of CHUNK_FIELDS) {
    const patch = diff.fields[name];
    if (patch === undefined) continue;
    const target = chunk.field(name);
    const { runs, values } = patch;
    let pos = 0;
    let v = 0;
    for (let r = 0; r + 1 < runs.length; r += 2) {
      pos += runs[r] as number;
      const end = pos + (runs[r + 1] as number);
      if (end > CHUNK_AREA || v + (end - pos) > values.length) throw new RangeError(`applyChunkDiff: patch of ${name} in chunk ${chunk.key} runs past the chunk or its values`);
      while (pos < end) target[pos++] = values[v++] as number;
    }
  }
  setObjectStateQuads(chunk, diff.objects);
}

// ---------------------------------------------------------------------------------------------
// Validation, remapping, hashing
// ---------------------------------------------------------------------------------------------

function invalid(reason: string): never {
  throw new TypeError(`Chunk diff invalid: ${reason}`);
}

function validatePatch(name: ChunkField, raw: unknown): ChunkFieldPatch {
  if (typeof raw !== 'object' || raw === null) invalid(`field ${name} is not an object`);
  const { runs, values } = raw as { runs?: unknown; values?: unknown };
  if (!(runs instanceof Uint16Array)) invalid(`field ${name}: runs must be a Uint16Array`);
  const wide = name === 'object';
  if (wide ? !(values instanceof Uint16Array) : !(values instanceof Uint8Array)) invalid(`field ${name}: values must be a ${wide ? 'Uint16Array' : 'Uint8Array'}`);
  const vals = values as Uint8Array | Uint16Array;
  if (runs.length === 0 || runs.length % 2 !== 0) invalid(`field ${name}: runs must be non-empty [skip, take] pairs`);
  let pos = 0;
  let taken = 0;
  for (let r = 0; r < runs.length; r += 2) {
    const take = runs[r + 1] as number;
    if (take === 0) invalid(`field ${name}: empty take run`);
    pos += (runs[r] as number) + take;
    taken += take;
  }
  if (pos > CHUNK_AREA) invalid(`field ${name}: runs cover ${pos} tiles, more than ${CHUNK_AREA}`);
  if (taken !== vals.length) invalid(`field ${name}: ${taken} changed tiles but ${vals.length} values`);
  return { runs, values: vals };
}

/** Checks untrusted data (a stored record) and returns it as `ChunkDiff`. Throws `TypeError`. */
export function parseChunkDiff(data: unknown): ChunkDiff {
  if (typeof data !== 'object' || data === null) invalid('not an object');
  const d = data as Partial<Record<keyof ChunkDiff, unknown>>;
  if (d.format !== CHUNK_DIFF_FORMAT) invalid(`unsupported format ${String(d.format)}`);
  if (!isLayer(d.layer)) invalid(`unknown layer ${String(d.layer)}`);
  if (!Number.isSafeInteger(d.cx) || !Number.isSafeInteger(d.cy)) invalid('cx/cy must be integers');
  if (typeof d.fields !== 'object' || d.fields === null) invalid('fields missing');
  const fields: Partial<Record<ChunkField, ChunkFieldPatch>> = {};
  for (const key of Object.keys(d.fields)) {
    if (!(CHUNK_FIELDS as readonly string[]).includes(key)) invalid(`unknown field ${key}`);
    const name = key as ChunkField;
    fields[name] = validatePatch(name, (d.fields as Record<string, unknown>)[key]);
  }
  if (!(d.objects instanceof Float64Array)) invalid('objects must be a Float64Array');
  const probe = new ChunkData(d.layer, d.cx as number, d.cy as number);
  try {
    setObjectStateQuads(probe, d.objects);
  } catch (err) {
    invalid((err as Error).message);
  }
  return { format: CHUNK_DIFF_FORMAT, layer: d.layer, cx: d.cx as number, cy: d.cy as number, fields, objects: d.objects };
}

function remapValues(values: Uint8Array | Uint16Array, remap: Uint16Array | null, what: string, key: string): Uint8Array | Uint16Array {
  if (remap === null) return values;
  const out = values instanceof Uint16Array ? new Uint16Array(values.length) : new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const saved = values[i] as number;
    const current = remap[saved];
    if (current === undefined) throw new RuntimeIdError(`Chunk diff ${key}: ${what} runtime id ${saved} is not in the saved id table`);
    out[i] = current;
  }
  return out;
}

/** The diff with its content ids rewritten from a save's numbering to the current one (`createChunkIdRemap`). */
export function remapChunkDiff(diff: ChunkDiff, remap: ChunkIdRemap): ChunkDiff {
  const key = `${diff.layer}:${diff.cx}:${diff.cy}`;
  const fields: Partial<Record<ChunkField, ChunkFieldPatch>> = {};
  for (const name of CHUNK_FIELDS) {
    const patch = diff.fields[name];
    if (patch === undefined) continue;
    const table = name === 'ground' || name === 'solid' ? remap.terrain : name === 'biome' ? remap.biomes : name === 'object' ? remap.objects : null;
    fields[name] = { runs: patch.runs, values: remapValues(patch.values, table, name, key) };
  }
  return { ...diff, fields };
}

/** Marker hashed for an absent field patch (distinguishes "unchanged" from an empty patch). */
const ABSENT_FIELD = Int32Array.of(-1);

/** Stable 64 bit hash (16 hex digits) of a diff: address, patches in field order, object states. */
export function chunkDiffHash(diff: ChunkDiff): string {
  const h = new Fnv1a64();
  h.update(Int32Array.of(diff.format, diff.layer, diff.cx, diff.cy));
  for (const name of CHUNK_FIELDS) {
    const patch = diff.fields[name];
    if (patch === undefined) {
      h.update(ABSENT_FIELD);
      continue;
    }
    h.update(Int32Array.of(patch.runs.length, patch.values.length));
    h.update(patch.runs);
    h.update(patch.values);
  }
  h.update(diff.objects);
  return h.hex();
}

/** Payload size of a diff [bytes] (typed array contents). */
export function chunkDiffBytes(diff: ChunkDiff): number {
  let bytes = diff.objects.byteLength;
  for (const name of CHUNK_FIELDS) {
    const patch = diff.fields[name];
    if (patch !== undefined) bytes += patch.runs.byteLength + patch.values.byteLength;
  }
  return bytes;
}
