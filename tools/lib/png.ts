/**
 * Minimal PNG encoder (RGBA8, no interlace) and decoder (RGB8/RGBA8, no interlace – what the encoder
 * and browser screenshots write) using node:zlib – keeps the tools dependency-free.
 */
import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Default zlib level: smallest files; large contact sheets pass a faster level. */
const DEFAULT_DEFLATE_LEVEL = 9;

/** Encode RGBA pixels (width*height*4 bytes) to a PNG file buffer. */
export function encodePng(width: number, height: number, rgba: Uint8Array, level = DEFAULT_DEFLATE_LEVEL): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error(`encodePng: expected ${width * height * 4} bytes, got ${rgba.length}`);
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level })), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** PNG colour types RGB and RGBA. */
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;
/** Bytes per RGB8 pixel. */
const RGB_BYTES = 3;
const OPAQUE = 0xff;
/** Bytes per RGBA8 pixel. */
const RGBA_BYTES = 4;
/** Length of the PNG signature. */
const SIGNATURE_LENGTH = 8;
/** Chunk header (length + type) and CRC length. */
const CHUNK_OVERHEAD = 12;
/** PNG row filter types (RFC 2083 §6). */
const FILTER = { none: 0, sub: 1, up: 2, average: 3, paeth: 4 } as const;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode an 8-bit, non-interlaced RGBA or RGB PNG (what `encodePng` and browser screenshots write)
 * to RGBA pixels (RGB images get alpha 255).
 */
export function decodePng(file: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let offset = SIGNATURE_LENGTH;
  let width = 0;
  let height = 0;
  let bpp = RGBA_BYTES;
  const idat: Uint8Array[] = [];
  while (offset < file.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...file.subarray(offset + 4, offset + 8));
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (data[8] !== 8 || (data[9] !== COLOR_TYPE_RGBA && data[9] !== COLOR_TYPE_RGB) || data[12] !== 0) throw new Error('decodePng: only 8-bit RGBA or RGB without interlace is supported');
      bpp = data[9] === COLOR_TYPE_RGB ? RGB_BYTES : RGBA_BYTES;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += length + CHUNK_OVERHEAD;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? FILTER.none;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const above = row - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i] ?? 0;
      const a = i >= bpp ? (pixels[row + i - bpp] ?? 0) : 0;
      const b = y > 0 ? (pixels[above + i] ?? 0) : 0;
      const c = y > 0 && i >= bpp ? (pixels[above + i - bpp] ?? 0) : 0;
      let v = x;
      if (filter === FILTER.sub) v = x + a;
      else if (filter === FILTER.up) v = x + b;
      else if (filter === FILTER.average) v = x + Math.floor((a + b) / 2);
      else if (filter === FILTER.paeth) v = x + paeth(a, b, c);
      pixels[row + i] = v & 0xff;
    }
  }
  if (bpp === RGBA_BYTES) return { width, height, rgba: pixels };
  const rgba = new Uint8Array(width * height * RGBA_BYTES);
  for (let p = 0, q = 0; p < pixels.length; p += RGB_BYTES, q += RGBA_BYTES) {
    rgba[q] = pixels[p] ?? 0;
    rgba[q + 1] = pixels[p + 1] ?? 0;
    rgba[q + 2] = pixels[p + 2] ?? 0;
    rgba[q + 3] = OPAQUE;
  }
  return { width, height, rgba };
}
