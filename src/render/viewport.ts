/**
 * Interne Auflösung und scharfes Hochskalieren (MASTERPROMPT §4.2).
 * Höhe fest 270 px, Breite = 270 × Seitenverhältnis, begrenzt auf 360–640 px.
 */
export const INTERNAL_HEIGHT = 270;
export const MIN_INTERNAL_WIDTH = 360;
export const MAX_INTERNAL_WIDTH = 640;

export type ScaleMode = 'sharp' | 'pixelPerfect';

/** A screen size and the internal image size it must get. */
export interface ViewportExample {
  /** Device pixels. */
  readonly width: number;
  readonly height: number;
  readonly internalWidth: number;
  readonly internalHeight: number;
}

/** §4.2 examples: 1920×1080 → 480×270 · 2560×1440 → 480×270 · 3440×1440 → 640×270 · 3840×2160 → 480×270. */
export const VIEWPORT_EXAMPLES: readonly ViewportExample[] = [
  { width: 1920, height: 1080, internalWidth: 480, internalHeight: 270 },
  { width: 2560, height: 1440, internalWidth: 480, internalHeight: 270 },
  { width: 3440, height: 1440, internalWidth: 640, internalHeight: 270 },
  { width: 3840, height: 2160, internalWidth: 480, internalHeight: 270 },
];

export interface ViewportLayout {
  /** Internal render target size (without the 1 px subpixel border). */
  internalWidth: number;
  internalHeight: number;
  /** Integer nearest pre-scale factor. */
  integerScale: number;
  /** Final on-screen rectangle in device pixels (letter-/pillarboxed). */
  outX: number;
  outY: number;
  outWidth: number;
  outHeight: number;
}

/** Compute the internal resolution and on-screen placement for a canvas of `w`×`h` device pixels. */
export function computeViewport(w: number, h: number, mode: ScaleMode): ViewportLayout {
  return computeViewportInto({ internalWidth: 0, internalHeight: 0, integerScale: 1, outX: 0, outY: 0, outWidth: 0, outHeight: 0 }, w, h, mode);
}

/** `computeViewport` into a caller-owned record (the renderer's frame path allocates nothing). */
export function computeViewportInto(out: ViewportLayout, w: number, h: number, mode: ScaleMode): ViewportLayout {
  const width = Math.max(1, Math.floor(w));
  const height = Math.max(1, Math.floor(h));
  const aspect = width / height;
  const internalWidth = Math.min(MAX_INTERNAL_WIDTH, Math.max(MIN_INTERNAL_WIDTH, Math.round(INTERNAL_HEIGHT * aspect)));
  const internalHeight = INTERNAL_HEIGHT;
  const fit = Math.min(width / internalWidth, height / internalHeight);
  const integerScale = Math.max(1, Math.floor(fit));
  let outWidth: number;
  let outHeight: number;
  if (mode === 'pixelPerfect') {
    outWidth = internalWidth * integerScale;
    outHeight = internalHeight * integerScale;
  } else {
    outWidth = Math.round(internalWidth * fit);
    outHeight = Math.round(internalHeight * fit);
  }
  out.internalWidth = internalWidth;
  out.internalHeight = internalHeight;
  out.integerScale = integerScale;
  out.outX = Math.floor((width - outWidth) / 2);
  out.outY = Math.floor((height - outHeight) / 2);
  out.outWidth = outWidth;
  out.outHeight = outHeight;
  return out;
}
