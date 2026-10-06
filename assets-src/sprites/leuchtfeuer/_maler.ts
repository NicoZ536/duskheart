/**
 * Zeichenfläche der Leuchtfeuer-Sprites (Hilfsmodul, Strang F): Palettenindex und Emissiv je Pixel, Ellipsen-Test und die
 * Kontur `nacht.1` um das bisher Gezeichnete (4er-Nachbarschaft) – für Steinkörper, die von Regeln statt von Rastern
 * gezeichnet werden (Leuchtfeuer, Wegstein).
 */
import { paletteIndex } from '../../palette';
import { TRANSPARENT, type PixelFrameInput } from '../../lib/sprite';

export class Leinwand {
  readonly index: Uint8Array;
  readonly emissive: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.index = new Uint8Array(w * h);
    this.emissive = new Uint8Array(w * h);
  }

  /** Setzt einen Pixel; `ref` als `rampe.stufe`, mit `*` emissiv. */
  set(x: number, y: number, ref: string): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const leuchtet = ref.endsWith('*');
    this.index[yi * this.w + xi] = paletteIndex(leuchtet ? ref.slice(0, -1) : ref);
    this.emissive[yi * this.w + xi] = leuchtet ? 1 : 0;
  }

  belegt(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.index[y * this.w + x] !== TRANSPARENT;
  }

  /** Kontur `nacht.1` um alles, was jetzt gezeichnet ist (4er-Nachbarschaft). */
  kontur(): void {
    const k = paletteIndex('nacht.1');
    const rand: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.belegt(x, y)) continue;
        if (this.belegt(x + 1, y) || this.belegt(x - 1, y) || this.belegt(x, y + 1) || this.belegt(x, y - 1)) rand.push(y * this.w + x);
      }
    for (const p of rand) this.index[p] = k;
  }

  frame(): PixelFrameInput {
    return { index: Uint8Array.from(this.index), emissive: Uint8Array.from(this.emissive) };
  }
}

/** Ellipsen-Test an der Pixelmitte. */
export function inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x + 0.5 - cx) / rx;
  const dy = (y + 0.5 - cy) / ry;
  return dx * dx + dy * dy <= 1;
}
