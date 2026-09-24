/**
 * Canvas2D rasteriser of the pixel font (browser only). Each glyph is drawn at `OVERSAMPLE` × its
 * native size; the coverage of every design-pixel cell is the mean alpha of its `OVERSAMPLE ×
 * OVERSAMPLE` block – the exact anti-aliased coverage at the native size, which the atlas then
 * thresholds hard. Drawing large makes the result independent of how the browser positions and hints
 * tiny glyphs (Chromium snaps pen positions to whole pixels, so an off-grid outline could not be
 * aligned at 1×). Advances are measured at the native size, as the DOM lays the text out. The CSS
 * font names the whole family list (`cssFont`), so the supplement face draws its characters here as
 * in the DOM.
 */
import type { CellWindow, GlyphRasterizer } from './glyphAtlas';
import { cssFont, unitsPerPixel, type PixelFontSpec } from './pixelFont';

/** Drawing scale of the bake: every design pixel becomes an 8 × 8 block. */
export const OVERSAMPLE = 8;
/** Canvas pixels per design-pixel cell. */
const CELL_PIXELS = OVERSAMPLE * OVERSAMPLE;
/** Empty pixels around the drawn window. */
const CANVAS_MARGIN = 4;
/** Bytes per RGBA pixel of `getImageData` and the offset of alpha in it. */
const RGBA_BYTES = 4;
const ALPHA_OFFSET = 3;

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Creates the 2D context for a canvas of the given size (OffscreenCanvas where available). */
export type CanvasFactory = (width: number, height: number) => Ctx2D;

function defaultFactory(width: number, height: number): Ctx2D {
  const ctx =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
      : Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('Glyphenatlas: kein Canvas2D-Kontext verfügbar');
  return ctx;
}

/** Rasteriser that draws glyphs of `spec` with Canvas2D (the font must be loaded, see `loadPixelFont`). */
export function createCanvasRasterizer(spec: PixelFontSpec, factory: CanvasFactory = defaultFactory): GlyphRasterizer {
  const upp = unitsPerPixel(spec);
  /** Canvas pixels per font unit at the bake size. */
  const pxPerUnit = (spec.pixelsPerEm * OVERSAMPLE) / spec.unitsPerEm;
  const measure = factory(1, 1);
  measure.font = cssFont(spec);
  let ctx: Ctx2D | null = null;
  let win: CellWindow | null = null;
  let penX = 0;
  let baseY = 0;
  const prepare = (w: CellWindow): Ctx2D => {
    if (ctx !== null && win !== null && win.cols === w.cols && win.rows === w.rows && win.colMin === w.colMin && win.rowMax === w.rowMax) return ctx;
    const width = w.cols * OVERSAMPLE + 2 * CANVAS_MARGIN;
    const height = w.rows * OVERSAMPLE + 2 * CANVAS_MARGIN;
    const c = factory(width, height);
    c.font = cssFont(spec, OVERSAMPLE);
    c.fillStyle = '#ffffff';
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    // Cell (colMin, rowMax) starts at the margin: pen and baseline follow from the grid origin.
    penX = CANVAS_MARGIN - Math.round((spec.gridOriginX + w.colMin * upp) * pxPerUnit);
    baseY = CANVAS_MARGIN + Math.round((spec.gridOriginY + (w.rowMax + 1) * upp) * pxPerUnit);
    ctx = c;
    win = w;
    return c;
  };
  return {
    advance(ch) {
      return measure.measureText(ch).width;
    },
    sample(ch, w) {
      const c = prepare(w);
      const width = c.canvas.width;
      const height = c.canvas.height;
      c.clearRect(0, 0, width, height);
      c.fillText(ch, penX, baseY);
      const img = c.getImageData(0, 0, width, height).data;
      const out = new Uint8Array(w.cols * w.rows);
      for (let y = 0; y < w.rows; y++) {
        // Top edge of the cell: the upper boundary of design row `rowMax − y`.
        const top = Math.round(baseY - (spec.gridOriginY + (w.rowMax - y + 1) * upp) * pxPerUnit);
        for (let x = 0; x < w.cols; x++) {
          const left = Math.round(penX + (spec.gridOriginX + (w.colMin + x) * upp) * pxPerUnit);
          let sum = 0;
          for (let by = 0; by < OVERSAMPLE; by++) {
            const rowStart = ((top + by) * width + left) * RGBA_BYTES + ALPHA_OFFSET;
            for (let bx = 0; bx < OVERSAMPLE; bx++) sum += img[rowStart + bx * RGBA_BYTES] ?? 0;
          }
          out[y * w.cols + x] = Math.round(sum / CELL_PIXELS);
        }
      }
      return out;
    },
  };
}

/** The subset of `FontFaceSet` the loader needs. */
export interface FontLoader {
  load(font: string, text?: string): Promise<unknown>;
  check(font: string, text?: string): boolean;
}

/**
 * Loads the web font faces that cover `spec.charset` – the main font and the supplement, whose
 * `@font-face` is limited to its characters by `unicode-range` – and fails if the browser still
 * lacks them: baking a fallback font would give wrong glyphs.
 */
export async function loadPixelFont(spec: PixelFontSpec, fonts: FontLoader): Promise<void> {
  const font = cssFont(spec);
  await fonts.load(font, spec.charset);
  if (!fonts.check(font, spec.charset)) {
    const supplement = spec.supplement === undefined ? '' : ` und ${spec.supplement.family} (src/generated/ui-kit.css aus npm run assets)`;
    throw new Error(`Schrift ${spec.family}${supplement} ist nicht geladen (Stylesheet von ${spec.source.npm} eingebunden?)`);
  }
}
