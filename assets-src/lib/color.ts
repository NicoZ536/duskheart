/**
 * Farbmathematik der Asset-Pipeline: sRGB ↔ OKLab/OKLCH (Björn Ottosson, 2020) und die Suche der
 * nächsten Palettenfarbe. OKLab ist wahrnehmungsgleichmäßig; Farbtonwinkel und Abstände darin
 * entsprechen dem, was man sieht (Hue-Shift-Prüfung, Fremdfarben-Hinweise).
 */
import { flatPalette, hexToRgb } from '../palette';

/** 8-Bit-Kanalmaximum. */
const CHANNEL_MAX = 255;
/** sRGB-Transferfunktion: Schwelle des linearen Abschnitts (Eingang, 0…1). */
const SRGB_LINEAR_THRESHOLD = 0.04045;
/** sRGB-Transferfunktion: Steigung des linearen Abschnitts. */
const SRGB_LINEAR_SLOPE = 12.92;
/** sRGB-Transferfunktion: Offset des Potenzabschnitts. */
const SRGB_OFFSET = 0.055;
/** sRGB-Transferfunktion: Exponent des Potenzabschnitts. */
const SRGB_GAMMA = 2.4;
/** Vollkreis in Grad. */
const FULL_TURN_DEG = 360;
/** Halbkreis in Grad. */
const HALF_TURN_DEG = 180;

/** OKLab-Koordinaten: L Helligkeit 0…1, a Grün↔Rot, b Blau↔Gelb. */
export interface Oklab {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

/** OKLCH: Helligkeit, Buntheit (Chroma) und Farbtonwinkel in Grad (0…360). */
export interface Oklch {
  readonly L: number;
  readonly C: number;
  readonly h: number;
}

function srgbToLinear(channel: number): number {
  const c = channel / CHANNEL_MAX;
  return c <= SRGB_LINEAR_THRESHOLD ? c / SRGB_LINEAR_SLOPE : ((c + SRGB_OFFSET) / (1 + SRGB_OFFSET)) ** SRGB_GAMMA;
}

/** sRGB-Hexfarbe (`#rrggbb`) → OKLab. Matrizen aus der OKLab-Referenzimplementierung. */
export function hexToOklab(hex: string): Oklab {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = srgbToLinear(r8);
  const g = srgbToLinear(g8);
  const b = srgbToLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** sRGB-Hexfarbe → OKLCH (Farbtonwinkel in Grad, 0…360). */
export function hexToOklch(hex: string): Oklch {
  const { L, a, b } = hexToOklab(hex);
  const h = (Math.atan2(b, a) * HALF_TURN_DEG) / Math.PI;
  return { L, C: Math.hypot(a, b), h: (h + FULL_TURN_DEG) % FULL_TURN_DEG };
}

/** Kleinster Winkelabstand zweier Farbtöne in Grad (0…180). */
export function hueDistance(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % FULL_TURN_DEG;
  return d > HALF_TURN_DEG ? FULL_TURN_DEG - d : d;
}

/** Euklidischer Abstand in OKLab (≈ wahrgenommener Farbunterschied). */
export function oklabDistance(p: Oklab, q: Oklab): number {
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

let paletteLab: readonly Oklab[] | null = null;

/** OKLab-Werte aller 64 Palettenfarben (Index 0 ≙ Palettenindex 1). */
export function paletteOklab(): readonly Oklab[] {
  paletteLab ??= flatPalette().map(hexToOklab);
  return paletteLab;
}

/**
 * Palettenindex (1…64) der Farbe, die `target` in OKLab am nächsten liegt. `exclude` nimmt Indizes
 * aus der Suche; Gleichstand entscheidet der kleinere Index (deterministisch).
 */
export function nearestPaletteIndex(target: Oklab, exclude: ReadonlySet<number> = new Set()): number {
  const lab = paletteOklab();
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  lab.forEach((c, i) => {
    const index = i + 1;
    if (exclude.has(index)) return;
    const d = oklabDistance(c, target);
    if (d < bestDist) {
      bestDist = d;
      best = index;
    }
  });
  if (best === 0) throw new Error('nearestPaletteIndex: keine Palettenfarbe übrig');
  return best;
}
