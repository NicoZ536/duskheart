/**
 * Tiny 3×5 pixel font for labels on contact sheets (tools only; the game uses the OFL font, §5).
 * Text is upper-cased; German umlauts become AE/OE/UE/SS; unknown characters render as `?`.
 */
import type { Rgba, RgbaImage } from './image';

/** Glyph width and height in font pixels. */
export const GLYPH_W = 3;
export const GLYPH_H = 5;
/** Horizontal advance per character (glyph + 1 px gap). */
export const GLYPH_ADVANCE = GLYPH_W + 1;

/** Glyph rows (5 rows × 3 cells, `#` = ink). */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  ' ': ['...', '...', '...', '...', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
  ',': ['...', '...', '...', '.#.', '#..'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '-': ['...', '...', '###', '...', '...'],
  '_': ['...', '...', '...', '...', '###'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '(': ['.#.', '#..', '#..', '#..', '.#.'],
  ')': ['.#.', '..#', '..#', '..#', '.#.'],
  '*': ['#.#', '.#.', '###', '.#.', '#.#'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '=': ['...', '###', '...', '###', '...'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '[': ['##.', '#..', '#..', '#..', '##.'],
  ']': ['.##', '..#', '..#', '..#', '.##'],
  "'": ['.#.', '.#.', '...', '...', '...'],
  '·': ['...', '...', '.#.', '...', '...'],
};

function glyph(ch: string): readonly string[] {
  return GLYPHS[ch] ?? GLYPHS['?'] ?? [];
}

const TRANSLIT: Readonly<Record<string, string>> = { Ä: 'AE', Ö: 'OE', Ü: 'UE', ß: 'SS', '×': 'X', '→': '>', '…': '...' };

/** Upper-cases and transliterates `text` to the glyph set. */
export function normalizeLabel(text: string): string {
  return [...text.toUpperCase()].map((c) => TRANSLIT[c] ?? c).join('');
}

/** Width in image pixels of `text` at `scale`. */
export function textWidth(text: string, scale: number): number {
  const n = [...normalizeLabel(text)].length;
  return n === 0 ? 0 : (n * GLYPH_ADVANCE - 1) * scale;
}

/** Draws `text` with its top-left corner at (x, y). Returns the drawn width. */
export function drawText(img: RgbaImage, x: number, y: number, text: string, color: Rgba, scale = 1): number {
  let cx = x;
  for (const ch of normalizeLabel(text)) {
    const g = glyph(ch);
    for (let gy = 0; gy < GLYPH_H; gy++) {
      for (let gx = 0; gx < GLYPH_W; gx++) if (g[gy]?.charAt(gx) === '#') img.fillRect(cx + gx * scale, y + gy * scale, scale, scale, color);
    }
    cx += GLYPH_ADVANCE * scale;
  }
  return cx - x;
}
