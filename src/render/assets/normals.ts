/**
 * Relief and normals from a silhouette (MASTERPROMPT §5 "Distanzfeld → Höhe nach Höhen-Hinweis →
 * Sobel → Normale, geglättet"), used by the in-memory atlas builder. Normals are in screen space:
 * +x right, +y up (toward the top of the screen), +z out of the screen.
 */
import { ATLAS_HEIGHT_RANGE_PX } from '../gbuffer';
import type { HeightHint } from './atlas';

/** Chamfer distance weights (orthogonal, diagonal) and their unit. */
const CHAMFER_ORTHO = 3;
const CHAMFER_DIAG = 4;
/** Flat top of a `block` relief: bevel width in px and the height it rises to. */
export const BLOCK_BEVEL_PX = 2;
export const BLOCK_HEIGHT_PX = 4;
/** Sobel kernel normalisation (sum of one side's weights × 2 px). */
const SOBEL_NORM = 8;
const BYTE_MAX = 255;
const HALF = 0.5;
/** Bytes per RGBA8 texel. */
const RGBA = 4;

/** Chamfer distance (px) of every opaque pixel to the nearest transparent pixel or frame edge. */
export function distanceToEdge(mask: Uint8Array, w: number, h: number): Float32Array {
  const big = (w + h) * CHAMFER_DIAG;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = (mask[i] ?? 0) > 0 ? big : 0;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (d[y * w + x] ?? 0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((d[i] ?? 0) === 0) continue;
      d[i] = Math.min(d[i] ?? big, at(x - 1, y) + CHAMFER_ORTHO, at(x, y - 1) + CHAMFER_ORTHO, at(x - 1, y - 1) + CHAMFER_DIAG, at(x + 1, y - 1) + CHAMFER_DIAG);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if ((d[i] ?? 0) === 0) continue;
      d[i] = Math.min(d[i] ?? big, at(x + 1, y) + CHAMFER_ORTHO, at(x, y + 1) + CHAMFER_ORTHO, at(x + 1, y + 1) + CHAMFER_DIAG, at(x - 1, y + 1) + CHAMFER_DIAG);
    }
  }
  for (let i = 0; i < w * h; i++) d[i] = (d[i] ?? 0) / CHAMFER_ORTHO;
  return d;
}

/** Relief height (px above the sprite's surface plane) for a height hint. */
export function reliefFromHint(mask: Uint8Array, w: number, h: number, hint: HeightHint): Float32Array {
  const out = new Float32Array(w * h);
  if (hint === 'flach') return out;
  if (hint === 'custom') throw new Error('Höhen-Hinweis custom braucht eine manuelle Höhenkarte');
  if (hint === 'zylinder') {
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if ((mask[y * w + x] ?? 0) === 0) {
          x++;
          continue;
        }
        const x0 = x;
        while (x < w && (mask[y * w + x] ?? 0) > 0) x++;
        const r = (x - x0) / 2;
        const cx = (x0 + x) / 2;
        for (let px = x0; px < x; px++) {
          const u = (px + HALF - cx) / r;
          out[y * w + px] = r * Math.sqrt(Math.max(0, 1 - u * u));
        }
      }
    }
    return out;
  }
  const dist = distanceToEdge(mask, w, h);
  if (hint === 'block') {
    for (let i = 0; i < w * h; i++) out[i] = (Math.min(dist[i] ?? 0, BLOCK_BEVEL_PX) / BLOCK_BEVEL_PX) * BLOCK_HEIGHT_PX;
    return out;
  }
  let r = 0;
  for (let i = 0; i < w * h; i++) r = Math.max(r, dist[i] ?? 0);
  for (let i = 0; i < w * h; i++) {
    const d = Math.min(dist[i] ?? 0, r);
    out[i] = (mask[i] ?? 0) > 0 ? Math.sqrt(Math.max(0, r * r - (r - d) * (r - d))) : 0;
  }
  return out;
}

/** 3×3 box blur of the relief inside the mask (the "geglättet" step). */
export function smoothRelief(height: Float32Array, mask: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((mask[y * w + x] ?? 0) === 0) continue;
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) {
            n++;
            continue;
          }
          sum += (mask[sy * w + sx] ?? 0) > 0 ? (height[sy * w + sx] ?? 0) : 0;
          n++;
        }
      }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

/**
 * Encodes relief into the normal atlas layout for one frame, written into `out` (RGBA8, row stride
 * `stride` px) at (`ox`, `oy`): RG = normal XY, B = height / 32 px, A = coverage.
 */
export function writeNormalFrame(height: Float32Array, mask: Uint8Array, w: number, h: number, out: Uint8Array, stride: number, ox: number, oy: number): void {
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h || (mask[y * w + x] ?? 0) === 0 ? 0 : (height[y * w + x] ?? 0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((mask[y * w + x] ?? 0) === 0) continue;
      const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / SOBEL_NORM;
      const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / SOBEL_NORM;
      const nx = -gx;
      const ny = gy;
      const len = Math.hypot(nx, ny, 1);
      const o = ((oy + y) * stride + ox + x) * RGBA;
      out[o] = Math.round((nx / len) * HALF * BYTE_MAX + HALF * BYTE_MAX);
      out[o + 1] = Math.round((ny / len) * HALF * BYTE_MAX + HALF * BYTE_MAX);
      out[o + 2] = Math.round(Math.min(1, Math.max(0, (height[y * w + x] ?? 0) / ATLAS_HEIGHT_RANGE_PX)) * BYTE_MAX);
      out[o + 3] = BYTE_MAX;
    }
  }
}
