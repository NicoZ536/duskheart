/**
 * Item icons and figure images for the DOM UI (docs/SPIEL.md §2 "Icon-Konvention": sprite
 * `icon_<itemId>`, 16×16). The game atlas stores palette indices, not colours (docs/RENDER.md §2:
 * R = palette index 1…64, A = coverage), so the UI decodes the sprites it shows once into real colours
 * of the base palette row and caches them as image URLs – the same pixels the world shows, in the
 * DOM at integer scale (`image-rendering: pixelated`).
 *
 * - `ensureAtlasImages()` starts loading the albedo atlas (once per page); `atlasImagesVersion`
 *   changes when it is decoded, so components re-render and ask again.
 * - `spriteImageUrl(id, frame)` / `itemIconUrl(itemId)`: data URL of one frame, or `null` while the
 *   atlas loads, before `npm run assets`, or for a sprite the atlas lacks (the slot then shows the
 *   item's initial on its rarity rim – never an empty square).
 * - `layeredImage(layers, clip)`: layers drawn on top of each other at the same frame index and
 *   cropped to the figure (the paper doll with its clothing and worn pieces, M3-07 rig order).
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { itemIconId } from '../../../content/items/index';
import { PALETTE_HEX } from '../../../generated/palette';
import { generatedAtlasModule, type GeneratedAtlasModule } from '../../../render/assets/generated';

const RGBA = 4;
const HEX_RADIX = 16;

interface DecodedAtlas {
  readonly mod: GeneratedAtlasModule;
  readonly ctx: CanvasRenderingContext2D;
}

let atlas: DecodedAtlas | null = null;
let loading: Promise<void> | null = null;
const version = signal(0);
const cache = new Map<string, string | null>();
/** Palette colours as RGB triples, index = palette index − 1. */
let paletteRgb: readonly (readonly [number, number, number])[] | null = null;

function palette(): readonly (readonly [number, number, number])[] {
  paletteRgb ??= PALETTE_HEX.map((hex) => {
    const n = Number.parseInt(hex.slice(1), HEX_RADIX);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] as const;
  });
  return paletteRgb;
}

/** Changes once the atlas is decoded (components read it to re-render). */
export const atlasImagesVersion: ReadonlySignal<number> = version;

/** Starts loading the atlas image (no-op when it is loading or loaded, or outside a browser). */
export function ensureAtlasImages(baseUrl: string = import.meta.env.BASE_URL): void {
  if (loading !== null || typeof document === 'undefined' || typeof createImageBitmap !== 'function') return;
  const mod = generatedAtlasModule();
  if (mod === null) return;
  loading = (async () => {
    const res = await fetch(baseUrl + mod.ATLAS.albedoUrl);
    if (!res.ok) throw new Error(`Atlas-Bild ${mod.ATLAS.albedoUrl}: HTTP ${res.status}`);
    const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('Canvas 2D nicht verfügbar');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    atlas = { mod, ctx };
    cache.clear();
    layeredCache.clear();
    version.value++;
  })().catch((err: unknown) => {
    console.error(`UI-Icons: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/** Writes the palette colours of `rect` of the atlas onto `out` at (`dx`, `dy`); covered pixels only. */
function paint(a: DecodedAtlas, rect: { x: number; y: number; w: number; h: number }, out: ImageData, dx: number, dy: number): void {
  const src = a.ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data;
  const pal = palette();
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const i = (y * rect.w + x) * RGBA;
      if ((src[i + 3] ?? 0) === 0) continue;
      const c = pal[(src[i] ?? 1) - 1];
      if (c === undefined) continue;
      const o = ((dy + y) * out.width + dx + x) * RGBA;
      out.data[o] = c[0];
      out.data[o + 1] = c[1];
      out.data[o + 2] = c[2];
      out.data[o + 3] = 255;
    }
  }
}

function toUrl(img: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')?.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Data URL of frame `frame` of sprite `id` (see module comment). Reads `atlasImagesVersion`, so a
 * component calling it re-renders once the atlas is decoded.
 */
export function spriteImageUrl(id: string, frame = 0): string | null {
  if (version.value === 0) return null;
  const a = atlas;
  if (a === null) return null;
  const key = `${id}#${frame}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const rect = a.mod.SPRITES[id]?.frames[frame];
  let url: string | null = null;
  if (rect !== undefined) {
    const img = new ImageData(rect.w, rect.h);
    paint(a, rect, img, 0, 0);
    url = toUrl(img);
  }
  cache.set(key, url);
  return url;
}

/** Data URL of an item's 16×16 icon. */
export function itemIconUrl(itemId: string): string | null {
  return spriteImageUrl(itemIconId(itemId));
}

/** Whether the atlas has the sprite (after loading; false before – subscribes like `spriteImageUrl`). */
export function hasSprite(id: string): boolean {
  return version.value > 0 && atlas?.mod.SPRITES[id] !== undefined;
}

/** A composed figure image and its size [px]. */
export interface LayeredImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

const layeredCache = new Map<string, LayeredImage | null>();

/** The covered part of `img` (bounding box of the opaque pixels), or `null` when nothing is covered. */
function opaqueBox(img: ImageData): { x: number; y: number; w: number; h: number } | null {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if ((img.data[(y * img.width + x) * RGBA + 3] ?? 0) === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * `layers` (sprite ids, bottom first) drawn on top of each other at the first frame of `clip` of the
 * first layer and cropped to the covered pixels; layers the atlas lacks or with another cell size are
 * left out. `null` while the atlas loads or when the base layer is missing.
 */
export function layeredImage(layers: readonly string[], clip: string): LayeredImage | null {
  if (version.value === 0) return null;
  const a = atlas;
  const base = layers[0];
  if (a === null || base === undefined) return null;
  const key = `${layers.join('+')}@${clip}`;
  const hit = layeredCache.get(key);
  if (hit !== undefined) return hit;
  const sprite = a.mod.SPRITES[base];
  const frame = sprite?.clips[clip]?.frames[0] ?? 0;
  const rect = sprite?.frames[frame];
  let result: LayeredImage | null = null;
  if (sprite !== undefined && rect !== undefined) {
    const img = new ImageData(rect.w, rect.h);
    for (const id of layers) {
      const r = a.mod.SPRITES[id]?.frames[frame];
      if (r !== undefined && r.w === rect.w && r.h === rect.h) paint(a, r, img, 0, 0);
    }
    const box = opaqueBox(img);
    if (box !== null) {
      const cropped = new ImageData(box.w, box.h);
      for (let y = 0; y < box.h; y++) {
        const from = ((box.y + y) * img.width + box.x) * RGBA;
        cropped.data.set(img.data.subarray(from, from + box.w * RGBA), y * box.w * RGBA);
      }
      result = { url: toUrl(cropped), width: box.w, height: box.h };
    }
  }
  layeredCache.set(key, result);
  return result;
}
