/**
 * The pixel font (MASTERPROMPT §5 "Schrift", §26 "eine Pixelschrift"): one descriptor that the DOM
 * overlay (CSS font, `src/ui/font.ts`) and the WebGL glyph atlas (`glyphAtlas.ts`) share.
 *
 * A pixel font is drawn on a grid of design pixels. `unitsPerEm / pixelsPerEm` font units make one
 * design pixel; `gridOriginX/Y` is the corner of pixel column 0 / row 0 (the row directly above the
 * baseline) in font units. The glyph atlas measures how much of every grid cell a glyph covers and
 * thresholds that at 50 %, so it reproduces the designed pixels exactly (a font drawn off its grid
 * would be rounded to whole pixels by that threshold); `tests/unit/render/text-schrift.test.ts`
 * checks every constant against the font file and bakes the atlas from its outlines.
 */

/** Where the font comes from (CREDITS.md). */
export interface PixelFontSource {
  readonly npm: string;
  readonly version: string;
  readonly license: 'OFL-1.1';
  readonly author: string;
  /** Font files of the package that together cover `charset` (relative to the package root). */
  readonly files: readonly string[];
}

/**
 * A face of our own that draws some characters instead of the main font: it comes first in the CSS
 * family list and its `@font-face` is limited to these characters by `unicode-range`
 * (`tools/assets/truetype.ts`, embedded in `src/generated/ui-kit.css`), so the DOM and the Canvas2D
 * bake pick it for exactly them.
 */
export interface PixelFontSupplement {
  /** CSS family name (`@font-face` in `src/generated/ui-kit.css`). */
  readonly family: string;
  /** Characters it draws (all within `charset`). */
  readonly chars: string;
}

export interface PixelFontSpec {
  /** CSS family name, as declared by the package's stylesheet. */
  readonly family: string;
  /** CSS font weight of the face in use. */
  readonly weight: number;
  /** Font units per em (`head.unitsPerEm`). */
  readonly unitsPerEm: number;
  /** Native size: the CSS font size in px at which one design pixel covers one pixel. */
  readonly pixelsPerEm: number;
  /** Left edge of design pixel column 0 relative to the pen position [font units]. */
  readonly gridOriginX: number;
  /** Bottom edge of design pixel row 0 relative to the baseline [font units, y up]. */
  readonly gridOriginY: number;
  /** Pixel rows above the baseline a line reserves (tallest glyph: accented capitals). */
  readonly ascent: number;
  /** Pixel rows below the baseline a line reserves (descenders). */
  readonly descent: number;
  /** Empty pixel rows between two lines. */
  readonly lineGap: number;
  /** Every character the font draws; others are replaced by `fallback`. */
  readonly charset: string;
  /** Drawn instead of a character outside `charset`. */
  readonly fallback: string;
  /**
   * Letters and digits whose outline has half-pixel details off the design grid (the 50 % threshold
   * rounds them to whole pixels). Empty for a font drawn exactly on its grid.
   */
  readonly halfPixelLetters: string;
  /**
   * Characters the font has no glyph for that are drawn with the glyph of another character: the
   * no-break space (between a number and its unit) with the space. The browser's text shaper does the
   * same in the DOM (HarfBuzz falls back to U+0020 for Unicode spaces a font lacks), so both advance
   * alike. Absent: none.
   */
  readonly substitutes?: Readonly<Record<string, string>>;
  /** Own face drawing some characters in place of the main font. Absent: none. */
  readonly supplement?: PixelFontSupplement;
  readonly source: PixelFontSource;
}

/** Characters `first`…`last` (code points, inclusive) without those in `except`. */
export function charRange(first: number, last: number, except = ''): string {
  let out = '';
  for (let c = first; c <= last; c++) {
    const ch = String.fromCodePoint(c);
    if (!except.includes(ch)) out += ch;
  }
  return out;
}

/** First and last printable ASCII character. */
const ASCII_FIRST = 0x20;
const ASCII_LAST = 0x7e;
/** Latin-1 supplement from the inverted exclamation mark to ÿ (the font has no no-break space). */
const LATIN1_FIRST = 0xa1;
const LATIN1_LAST = 0xff;
/** The soft hyphen: invisible, the font has no glyph for it. */
const SOFT_HYPHEN = '\u00ad';
/** Typographic punctuation for German and English texts (dashes, quotes, bullet, ellipsis, per mille, primes, ™). */
const TYPOGRAPHIC_PUNCTUATION = '–—‘’‚“”„•…‰′″™';

/**
 * Fusion Pixel 10px Proportional SC (OFL-1.1, TakWolf). Measured from the font file: 1000 units per
 * em, every outline point lies on a multiple of 100 units – one design pixel = 100 units, so the
 * native size is 10 px – and the grid starts exactly at the pen and the baseline. Capitals and
 * digits are 7 px high, lowercase 5 px; umlaut dots sit in row 8 (one empty row above the capital),
 * accents of capitals reach row 9, the ring of Å row 10; descenders reach 2 rows below the baseline.
 * Advances are whole pixels. 5 and S differ (flat top with a corner vs a round bowl), × is a 5 × 5
 * diagonal cross, „ and ‚ are 1-px commas on the baseline.
 *
 * The font is made for Simplified Chinese: its high quotes, apostrophe, middle dot, ellipsis and
 * bullet are full-width (10 px, centred, the ellipsis as ⋯ at mid height), which tears Latin text
 * apart („Funke’ s“). The supplement `DH Satzzeichen` (`assets-src/schrift/satzzeichen.ts`) draws
 * these seven characters with Latin spacing on the same grid and line metrics.
 *
 * Line metrics follow the DOM: the kit sets 12 px line pitch per 10 px of font size; the font's line
 * box (ascent 1200, descent 400 units = 16 px) is centred in it, so the baseline lies 10 px below the
 * top of every line at any integer scale – ascent 10, descent 2, no gap. The ring of Å (row 10) is the
 * only ink above that; it overlaps the last row of the line above (the descender row, which Å never
 * meets in German or English text).
 */
export const FUSION_PIXEL_10: PixelFontSpec = {
  family: 'Fusion Pixel 10px Proportional SC',
  weight: 400,
  unitsPerEm: 1000,
  pixelsPerEm: 10,
  gridOriginX: 0,
  gridOriginY: 0,
  ascent: 10,
  descent: 2,
  lineGap: 0,
  charset: charRange(ASCII_FIRST, ASCII_LAST) + charRange(LATIN1_FIRST, LATIN1_LAST, SOFT_HYPHEN) + TYPOGRAPHIC_PUNCTUATION,
  fallback: '?',
  halfPixelLetters: '',
  substitutes: { '\u00a0': ' ' },
  supplement: { family: 'DH Satzzeichen', chars: '·‘’“”•…' },
  source: {
    npm: '@fontsource/fusion-pixel-10px-proportional-sc',
    version: '5.3.0',
    license: 'OFL-1.1',
    author: 'TakWolf (https://takwolf.com)',
    files: ['files/fusion-pixel-10px-proportional-sc-latin-400-normal.woff'],
  },
};

/** The font every DOM and WebGL text uses. */
export const PIXEL_FONT: PixelFontSpec = FUSION_PIXEL_10;

/** Line pitch in pixels (at scale 1). */
export function lineHeightOf(spec: PixelFontSpec): number {
  return spec.ascent + spec.descent + spec.lineGap;
}

/** Font units per design pixel. */
export function unitsPerPixel(spec: PixelFontSpec): number {
  return spec.unitsPerEm / spec.pixelsPerEm;
}

/** CSS family list: the supplement (if any) before the main family. */
export function cssFamilies(spec: PixelFontSpec): string {
  return spec.supplement === undefined ? `"${spec.family}"` : `"${spec.supplement.family}", "${spec.family}"`;
}

/** CSS `font` shorthand for the font at `scale` × its native size. */
export function cssFont(spec: PixelFontSpec, scale = 1): string {
  return `${spec.weight} ${spec.pixelsPerEm * scale}px ${cssFamilies(spec)}`;
}

/** The character whose glyph draws `ch`: `ch` itself, its substitute, or `null` if the font draws neither. */
export function glyphCharOf(spec: PixelFontSpec, ch: string): string | null {
  if (spec.charset.includes(ch)) return ch;
  const sub = spec.substitutes?.[ch];
  return sub !== undefined && spec.charset.includes(sub) ? sub : null;
}

/** Whether every character of `text` is drawn by the font (itself or via a substitute; line breaks count as covered). */
export function fontCovers(spec: PixelFontSpec, text: string): boolean {
  return uncoveredChars(spec, text).length === 0;
}

/** Characters of `text` the font does not draw (each once, in order of appearance). */
export function uncoveredChars(spec: PixelFontSpec, text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (ch === '\n' || glyphCharOf(spec, ch) !== null || out.includes(ch)) continue;
    out.push(ch);
  }
  return out;
}
