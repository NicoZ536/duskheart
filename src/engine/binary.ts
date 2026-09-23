/**
 * Compact binary helpers for saves, chunk diffs and determinism hashes.
 *
 * - Base64 of `Uint8Array` / typed arrays without `Buffer`, `btoa` or `atob` (runs in browser,
 *   worker and Node alike).
 * - Run length encoding for `Uint8Array` / `Uint16Array` (chunk layers are mostly uniform).
 * - FNV-1a hashes (32 bit and 64 bit) over typed arrays for chunk and world hashes.
 *
 * Multi-byte typed arrays are always serialized and hashed in little endian byte order, so
 * results are identical on every platform.
 */

/** Any numeric typed array. */
export type NumericTypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

/** Constructor of a numeric typed array (`Uint16Array`, `Float32Array`, …). */
export interface TypedArrayCtor<T extends NumericTypedArray> {
  readonly BYTES_PER_ELEMENT: number;
  new (length: number): T;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Char code of the base64 padding character '='. */
const B64_PAD = 61;
/** Size of the ASCII range covered by the decode lookup table. */
const ASCII_RANGE = 128;
const B64_ENCODE = new Uint8Array(B64_ALPHABET.length);
const B64_DECODE = new Int16Array(ASCII_RANGE).fill(-1);
for (let i = 0; i < B64_ALPHABET.length; i++) {
  const code = B64_ALPHABET.charCodeAt(i);
  B64_ENCODE[i] = code;
  B64_DECODE[code] = i;
}
const ASCII = new TextDecoder();

/** Whether this platform stores multi-byte numbers little endian (all current browsers/CPUs). */
export const PLATFORM_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Largest run length of the 8 bit RLE format. */
export const RLE_U8_MAX_RUN = 0xff;
/** Largest run length of the 16 bit RLE format. */
export const RLE_U16_MAX_RUN = 0xffff;

/** FNV-1a 32 bit offset basis. */
export const FNV32_OFFSET_BASIS = 0x811c9dc5;
/** FNV-1a 32 bit prime. */
const FNV32_PRIME = 0x01000193;
/** FNV-1a 64 bit offset basis 0xcbf29ce484222325 as four 16 bit limbs, low to high. */
const FNV64_OFFSET_LIMBS = [0x2325, 0x8422, 0x9ce4, 0xcbf2] as const;
/** Low part of the FNV-1a 64 bit prime 0x100000001b3 (= 2^40 + 0x1b3). */
const FNV64_PRIME_LOW = 0x1b3;
/** Bit shift of the high part of the 64 bit prime within its limb (2^40 = limb 2, shifted by 8). */
const FNV64_PRIME_HIGH_SHIFT = 8;
const LIMB_BITS = 16;
const LIMB_MASK = 0xffff;

// ---------------------------------------------------------------------------------------------
// Byte views
// ---------------------------------------------------------------------------------------------

function swapBytes(bytes: Uint8Array, width: number): void {
  if (width <= 1) return;
  for (let i = 0; i + width <= bytes.length; i += width) {
    for (let a = i, b = i + width - 1; a < b; a++, b--) {
      const t = bytes[a] as number;
      bytes[a] = bytes[b] as number;
      bytes[b] = t;
    }
  }
}

/**
 * Little endian bytes of a typed array. On little endian platforms this is a view on the same
 * memory (no copy); on big endian platforms a byte swapped copy.
 */
export function typedArrayBytes(arr: NumericTypedArray): Uint8Array {
  const view = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  if (PLATFORM_LITTLE_ENDIAN || arr.BYTES_PER_ELEMENT === 1) return view;
  const copy = view.slice();
  swapBytes(copy, arr.BYTES_PER_ELEMENT);
  return copy;
}

// ---------------------------------------------------------------------------------------------
// Base64
// ---------------------------------------------------------------------------------------------

/** Standard base64 (RFC 4648, with padding) of a byte array. */
export function bytesToBase64(bytes: Uint8Array): string {
  const n = bytes.length;
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out[o++] = B64_ENCODE[(v >>> 18) & 63] as number;
    out[o++] = B64_ENCODE[(v >>> 12) & 63] as number;
    out[o++] = B64_ENCODE[(v >>> 6) & 63] as number;
    out[o++] = B64_ENCODE[v & 63] as number;
  }
  const rem = n - i;
  if (rem === 1) {
    const v = (bytes[i] as number) << 16;
    out[o++] = B64_ENCODE[(v >>> 18) & 63] as number;
    out[o++] = B64_ENCODE[(v >>> 12) & 63] as number;
    out[o++] = B64_PAD;
    out[o++] = B64_PAD;
  } else if (rem === 2) {
    const v = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out[o++] = B64_ENCODE[(v >>> 18) & 63] as number;
    out[o++] = B64_ENCODE[(v >>> 12) & 63] as number;
    out[o++] = B64_ENCODE[(v >>> 6) & 63] as number;
    out[o++] = B64_PAD;
  }
  return ASCII.decode(out);
}

function b64Value(s: string, i: number): number {
  const code = s.charCodeAt(i);
  const v = code < ASCII_RANGE ? (B64_DECODE[code] as number) : -1;
  if (v < 0) throw new SyntaxError(`Invalid base64 character at ${i}`);
  return v;
}

/** Decodes standard base64 (padding optional). Throws `SyntaxError` on malformed input. */
export function base64ToBytes(s: string): Uint8Array {
  let len = s.length;
  while (len > 0 && s.charCodeAt(len - 1) === B64_PAD) len--;
  const padding = s.length - len;
  if (padding > 2 || (padding > 0 && s.length % 4 !== 0)) throw new SyntaxError('Invalid base64 padding');
  const rem = len % 4;
  if (rem === 1) throw new SyntaxError('Invalid base64 length');
  const full = len - rem;
  const out = new Uint8Array((full / 4) * 3 + (rem === 0 ? 0 : rem - 1));
  let o = 0;
  for (let i = 0; i < full; i += 4) {
    const v = (b64Value(s, i) << 18) | (b64Value(s, i + 1) << 12) | (b64Value(s, i + 2) << 6) | b64Value(s, i + 3);
    out[o++] = (v >>> 16) & 0xff;
    out[o++] = (v >>> 8) & 0xff;
    out[o++] = v & 0xff;
  }
  if (rem >= 2) {
    const v = (b64Value(s, full) << 18) | (b64Value(s, full + 1) << 12) | (rem === 3 ? b64Value(s, full + 2) << 6 : 0);
    out[o++] = (v >>> 16) & 0xff;
    if (rem === 3) out[o++] = (v >>> 8) & 0xff;
  }
  return out;
}

/** Base64 of a typed array's elements (little endian bytes). */
export function typedArrayToBase64(arr: NumericTypedArray): string {
  return bytesToBase64(typedArrayBytes(arr));
}

/** Decodes base64 produced by `typedArrayToBase64` into a new array of type `ctor`. */
export function base64ToTypedArray<T extends NumericTypedArray>(s: string, ctor: TypedArrayCtor<T>): T {
  const bytes = base64ToBytes(s);
  const width = ctor.BYTES_PER_ELEMENT;
  if (bytes.length % width !== 0) throw new RangeError(`Byte length ${bytes.length} is not a multiple of ${width}`);
  const out = new ctor(bytes.length / width);
  if (!PLATFORM_LITTLE_ENDIAN) swapBytes(bytes, width);
  new Uint8Array(out.buffer, out.byteOffset, out.byteLength).set(bytes);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Run length encoding
// ---------------------------------------------------------------------------------------------

/** RLE of bytes as `[count, value]` pairs with 1 ≤ count ≤ 255. */
export function rleEncodeU8(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length * 2);
  let o = 0;
  let i = 0;
  while (i < data.length) {
    const v = data[i] as number;
    let run = 1;
    while (i + run < data.length && run < RLE_U8_MAX_RUN && data[i + run] === v) run++;
    out[o++] = run;
    out[o++] = v;
    i += run;
  }
  return out.slice(0, o);
}

/** RLE of 16 bit values as `[count, value]` pairs with 1 ≤ count ≤ 65535. */
export function rleEncodeU16(data: Uint16Array): Uint16Array {
  const out = new Uint16Array(data.length * 2);
  let o = 0;
  let i = 0;
  while (i < data.length) {
    const v = data[i] as number;
    let run = 1;
    while (i + run < data.length && run < RLE_U16_MAX_RUN && data[i + run] === v) run++;
    out[o++] = run;
    out[o++] = v;
    i += run;
  }
  return out.slice(0, o);
}

function rleDecodedLength(enc: Uint8Array | Uint16Array, expectedLength: number | undefined): number {
  if (enc.length % 2 !== 0) throw new RangeError('RLE data must consist of [count, value] pairs');
  let total = 0;
  for (let i = 0; i < enc.length; i += 2) {
    const run = enc[i] as number;
    if (run === 0) throw new RangeError(`RLE run length 0 at pair ${i / 2}`);
    total += run;
  }
  if (expectedLength !== undefined && total !== expectedLength) {
    throw new RangeError(`RLE decodes to ${total} values, expected ${expectedLength}`);
  }
  return total;
}

/** Decodes `rleEncodeU8` output. Optionally checks the decoded length. */
export function rleDecodeU8(enc: Uint8Array, expectedLength?: number): Uint8Array {
  const out = new Uint8Array(rleDecodedLength(enc, expectedLength));
  let o = 0;
  for (let i = 0; i < enc.length; i += 2) {
    const run = enc[i] as number;
    out.fill(enc[i + 1] as number, o, o + run);
    o += run;
  }
  return out;
}

/** Decodes `rleEncodeU16` output. Optionally checks the decoded length. */
export function rleDecodeU16(enc: Uint16Array, expectedLength?: number): Uint16Array {
  const out = new Uint16Array(rleDecodedLength(enc, expectedLength));
  let o = 0;
  for (let i = 0; i < enc.length; i += 2) {
    const run = enc[i] as number;
    out.fill(enc[i + 1] as number, o, o + run);
    o += run;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// FNV-1a hashes
// ---------------------------------------------------------------------------------------------

/**
 * FNV-1a 32 bit over the little endian bytes of `data`. Pass a previous result as `basis` to hash
 * several arrays as one stream. Returns a u32.
 */
export function fnv1a32(data: NumericTypedArray, basis: number = FNV32_OFFSET_BASIS): number {
  const bytes = typedArrayBytes(data);
  let h = basis | 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] as number;
    h = Math.imul(h, FNV32_PRIME);
  }
  return h >>> 0;
}

/** FNV-1a 32 bit of a string's UTF-16 code units (low byte, then high byte). Returns a u32. */
export function fnv1a32String(s: string, basis: number = FNV32_OFFSET_BASIS): number {
  let h = basis | 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h ^= c & 0xff;
    h = Math.imul(h, FNV32_PRIME);
    h ^= c >>> 8;
    h = Math.imul(h, FNV32_PRIME);
  }
  return h >>> 0;
}

/**
 * Incremental FNV-1a 64 bit hasher (exact 64 bit arithmetic on 16 bit limbs, no BigInt).
 * `update()` any number of typed arrays, then read `hex()`.
 */
export class Fnv1a64 {
  private h0: number = FNV64_OFFSET_LIMBS[0];
  private h1: number = FNV64_OFFSET_LIMBS[1];
  private h2: number = FNV64_OFFSET_LIMBS[2];
  private h3: number = FNV64_OFFSET_LIMBS[3];

  /** Feeds the little endian bytes of `data`. */
  update(data: NumericTypedArray): this {
    const bytes = typedArrayBytes(data);
    let h0 = this.h0;
    let h1 = this.h1;
    let h2 = this.h2;
    let h3 = this.h3;
    for (let i = 0; i < bytes.length; i++) {
      h0 ^= bytes[i] as number;
      // h * (2^40 + 0x1b3) mod 2^64
      let t0 = h0 * FNV64_PRIME_LOW;
      let t1 = h1 * FNV64_PRIME_LOW;
      let t2 = h2 * FNV64_PRIME_LOW + (h0 << FNV64_PRIME_HIGH_SHIFT);
      let t3 = h3 * FNV64_PRIME_LOW + (h1 << FNV64_PRIME_HIGH_SHIFT);
      t1 += t0 >>> LIMB_BITS;
      t0 &= LIMB_MASK;
      t2 += t1 >>> LIMB_BITS;
      t1 &= LIMB_MASK;
      t3 += t2 >>> LIMB_BITS;
      t2 &= LIMB_MASK;
      t3 &= LIMB_MASK;
      h0 = t0;
      h1 = t1;
      h2 = t2;
      h3 = t3;
    }
    this.h0 = h0;
    this.h1 = h1;
    this.h2 = h2;
    this.h3 = h3;
    return this;
  }

  /** High 32 bits of the current hash as a u32. */
  get high(): number {
    return ((this.h3 << LIMB_BITS) | this.h2) >>> 0;
  }

  /** Low 32 bits of the current hash as a u32. */
  get low(): number {
    return ((this.h1 << LIMB_BITS) | this.h0) >>> 0;
  }

  /** Current hash as 16 lowercase hex digits. */
  hex(): string {
    return this.high.toString(16).padStart(8, '0') + this.low.toString(16).padStart(8, '0');
  }
}

/** FNV-1a 64 bit of one or more typed arrays (as one byte stream), as 16 hex digits. */
export function fnv1a64Hex(...data: NumericTypedArray[]): string {
  const h = new Fnv1a64();
  for (const d of data) h.update(d);
  return h.hex();
}
