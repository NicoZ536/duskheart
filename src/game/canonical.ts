/**
 * Canonical serialization and stable hashing of simulation state (docs/ARCHITEKTUR.md
 * "Simulation": `hashState()`; determinism tests, replays, save integrity).
 *
 * `canonicalJson` writes plain data with sorted object keys and no whitespace, so equal state
 * always yields the identical string on every platform. Typed arrays are written as tagged base64
 * objects (`{"$typed":"f32","b64":"…"}`, little endian) and restored by `parseCanonical`.
 * Rejected (TypeError with the path): NaN/±Infinity, bigint, functions, symbols, `undefined`
 * array elements, cycles, non-plain objects (Map, Set, Date, class instances) and the reserved
 * key `$typed`. Object properties that are `undefined` are omitted like in JSON.
 *
 * Lives in the game layer because `Simulation.hashState()` needs it and `game` may not import
 * `save`; `src/save/canonical.ts` re-exports it.
 */
import { Fnv1a64, base64ToTypedArray, typedArrayToBase64, type NumericTypedArray, type TypedArrayCtor } from '../engine/binary';

/** Reserved key marking an encoded typed array. */
export const TYPED_ARRAY_TAG = '$typed';

/** Supported typed arrays: constructor for type checks and base64 decoder per tag. */
const TYPED_ARRAYS = {
  i8: { ctor: Int8Array, decode: (b64: string) => base64ToTypedArray(b64, Int8Array) },
  u8: { ctor: Uint8Array, decode: (b64: string) => base64ToTypedArray(b64, Uint8Array) },
  u8c: { ctor: Uint8ClampedArray, decode: (b64: string) => base64ToTypedArray(b64, Uint8ClampedArray) },
  i16: { ctor: Int16Array, decode: (b64: string) => base64ToTypedArray(b64, Int16Array) },
  u16: { ctor: Uint16Array, decode: (b64: string) => base64ToTypedArray(b64, Uint16Array) },
  i32: { ctor: Int32Array, decode: (b64: string) => base64ToTypedArray(b64, Int32Array) },
  u32: { ctor: Uint32Array, decode: (b64: string) => base64ToTypedArray(b64, Uint32Array) },
  f32: { ctor: Float32Array, decode: (b64: string) => base64ToTypedArray(b64, Float32Array) },
  f64: { ctor: Float64Array, decode: (b64: string) => base64ToTypedArray(b64, Float64Array) },
} as const satisfies Record<string, { ctor: TypedArrayCtor<NumericTypedArray>; decode: (b64: string) => NumericTypedArray }>;

/** Short tag of each supported typed array type. */
export type TypedArrayTag = keyof typeof TYPED_ARRAYS;

const TAGS = Object.keys(TYPED_ARRAYS) as TypedArrayTag[];

function tagOf(value: ArrayBufferView): TypedArrayTag | undefined {
  // Exact constructor match: Uint8ClampedArray must not be written as Uint8Array or vice versa.
  return TAGS.find((tag) => value.constructor === TYPED_ARRAYS[tag].ctor);
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function fail(path: string, what: string): never {
  throw new TypeError(`canonicalJson: ${what} at ${path === '' ? '(root)' : path}`);
}

function write(value: unknown, path: string, out: string[], stack: Set<object>): void {
  switch (typeof value) {
    case 'string':
      out.push(JSON.stringify(value));
      return;
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'number':
      if (!Number.isFinite(value)) fail(path, `non-finite number ${String(value)}`);
      out.push(JSON.stringify(value));
      return;
    case 'object':
      break;
    default:
      fail(path, `unsupported ${typeof value}`);
  }
  if (value === null) {
    out.push('null');
    return;
  }
  if (stack.has(value)) fail(path, 'cycle');
  if (ArrayBuffer.isView(value)) {
    const tag = tagOf(value);
    if (tag === undefined) fail(path, `unsupported binary view ${value.constructor.name}`);
    out.push(`{"${TYPED_ARRAY_TAG}":"${tag}","b64":"${typedArrayToBase64(value as NumericTypedArray)}"}`);
    return;
  }
  stack.add(value);
  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(',');
      const item: unknown = value[i];
      if (item === undefined) fail(`${path}[${i}]`, 'undefined array element');
      write(item, `${path}[${i}]`, out, stack);
    }
    out.push(']');
  } else {
    if (!isPlainObject(value)) fail(path, `non-plain object ${value.constructor.name}`);
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    out.push('{');
    let first = true;
    for (const key of keys) {
      if (key === TYPED_ARRAY_TAG) fail(path, `reserved key "${TYPED_ARRAY_TAG}"`);
      const v = rec[key];
      if (v === undefined) continue;
      if (!first) out.push(',');
      first = false;
      out.push(JSON.stringify(key), ':');
      write(v, path === '' ? key : `${path}.${key}`, out, stack);
    }
    out.push('}');
  }
  stack.delete(value);
}

/** Canonical JSON text of plain data (see module comment for the rules). */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  write(value, '', out, new Set());
  return out.join('');
}

function isTaggedTypedArray(value: unknown): value is { [TYPED_ARRAY_TAG]: string; b64: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const rec = value as Record<string, unknown>;
  return keys.length === 2 && typeof rec[TYPED_ARRAY_TAG] === 'string' && typeof rec['b64'] === 'string';
}

/** Parses canonical JSON and restores tagged typed arrays. Throws on malformed input. */
export function parseCanonical(json: string): unknown {
  return JSON.parse(json, (_key, value: unknown) => {
    if (!isTaggedTypedArray(value)) return value;
    const tag = value[TYPED_ARRAY_TAG];
    if (!Object.hasOwn(TYPED_ARRAYS, tag)) throw new TypeError(`parseCanonical: unknown typed array tag "${tag}"`);
    return TYPED_ARRAYS[tag as TypedArrayTag].decode(value.b64);
  });
}

const UTF8 = new TextEncoder();

/** FNV-1a 64 bit of the UTF-8 bytes of `text`, as 16 hex digits. */
export function hashText64(text: string): string {
  return new Fnv1a64().update(UTF8.encode(text)).hex();
}

/** Stable 64 bit hash (16 hex digits) of plain data: FNV-1a over its canonical JSON. */
export function stableHash64(value: unknown): string {
  return hashText64(canonicalJson(value));
}
