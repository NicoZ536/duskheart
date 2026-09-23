/**
 * Interne Auflösung und scharfes Hochskalieren (MASTERPROMPT §4.2).
 * Höhe fest 270 px, Breite = 270 × Seitenverhältnis, begrenzt auf 360–640 px.
 */
export const INTERNAL_HEIGHT = 270;
export const MIN_INTERNAL_WIDTH = 360;
export const MAX_INTERNAL_WIDTH = 640;

export type ScaleMode = 'sharp' | 'pixelPerfect';

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
  return {
    internalWidth,
    internalHeight,
    integerScale,
    outX: Math.floor((width - outWidth) / 2),
    outY: Math.floor((height - outHeight) / 2),
    outWidth,
    outHeight,
  };
}
