/**
 * Zeichenfläche für Generatoren (MASTERPROMPT §5 „Generatoren“): Palettenindex, Emissiv und
 * Materialflags je Pixel, dazu Formen (Rechteck, Ellipse, Linie, verformte Blobs), selektive Outline
 * und weiche Form-Schattierung (AO-artig: Ränder und Unterseite dunkler, keine harten
 * Richtungs-Highlights, §4.5). Zufall kommt ausschließlich aus dem übergebenen `Rng`.
 */
import type { Rng } from '../../src/engine/rng';
import { RAMPS, paletteIndex } from '../palette';
import { distanceToEdge } from './distance';
import { TRANSPARENT, type PixelFrameInput } from './sprite';

/** Farbe: `rampe.stufe` oder Palettenindex (1…64). */
export type Color = string | number;

function toIndex(color: Color): number {
  return typeof color === 'number' ? color : paletteIndex(color);
}

export interface PaintOptions {
  readonly emissive?: boolean;
  readonly material?: number;
}

export class PixelCanvas {
  readonly index: Uint8Array;
  readonly emissive: Uint8Array;
  readonly material: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.index = new Uint8Array(w * h);
    this.emissive = new Uint8Array(w * h);
    this.material = new Uint8Array(w * h);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Palettenindex bei (x, y); außerhalb 0. */
  get(x: number, y: number): number {
    return this.inside(x, y) ? (this.index[y * this.w + x] ?? TRANSPARENT) : TRANSPARENT;
  }

  set(x: number, y: number, color: Color, opts: PaintOptions = {}): void {
    if (!this.inside(x, y)) return;
    const p = y * this.w + x;
    this.index[p] = toIndex(color);
    this.emissive[p] = opts.emissive === true ? 1 : 0;
    this.material[p] = opts.material ?? 0;
  }

  clear(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    const p = y * this.w + x;
    this.index[p] = TRANSPARENT;
    this.emissive[p] = 0;
    this.material[p] = 0;
  }

  fillRect(x: number, y: number, w: number, h: number, color: Color, opts?: PaintOptions): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color, opts);
  }

  /** Füllt alle Pixel, deren Mittelpunkt in der Ellipse liegt. */
  fillEllipse(cx: number, cy: number, rx: number, ry: number, color: Color, opts?: PaintOptions): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, color, opts);
      }
    }
  }

  /** Bresenham-Linie (pixelgenau, ohne Doppelpixel). */
  line(x0: number, y0: number, x1: number, y1: number, color: Color, opts?: PaintOptions): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.set(x, y, color, opts);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** Malt jede gesetzte Maskenposition mit `color`. */
  fillMask(mask: Uint8Array, color: Color, opts?: PaintOptions): void {
    mask.forEach((v, p) => {
      if (v > 0) this.set(p % this.w, Math.floor(p / this.w), color, opts);
    });
  }

  /** Deckungsmaske (1 = Pixel gesetzt). */
  mask(): Uint8Array {
    return Uint8Array.from(this.index, (v) => (v === TRANSPARENT ? 0 : 1));
  }

  /**
   * Selektive Outline (§4.5): jedes transparente Pixel, das seitlich an ein gesetztes grenzt, erhält
   * die dunkelste Stufe der Rampe des Nachbarn – dunkle Rampenfarbe statt reinem Schwarz. Mit
   * `color` wird stattdessen eine feste Farbe gesetzt.
   */
  outline(color?: Color): void {
    const src = Uint8Array.from(this.index);
    const fixed = color === undefined ? null : toIndex(color);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src[y * this.w + x] !== TRANSPARENT) continue;
        let neighbour = TRANSPARENT;
        for (const [nx, ny] of [
          [x, y + 1],
          [x, y - 1],
          [x - 1, y],
          [x + 1, y],
        ] as const) {
          if (this.inside(nx, ny) && src[ny * this.w + nx] !== TRANSPARENT) {
            neighbour = src[ny * this.w + nx] ?? TRANSPARENT;
            break;
          }
        }
        if (neighbour === TRANSPARENT) continue;
        this.set(x, y, fixed ?? darkestOfRamp(neighbour));
      }
    }
  }

  /**
   * Weiche Form-Schattierung einer Maske mit den Stufen `steps` (dunkel → hell): Helligkeit aus
   * Abstand zum Rand (AO) und Höhe im Objekt (Unterseite dunkler). Ergebnis ohne Dither, in klaren
   * Farbclustern.
   */
  shadeMask(mask: Uint8Array, steps: readonly Color[], opts: ShadeOptions = {}): void {
    if (steps.length === 0) return;
    const dist = distanceToEdge(mask, this.w, this.h);
    let maxDist = 0;
    let top = this.h;
    let bottom = -1;
    mask.forEach((v, p) => {
      if (v === 0) return;
      maxDist = Math.max(maxDist, dist[p] ?? 0);
      const y = Math.floor(p / this.w);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    });
    const span = Math.max(1, bottom - top);
    const aoWeight = opts.aoWeight ?? DEFAULT_AO_WEIGHT;
    mask.forEach((v, p) => {
      if (v === 0) return;
      const y = Math.floor(p / this.w);
      const ao = maxDist > 0 ? Math.min(1, ((dist[p] ?? 0) - 0.5) / Math.max(1, maxDist - 0.5)) : 1;
      const vertical = 1 - (y - top) / span;
      const t = Math.max(0, Math.min(1, aoWeight * ao + (1 - aoWeight) * vertical + (opts.bias ?? 0)));
      const step = steps[Math.min(steps.length - 1, Math.floor(t * steps.length))] ?? steps[0] ?? TRANSPARENT;
      this.set(p % this.w, Math.floor(p / this.w), step, opts.paint);
    });
  }

  /** Pixelpuffer für `spriteFromPixels`. */
  toFrame(): PixelFrameInput {
    return { index: Uint8Array.from(this.index), emissive: Uint8Array.from(this.emissive), material: Uint8Array.from(this.material) };
  }
}

export interface ShadeOptions {
  /** Anteil der Randabdunklung (AO) gegenüber dem Verlauf oben → unten, 0…1. */
  readonly aoWeight?: number;
  /** Verschiebung Richtung hell (+) oder dunkel (−), −1…1. */
  readonly bias?: number;
  readonly paint?: PaintOptions;
}

/** Standardgewicht der Randabdunklung in `shadeMask`. */
const DEFAULT_AO_WEIGHT = 0.6;

/** Dunkelste Stufe der Rampe, zu der Palettenindex `index` gehört. */
export function darkestOfRamp(index: number): number {
  let start = 1;
  for (const ramp of RAMPS) {
    if (index >= start && index < start + ramp.colors.length) return start;
    start += ramp.colors.length;
  }
  return index;
}

/** Vollwinkel im Bogenmaß. */
const TAU = Math.PI * 2;
/** Anzahl der Stützstellen des Randrauschens eines Blobs. */
const BLOB_NODES = 12;

/**
 * Verformte Ellipse: Der Radius schwankt je Winkel um bis zu `jitter` (Anteil), über Stützstellen
 * weich (Kosinus) interpoliert – runde, organische Umrisse ohne Zacken. Liefert eine Maske.
 */
export function blobMask(rng: Rng, w: number, h: number, cx: number, cy: number, rx: number, ry: number, jitter: number): Uint8Array {
  const nodes = Array.from({ length: BLOB_NODES }, () => 1 + rng.float(-jitter, jitter));
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const angle = (Math.atan2(dy, dx) + TAU) % TAU;
      const pos = (angle / TAU) * BLOB_NODES;
      const i0 = Math.floor(pos) % BLOB_NODES;
      const i1 = (i0 + 1) % BLOB_NODES;
      const t = pos - Math.floor(pos);
      const smooth = (1 - Math.cos(t * Math.PI)) / 2;
      const r = (nodes[i0] ?? 1) * (1 - smooth) + (nodes[i1] ?? 1) * smooth;
      if (dx * dx + dy * dy <= r * r) mask[y * w + x] = 1;
    }
  }
  return mask;
}
