/**
 * Pixel sharpness of a presented frame (MASTERPROMPT §4.2 "scharf": ganzzahlig per Nearest
 * vorskalieren, dann linear auf Zielgröße – keine Pixelverzerrung, kein Matsch), checked on a
 * screenshot: every internal pixel must appear as a uniform block of screen pixels.
 *
 * - Integer scale (output = internal × N): each internal pixel is exactly an N×N block of one colour.
 * - Other scales: the linear step may blend the one screen pixel at each block edge; the block shrunk
 *   by one pixel on every side must be one colour.
 * - The bars beside or above the image are black.
 * A frame that is uniform everywhere would pass trivially, so the report also counts neighbouring
 * blocks of different colour (the caller demands enough of them).
 */

/** Where the internal image lies on the screenshot (the renderer's `ViewportLayout`). */
export interface PresentedLayout {
  readonly internalWidth: number;
  readonly internalHeight: number;
  readonly outX: number;
  readonly outY: number;
  readonly outWidth: number;
  readonly outHeight: number;
}

export interface RgbaFrame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface SharpnessReport {
  /** Screen pixels per internal pixel (horizontal; the vertical scale differs by rounding only). */
  readonly scale: number;
  /** Whether the scale is a whole number (then blocks are checked in full). */
  readonly integerScale: boolean;
  /** Internal pixels checked and how many of them showed as a uniform block. */
  readonly blocks: number;
  readonly uniformBlocks: number;
  /** Horizontally or vertically adjacent blocks with different colours. */
  readonly contrastEdges: number;
  /** Bar pixels (outside the image) that are not black. */
  readonly litBarPixels: number;
  /** First internal pixel whose block is not uniform (null if all are). */
  readonly firstBlur: { readonly x: number; readonly y: number } | null;
}

const RGBA = 4;
/** Tolerance for "whole number" and block edges (floating point of out / internal). */
const SCALE_EPSILON = 1e-6;
/** The output size is rounded to whole pixels: both axes may differ by up to one pixel over the image. */
const ROUNDING_PX = 1;

/** Checks that `frame` shows the internal image of `layout` as sharp square pixels; `tolerance` per channel. */
export function checkSharpness(frame: RgbaFrame, layout: PresentedLayout, tolerance = 0): SharpnessReport {
  const s = layout.outWidth / layout.internalWidth;
  const sy = layout.outHeight / layout.internalHeight;
  if (Math.abs(s - sy) * layout.internalWidth > ROUNDING_PX) throw new Error(`Seitenverhältnis verzerrt: ${s} × ${sy}`);
  if (layout.outX + layout.outWidth > frame.width || layout.outY + layout.outHeight > frame.height) throw new Error('Bildrechteck liegt außerhalb des Screenshots');
  const integerScale = Math.abs(s - Math.round(s)) < SCALE_EPSILON && Math.abs(sy - Math.round(sy)) < SCALE_EPSILON;
  const margin = integerScale ? 0 : 1;
  const px = frame.rgba;
  const differs = (a: number, b: number): boolean =>
    Math.abs((px[a] ?? 0) - (px[b] ?? 0)) > tolerance || Math.abs((px[a + 1] ?? 0) - (px[b + 1] ?? 0)) > tolerance || Math.abs((px[a + 2] ?? 0) - (px[b + 2] ?? 0)) > tolerance;
  const at = (x: number, y: number): number => (y * frame.width + x) * RGBA;
  // Colour of every block (its interior's first pixel) for the contrast count.
  const blockColour = new Int32Array(layout.internalWidth * layout.internalHeight);
  let uniformBlocks = 0;
  let firstBlur: { x: number; y: number } | null = null;
  for (let j = 0; j < layout.internalHeight; j++) {
    const y0 = Math.ceil(layout.outY + j * sy + margin - SCALE_EPSILON);
    const y1 = Math.floor(layout.outY + (j + 1) * sy - margin + SCALE_EPSILON);
    for (let i = 0; i < layout.internalWidth; i++) {
      const x0 = Math.ceil(layout.outX + i * s + margin - SCALE_EPSILON);
      const x1 = Math.floor(layout.outX + (i + 1) * s - margin + SCALE_EPSILON);
      const ref = at(x0, y0);
      blockColour[j * layout.internalWidth + i] = ref;
      let uniform = x1 > x0 && y1 > y0;
      for (let y = y0; y < y1 && uniform; y++) for (let x = x0; x < x1; x++) if (differs(at(x, y), ref)) uniform = false;
      if (uniform) uniformBlocks++;
      else firstBlur ??= { x: i, y: j };
    }
  }
  let contrastEdges = 0;
  for (let j = 0; j < layout.internalHeight; j++) {
    for (let i = 0; i < layout.internalWidth; i++) {
      const c = blockColour[j * layout.internalWidth + i] ?? 0;
      if (i + 1 < layout.internalWidth && differs(c, blockColour[j * layout.internalWidth + i + 1] ?? 0)) contrastEdges++;
      if (j + 1 < layout.internalHeight && differs(c, blockColour[(j + 1) * layout.internalWidth + i] ?? 0)) contrastEdges++;
    }
  }
  let litBarPixels = 0;
  for (let y = 0; y < frame.height; y++) {
    const inRows = y >= layout.outY && y < layout.outY + layout.outHeight;
    for (let x = 0; x < frame.width; x++) {
      if (inRows && x >= layout.outX && x < layout.outX + layout.outWidth) continue;
      const o = at(x, y);
      if ((px[o] ?? 0) > tolerance || (px[o + 1] ?? 0) > tolerance || (px[o + 2] ?? 0) > tolerance) litBarPixels++;
    }
  }
  return { scale: s, integerScale, blocks: layout.internalWidth * layout.internalHeight, uniformBlocks, contrastEdges, litBarPixels, firstBlur };
}
