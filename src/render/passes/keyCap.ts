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

/**
 * A run of equal colour in one row of the cap: start column, length, packed 0xRRGGBBAA colour and that colour's slot in
 * the cap's colour table (`KeyCapShape.colors`).
 */
interface Run {
  readonly x: number;
  readonly w: number;
  readonly color: number;
  readonly slot: number;
}

/** One row of the cap: runs of the left rim, the face (repeated when it stretches) and the right rim. */
interface Row {
  readonly left: readonly Run[];
  /** Colour per face column (repeated across the stretched face); a single colour for a plain face row. */
  readonly face: readonly number[];
  /** The face colours' slots in the colour table (−1: transparent). */
  readonly faceSlots: readonly number[];
  readonly right: readonly Run[];
}

/**
 * Something that queues solid rectangles (the pass's text batch), each in the colour `colors[index]`: a packed colour
 * above 2^30 is no small integer, and handed through a call it would be a new number per rectangle and frame (§30).
 */
export interface RectSink {
  rectFrom(x: number, y: number, width: number, height: number, colors: Uint32Array, index: number): void;
}

/** Colour of palette index `i` (1 … 64) as packed RGBA, 0 for transparent or unknown. */
function paletteColor(i: number): number {
  const hex = PALETTE_HEX[i - 1];
  return hex === undefined ? 0 : rgbaFromHex(hex);
}

/** Runs of equal colour in `colors[x0 … x1)` (0 = transparent, skipped); `slot` gives a colour's slot in the table. */
function runs(colors: readonly number[], x0: number, x1: number, slot: (color: number) => number): Run[] {
  const out: Run[] = [];
  let x = x0;
  while (x < x1) {
    const c = colors[x] ?? 0;
    let e = x + 1;
    while (e < x1 && colors[e] === c) e++;
    if (c !== 0) out.push({ x, w: e - x, color: c, slot: slot(c) });
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
/** Last row of `rows` with pixels (0 for an empty cap). */
function lastRowWithPixels(rows: readonly Row[]): number {
  for (let y = rows.length - 1; y >= 0; y--) {
    const r = rows[y] as Row;
    if (r.left.length > 0 || r.right.length > 0 || r.face.some((c) => c !== 0)) return y;
  }
  return 0;
}

export class KeyCapShape {
  /** Height of the cap's cell [px]. */
  readonly height: number;
  /** Last row with pixels (the cap's bottom edge sits on it): found once, a marker reads it every frame. */
  readonly bottomRow: number;

  private constructor(
    /** Rows of the sprite, top first (transparent rows empty). */
    private readonly rows: readonly Row[],
    /** Width of the sprite's face [px]. */
    readonly faceWidth: number,
    /** The cap's colours (packed RGBA), by slot. */
    private readonly colors: Uint32Array,
  ) {
    this.height = rows.length;
    this.bottomRow = lastRowWithPixels(rows);
  }

  /** The cap of `atlas`, or null when the atlas lacks the sprite or its pixels cannot be read. */
  static from(atlas: AtlasData): KeyCapShape | null {
    const s = atlas.manifest.sprites[KEY_CAP_SPRITE];
    const f = s?.frames[0];
    if (f === undefined) return null;
    const px = readRect(atlas.albedo, atlas.manifest.width, f);
    if (px === null) return null;
    const rows: Row[] = [];
    const table: number[] = [];
    const slot = (c: number): number => {
      const i = table.indexOf(c);
      if (i >= 0) return i;
      table.push(c);
      return table.length - 1;
    };
    const x0 = KEY_CAP_RIM.left;
    const x1 = f.w - KEY_CAP_RIM.right;
    for (let y = 0; y < f.h; y++) {
      const colors: number[] = [];
      for (let x = 0; x < f.w; x++) {
        const o = (y * f.w + x) * RGBA;
        colors.push((px[o + ALPHA] ?? 0) === 0 ? 0 : paletteColor(px[o] ?? 0));
      }
      const whole = colors.slice(x0, x1);
      const face = whole.every((c) => c === whole[0]) ? whole.slice(0, 1) : whole;
      rows.push({ left: runs(colors, 0, x0, slot), face, faceSlots: face.map((c) => (c === 0 ? -1 : slot(c))), right: runs(colors, x1, f.w, slot) });
    }
    return new KeyCapShape(rows, x1 - x0, Uint32Array.from(table));
  }

  /** Width of a cap whose face holds ink `inkWidth` px wide [px]. */
  widthFor(inkWidth: number): number {
    return KEY_CAP_RIM.left + Math.max(this.faceWidth, inkWidth + 2 * KEY_CAP_PAD) + KEY_CAP_RIM.right;
  }

  /** Queues the cap `width` px wide with its cell's top-left corner at (x, y) [target px]. */
  draw(sink: RectSink, x: number, y: number, width: number): void {
    const face = width - KEY_CAP_RIM.left - KEY_CAP_RIM.right;
    const right = x + width - KEY_CAP_RIM.right - (this.faceWidth + KEY_CAP_RIM.left);
    // Indexed loops: a marker is drawn once per frame, in code that stays in V8's baseline tier – an iterator per loop
    // would be new objects every frame (§30).
    // Colours by their slot in the table (no colour through a call).
    const colors = this.colors;
    for (let r = 0; r < this.rows.length; r++) {
      const row = this.rows[r] as Row;
      const left = row.left;
      for (let k = 0; k < left.length; k++) {
        const run = left[k] as Run;
        sink.rectFrom(x + run.x, y + r, run.w, 1, colors, run.slot);
      }
      const slots = row.faceSlots;
      if (slots.length === 1) {
        const c = slots[0] as number;
        if (c >= 0) sink.rectFrom(x + KEY_CAP_RIM.left, y + r, face, 1, colors, c);
      } else {
        for (let i = 0; i < face; i++) {
          const c = slots[i % slots.length] as number;
          if (c >= 0) sink.rectFrom(x + KEY_CAP_RIM.left + i, y + r, 1, 1, colors, c);
        }
      }
      const rightRuns = row.right;
      for (let k = 0; k < rightRuns.length; k++) {
        const run = rightRuns[k] as Run;
        sink.rectFrom(right + run.x, y + r, run.w, 1, colors, run.slot);
      }
    }
  }
}
