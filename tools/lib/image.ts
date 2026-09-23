/** RGBA8 image buffer with the few drawing operations the asset tools need (sheets, atlases). */
import { encodePng } from './png';

export type Rgba = readonly [number, number, number, number];

/** Bytes per RGBA8 pixel. */
export const RGBA_BYTES = 4;
/** Fully opaque alpha. */
export const OPAQUE = 255;

export class RgbaImage {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * RGBA_BYTES);
  }

  /** Sets the pixel containing (x, y); fractional coordinates address the pixel they fall into. */
  setPixel(x: number, y: number, c: Rgba): void {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const i = (py * this.width + px) * RGBA_BYTES;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  /** Fills the pixels from ⌊x⌋, ⌊y⌋ up to (excluding) ⌊x + w⌋, ⌊y + h⌋. */
  fillRect(x: number, y: number, w: number, h: number, c: Rgba): void {
    const x1 = Math.min(this.width, Math.floor(x + w));
    const y1 = Math.min(this.height, Math.floor(y + h));
    for (let yy = Math.max(0, Math.floor(y)); yy < y1; yy++) {
      for (let xx = Math.max(0, Math.floor(x)); xx < x1; xx++) this.setPixel(xx, yy, c);
    }
  }

  /** One-pixel rectangle outline. */
  strokeRect(x: number, y: number, w: number, h: number, c: Rgba): void {
    this.fillRect(x, y, w, 1, c);
    this.fillRect(x, y + h - 1, w, 1, c);
    this.fillRect(x, y, 1, h, c);
    this.fillRect(x + w - 1, y, 1, h, c);
  }

  /**
   * Draws a `w`×`h` source through `pixel(x, y)` (null = keep background) with integer `scale`
   * (nearest neighbour, the pixel-art way).
   */
  drawScaled(dx: number, dy: number, w: number, h: number, scale: number, pixel: (x: number, y: number) => Rgba | null): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = pixel(x, y);
        if (c !== null) this.fillRect(dx + x * scale, dy + y * scale, scale, scale, c);
      }
    }
  }

  toPng(level?: number): Uint8Array {
    return encodePng(this.width, this.height, this.data, level);
  }
}

/** `#rrggbb` → opaque RGBA. */
export function hexRgba(hex: string): Rgba {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff, OPAQUE];
}
