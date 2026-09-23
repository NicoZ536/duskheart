/**
 * Normal- und Höhengenerator (MASTERPROMPT §5, docs/RENDER.md §2): Silhouette → Distanzfeld → Höhe nach
 * Höhen-Hinweis → Sobel → Normale → Glättung. Manuelle Höhen (`hoehenRaster`) ersetzen die erzeugte
 * Höhe pixelweise, bevor die Normalen entstehen.
 *
 * Rechnung im Bildraum der Raster (+x rechts, +y nach unten, +z zum Betrachter). Kodiert wird im
 * Bildschirmraum des Renderers (+x rechts, +y nach OBEN, +z zum Betrachter; `src/render/gbuffer.ts`):
 * R = 0,5 + 0,5·nx, G = 0,5 − 0,5·ny(Raster), B = Höhe (0…255 ≙ 0…32 px), A = Deckung.
 *
 * Höhen-Hinweise:
 * - `flach`: Höhe 0, Normale (0, 0, 1) – Böden, Teppiche, Pfützen.
 * - `kugel`: Kugelkappe je Zusammenhangskomponente, h = √(d·(2R − d)) mit d = Randabstand,
 *   R = größter Randabstand → radiale Normalen (Felsen, Büsche, Kronen).
 * - `zylinder`: je Pixelzeile ein aufrechter Zylinder über die zusammenhängende Spanne → Normalen
 *   seitlich nach links/rechts (Stämme, Pfosten, Fackeln, Figuren).
 * - `block`: Plateau mit 45°-Fase der Breite `BLOCK_BEVEL_PX` (Kisten, Mauersteine, Truhen).
 * - `custom`: Höhe ausschließlich aus `hoehenRaster`.
 */
import { components, distanceToEdge } from '../../assets-src/lib/distance';
import { HEIGHT_AUTO_VALUE, MAX_HEIGHT_PX, TRANSPARENT, type HeightHint, type SpriteFrame } from '../../assets-src/lib/sprite';
import { OPAQUE, RGBA_BYTES } from '../lib/image';

/** Breite der Fase beim Hinweis `block` in px. */
export const BLOCK_BEVEL_PX = 2;
/** Stärke der Normalen: Faktor auf die Sobel-Steigung (1 = physikalisch, px pro px). */
export const NORMAL_STRENGTH = 1;
/** Sobel-Normierung: Summe der Gewichte einer Seite (1 + 2 + 1) × Abstand 2 px. */
const SOBEL_NORM = 8;
/** Gewicht des Mittelpixels beim Glätten (Nachbarn zählen je 1). */
const SMOOTH_CENTER_WEIGHT = 4;
/** 8-Bit-Kanalmaximum. */
const CHANNEL_MAX = 255;

/** Höhenfeld in px (0 für transparente Pixel) nach Höhen-Hinweis und Override. */
export function heightField(mask: Uint8Array, w: number, h: number, hint: HeightHint, override: Int8Array | null = null): Float32Array {
  const out = new Float32Array(w * h);
  if (hint === 'kugel' || hint === 'block') {
    const dist = distanceToEdge(mask, w, h);
    const { labels, count } = components(mask, w, h);
    const radius = new Float32Array(count + 1);
    dist.forEach((d, p) => {
      const l = labels[p] ?? 0;
      radius[l] = Math.max(radius[l] ?? 0, d - 0.5);
    });
    dist.forEach((d, p) => {
      if ((mask[p] ?? 0) === 0) return;
      // Abstand des Pixelmittelpunkts zur Silhouettenkante (Randpixel: 0,5 px).
      const e = d - 0.5;
      if (hint === 'block') out[p] = Math.min(d, BLOCK_BEVEL_PX);
      else {
        const r = (radius[labels[p] ?? 0] ?? 0) + 0.5;
        out[p] = Math.sqrt(Math.max(0, e * (2 * r - e)));
      }
    });
  } else if (hint === 'zylinder') {
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if ((mask[y * w + x] ?? 0) === 0) {
          x++;
          continue;
        }
        const a = x;
        while (x < w && (mask[y * w + x] ?? 0) > 0) x++;
        const r = (x - a) / 2;
        const c = a + r;
        for (let px = a; px < x; px++) {
          const u = (px + 0.5 - c) / r;
          out[y * w + px] = r * Math.sqrt(Math.max(0, 1 - u * u));
        }
      }
    }
  }
  if (override !== null) {
    override.forEach((v, p) => {
      if (v !== HEIGHT_AUTO_VALUE && (mask[p] ?? 0) > 0) out[p] = v;
    });
  }
  for (let p = 0; p < out.length; p++) out[p] = Math.min(MAX_HEIGHT_PX, (mask[p] ?? 0) > 0 ? (out[p] ?? 0) : 0);
  return out;
}

/** Sobel-Normalen (3 Werte je Pixel, normiert) aus einem Höhenfeld, danach innerhalb der Maske geglättet. */
export function normalsFromHeight(height: Float32Array, mask: Uint8Array, w: number, h: number, strength = NORMAL_STRENGTH): Float32Array {
  const hAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (height[y * w + x] ?? 0));
  const raw = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if ((mask[p] ?? 0) === 0) continue;
      const gx = (hAt(x + 1, y - 1) + 2 * hAt(x + 1, y) + hAt(x + 1, y + 1) - hAt(x - 1, y - 1) - 2 * hAt(x - 1, y) - hAt(x - 1, y + 1)) / SOBEL_NORM;
      const gy = (hAt(x - 1, y + 1) + 2 * hAt(x, y + 1) + hAt(x + 1, y + 1) - hAt(x - 1, y - 1) - 2 * hAt(x, y - 1) - hAt(x + 1, y - 1)) / SOBEL_NORM;
      const nx = -gx * strength;
      const ny = -gy * strength;
      const len = Math.hypot(nx, ny, 1);
      raw[p * 3] = nx / len;
      raw[p * 3 + 1] = ny / len;
      raw[p * 3 + 2] = 1 / len;
    }
  }
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if ((mask[p] ?? 0) === 0) continue;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = x + dx;
          const qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const q = qy * w + qx;
          if ((mask[q] ?? 0) === 0) continue;
          const weight = dx === 0 && dy === 0 ? SMOOTH_CENTER_WEIGHT : 1;
          sx += (raw[q * 3] ?? 0) * weight;
          sy += (raw[q * 3 + 1] ?? 0) * weight;
          sz += (raw[q * 3 + 2] ?? 0) * weight;
        }
      }
      const len = Math.hypot(sx, sy, sz) || 1;
      out[p * 3] = sx / len;
      out[p * 3 + 1] = sy / len;
      out[p * 3 + 2] = sz / len;
    }
  }
  return out;
}

/** Kodiert eine Normalkomponente −1…1 nach 0…255 (0,5 + 0,5·n). */
export function encodeUnit(n: number): number {
  return Math.round((0.5 + 0.5 * Math.max(-1, Math.min(1, n))) * CHANNEL_MAX);
}

/** Kodiert eine Höhe in px nach 0…255 (≙ 0…32 px). */
export function encodeHeight(px: number): number {
  return Math.round((Math.max(0, Math.min(MAX_HEIGHT_PX, px)) / MAX_HEIGHT_PX) * CHANNEL_MAX);
}

/** Deckungsmaske eines Frames. */
export function frameMask(frame: SpriteFrame): Uint8Array {
  return Uint8Array.from(frame.index, (v) => (v === TRANSPARENT ? 0 : 1));
}

/** Normal-Atlas-Pixel (RGBA8) eines Frames: RG = Normale XY (+y oben), B = Höhe, A = Deckung. */
export function normalFrameRgba(frame: SpriteFrame, w: number, h: number, hint: HeightHint): Uint8Array {
  const mask = frameMask(frame);
  const height = heightField(mask, w, h, hint, frame.heightOverride);
  const normals = normalsFromHeight(height, mask, w, h);
  const out = new Uint8Array(w * h * RGBA_BYTES);
  for (let p = 0; p < w * h; p++) {
    if ((mask[p] ?? 0) === 0) continue;
    out[p * RGBA_BYTES] = encodeUnit(normals[p * 3] ?? 0);
    out[p * RGBA_BYTES + 1] = encodeUnit(-(normals[p * 3 + 1] ?? 0));
    out[p * RGBA_BYTES + 2] = encodeHeight(height[p] ?? 0);
    out[p * RGBA_BYTES + 3] = OPAQUE;
  }
  return out;
}

/** Albedo-Atlas-Pixel (RGBA8) eines Frames: R = Palettenindex, G = Emissiv, B = Materialflags, A = Deckung. */
export function albedoFrameRgba(frame: SpriteFrame, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * RGBA_BYTES);
  for (let p = 0; p < w * h; p++) {
    const index = frame.index[p] ?? TRANSPARENT;
    if (index === TRANSPARENT) continue;
    out[p * RGBA_BYTES] = index;
    out[p * RGBA_BYTES + 1] = (frame.emissive[p] ?? 0) > 0 ? CHANNEL_MAX : 0;
    out[p * RGBA_BYTES + 2] = frame.material[p] ?? 0;
    out[p * RGBA_BYTES + 3] = OPAQUE;
  }
  return out;
}
