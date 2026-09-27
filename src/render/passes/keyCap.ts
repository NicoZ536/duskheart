/**
 * The key cap of the world's interaction markers (M4-38; MASTERPROMPT §26 "automatische Tastensymbole"): the sprite
 * `hinweis_taste` of the hint glyphs (assets-src/sprites/icons/hinweise.ts, 16 × 16, face x 3–12, y 3–10) – the same
 * cap the HUD's and the build mode's hint lines show (src/ui/hud/bau/Glyphe.tsx) – drawn by the world UI pass in its
 * palette colours, unlit, with the key's name written into its face by the pixel font. Longer names ("Strg+Z", "Leer")
 * stretch the cap sideways like the HUD's nine-slice: the three columns of either rim stay, the face columns repeat.
 *
 * `KeyCapShape.from` reads the sprite's pixels once per atlas (raw pixels of the in-memory atlas, or the decoded atlas
 * image through a 2D canvas) into runs of equal colour per row; `KeyCapShape.draw` emits them as solid rectangles of
 * the pass's text batch (no allocation per marker). Without the sprite (render debug scenes on their own atlas) the
 * pass keeps its drawn cap.
 */
import { PALETTE_HEX } from '../../generated/palette';
import type { AtlasData, AtlasImage } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import { rgbaFromHex } from '../text/textBatch';

/** The key cap sprite (the HUD's `KAPPE_SPRITE`). */
export const KEY_CAP_SPRITE = 'hinweis_taste';
/** Columns of the cap's left and right rim that never stretch [px] (the HUD's nine-slice `KAPPE_RAND`). */
export const KEY_CAP_RIM = { left: 3, right: 3 } as const;
/** Rows of the cap's face the key's name is written into [px] (inclusive). */
export const KEY_CAP_FACE = { top: 3, bottom: 10 } as const;
/** Padding between the key's ink and the rim [px] (the HUD's cap: 1 design px). */
export const KEY_CAP_PAD = 1;
const RGBA = 4;
const ALPHA = 3;

/** A run of equal colour in one row of the cap: start column, length, packed 0xRRGGBBAA colour. */
interface Run {
  readonly x: number;
  readonly w: number;
  readonly color: number;
}

/** One row of the cap: runs of the left rim, the face (repeated when it stretches) and the right rim. */
interface Row {
  readonly left: readonly Run[];
  /** Colour per face column (repeated across the stretched face); a single colour for a plain face row. */
  readonly face: readonly number[];
  readonly right: readonly Run[];
}

/** Something that queues solid rectangles (the pass's text batch). */
export interface RectSink {
  rect(x: number, y: number, width: number, height: number, color: number): void;
}

/** Colour of palette index `i` (1 … 64) as packed RGBA, 0 for transparent or unknown. */
function paletteColor(i: number): number {
  const hex = PALETTE_HEX[i - 1];
  return hex === undefined ? 0 : rgbaFromHex(hex);
}

/** Runs of equal colour in `colors[x0 … x1)` (0 = transparent, skipped). */
function runs(colors: readonly number[], x0: number, x1: number): Run[] {
  const out: Run[] = [];
  let x = x0;
  while (x < x1) {
    const c = colors[x] ?? 0;
    let e = x + 1;
    while (e < x1 && colors[e] === c) e++;
    if (c !== 0) out.push({ x, w: e - x, color: c });
    x = e;
  }
  return out;
}

/** The RGBA bytes of `rect` of an atlas image, or null when it cannot be read here (no canvas). */
function readRect(img: AtlasImage, atlasWidth: number, rect: SpriteFrameRef): Uint8ClampedArray | Uint8Array | null {
  if (img.kind === 'pixels') {
    const src = img.pixels;
    if (!(src instanceof Uint8Array)) return null;
    const out = new Uint8Array(rect.w * rect.h * RGBA);
    for (let y = 0; y < rect.h; y++) out.set(src.subarray(((rect.y + y) * atlasWidth + rect.x) * RGBA, ((rect.y + y) * atlasWidth + rect.x + rect.w) * RGBA), y * rect.w * RGBA);
    return out;
  }
  const ctx =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(rect.w, rect.h).getContext('2d', { willReadFrequently: true })
      : typeof document === 'undefined'
        ? null
        : Object.assign(document.createElement('canvas'), { width: rect.w, height: rect.h }).getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  ctx.drawImage(img.image as CanvasImageSource, -rect.x, -rect.y);
  return ctx.getImageData(0, 0, rect.w, rect.h).data;
}

/** The key cap as colour runs (see module comment). */
export class KeyCapShape {
  private constructor(
    /** Rows of the sprite, top first (transparent rows empty). */
    private readonly rows: readonly Row[],
    /** Width of the sprite's face [px]. */
    readonly faceWidth: number,
  ) {}

  /** Height of the cap's cell [px]. */
  get height(): number {
    return this.rows.length;
  }

  /** Last row with pixels (the cap's bottom edge sits on it). */
  get bottomRow(): number {
    for (let y = this.rows.length - 1; y >= 0; y--) {
      const r = this.rows[y] as Row;
      if (r.left.length > 0 || r.right.length > 0 || r.face.some((c) => c !== 0)) return y;
    }
    return 0;
  }

  /** The cap of `atlas`, or null when the atlas lacks the sprite or its pixels cannot be read. */
  static from(atlas: AtlasData): KeyCapShape | null {
    const s = atlas.manifest.sprites[KEY_CAP_SPRITE];
    const f = s?.frames[0];
    if (f === undefined) return null;
    const px = readRect(atlas.albedo, atlas.manifest.width, f);
    if (px === null) return null;
    const rows: Row[] = [];
    const x0 = KEY_CAP_RIM.left;
    const x1 = f.w - KEY_CAP_RIM.right;
    for (let y = 0; y < f.h; y++) {
      const colors: number[] = [];
      for (let x = 0; x < f.w; x++) {
        const o = (y * f.w + x) * RGBA;
        colors.push((px[o + ALPHA] ?? 0) === 0 ? 0 : paletteColor(px[o] ?? 0));
      }
      const face = colors.slice(x0, x1);
      rows.push({ left: runs(colors, 0, x0), face: face.every((c) => c === face[0]) ? face.slice(0, 1) : face, right: runs(colors, x1, f.w) });
    }
    return new KeyCapShape(rows, x1 - x0);
  }

  /** Width of a cap whose face holds ink `inkWidth` px wide [px]. */
  widthFor(inkWidth: number): number {
    return KEY_CAP_RIM.left + Math.max(this.faceWidth, inkWidth + 2 * KEY_CAP_PAD) + KEY_CAP_RIM.right;
  }

  /** Queues the cap `width` px wide with its cell's top-left corner at (x, y) [target px]. */
  draw(sink: RectSink, x: number, y: number, width: number): void {
    const face = width - KEY_CAP_RIM.left - KEY_CAP_RIM.right;
    const right = x + width - KEY_CAP_RIM.right - (this.faceWidth + KEY_CAP_RIM.left);
    for (let r = 0; r < this.rows.length; r++) {
      const row = this.rows[r] as Row;
      for (const run of row.left) sink.rect(x + run.x, y + r, run.w, 1, run.color);
      if (row.face.length === 1) {
        const c = row.face[0] as number;
        if (c !== 0) sink.rect(x + KEY_CAP_RIM.left, y + r, face, 1, c);
      } else {
        for (let i = 0; i < face; i++) {
          const c = row.face[i % row.face.length] as number;
          if (c !== 0) sink.rect(x + KEY_CAP_RIM.left + i, y + r, 1, 1, c);
        }
      }
      for (const run of row.right) sink.rect(right + run.x, y + r, run.w, 1, run.color);
    }
  }
}
