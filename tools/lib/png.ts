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

/**
 * The inflated scanlines, at least `length` bytes long: a truncated stream reads as zeros (filter `none`, value 0) past
 * its end, so the row loops need no bounds checks.
 */
function scanlines(raw: Uint8Array, length: number): Uint8Array {
  if (raw.length >= length) return raw;
  const padded = new Uint8Array(length);
  padded.set(raw);
  return padded;
}

/**
 * Reverses the filter of one scanline (PNG §9.2) from `raw` (filter byte at `src`) into `pixels` at `row`; `hasAbove`:
 * the row above is `pixels[row − stride …]`, else it counts as zeros. One loop per filter type (the atlas rows are all
 * `none`: a plain copy); an unknown filter type copies like `none`.
 */
function unfilterRow(raw: Uint8Array, src: number, pixels: Uint8Array, row: number, stride: number, bpp: number, hasAbove: boolean): void {
  const filter = raw[src] as number;
  const from = src + 1;
  const above = row - stride;
  if (filter === FILTER.sub) {
    for (let i = 0; i < stride; i++) pixels[row + i] = ((raw[from + i] as number) + (i >= bpp ? (pixels[row + i - bpp] as number) : 0)) & 0xff;
  } else if (filter === FILTER.up) {
    if (!hasAbove) pixels.set(raw.subarray(from, from + stride), row);
    else for (let i = 0; i < stride; i++) pixels[row + i] = ((raw[from + i] as number) + (pixels[above + i] as number)) & 0xff;
  } else if (filter === FILTER.average) {
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? (pixels[row + i - bpp] as number) : 0;
      const b = hasAbove ? (pixels[above + i] as number) : 0;
      pixels[row + i] = ((raw[from + i] as number) + ((a + b) >> 1)) & 0xff;
    }
  } else if (filter === FILTER.paeth) {
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? (pixels[row + i - bpp] as number) : 0;
      const b = hasAbove ? (pixels[above + i] as number) : 0;
      const c = hasAbove && i >= bpp ? (pixels[above + i - bpp] as number) : 0;
      pixels[row + i] = ((raw[from + i] as number) + paeth(a, b, c)) & 0xff;
    }
  } else pixels.set(raw.subarray(from, from + stride), row);
}

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
  const stride = width * bpp;
  const raw = scanlines(inflateSync(Buffer.concat(idat)), (stride + 1) * height);
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) unfilterRow(raw, y * (stride + 1), pixels, y * stride, stride, bpp, y > 0);
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
