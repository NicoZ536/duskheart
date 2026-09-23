/**
 * The pixel font (MASTERPROMPT §5 "Schrift", §26 "eine Pixelschrift"): one descriptor that the DOM
 * overlay (CSS font, `src/ui/font.ts`) and the WebGL glyph atlas (`glyphAtlas.ts`) share.
 *
 * A pixel font is drawn on a grid of design pixels. `unitsPerEm / pixelsPerEm` font units make one
 * design pixel; `gridOriginX/Y` is the corner of pixel column 0 / row 0 (the row directly above the
 * baseline) in font units. The glyph atlas measures how much of every grid cell a glyph covers and
 * thresholds that at 50 %, so it reproduces the designed pixels exactly, even when the outlines are
 * slightly off the grid (see the spec below); `tests/unit/render/text-schrift.test.ts` checks every
 * constant against the font file.
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
/** Latin-1 supplement (no-break space … ÿ). */
const LATIN1_FIRST = 0xa0;
const LATIN1_LAST = 0xff;
/** Latin-1 characters Pixelify Sans lacks: broken bar and soft hyphen. */
const PIXELIFY_LATIN1_GAPS = '\u00a6\u00ad';
/** Typographic punctuation for German and English texts (quotes, dashes, ellipsis, minus, …). */
const PIXELIFY_PUNCTUATION = '–—‘’‚“”„•…‹›€™−';

/**
 * Pixelify Sans (OFL-1.1). Measured from the font file: one design pixel = 1000/11 font units, so
 * the native size is 11 px; columns start 60 units right of the pen, rows 12 units below the
 * baseline. Letters, digits and umlauts follow that grid within a third of a pixel, except the leg of
 * R and the dots of ä (half-pixel offsets; the 50 % threshold rounds them); capitals are 7 px, lowercase 5 px, umlaut and accent dots sit in rows 7–8,
 * descenders reach 2 rows below the baseline. Some punctuation is drawn off the grid (half-pixel
 * quotes and dashes, parentheses shifted by half a pixel, a diagonal ×); the threshold snaps it to
 * the nearest pixels. The DOM cannot render this font pixel-exactly (off-grid outlines, fractional
 * side bearings), see CREDITS.md and the M1-20 notes.
 */
export const PIXELIFY_SANS: PixelFontSpec = {
  family: 'Pixelify Sans',
  weight: 400,
  unitsPerEm: 1000,
  pixelsPerEm: 11,
  gridOriginX: 60,
  gridOriginY: -12,
  ascent: 9,
  descent: 2,
  lineGap: 1,
  charset: charRange(ASCII_FIRST, ASCII_LAST) + charRange(LATIN1_FIRST, LATIN1_LAST, PIXELIFY_LATIN1_GAPS) + PIXELIFY_PUNCTUATION,
  fallback: '?',
  halfPixelLetters: 'Rä',
  source: {
    npm: '@fontsource/pixelify-sans',
    version: '5.2.7',
    license: 'OFL-1.1',
    author: 'The Pixelify Sans Project Authors (https://github.com/eifetx/Pixelify-Sans)',
    files: ['files/pixelify-sans-latin-400-normal.woff', 'files/pixelify-sans-latin-ext-400-normal.woff'],
  },
};

/** The font every DOM and WebGL text uses. */
export const PIXEL_FONT: PixelFontSpec = PIXELIFY_SANS;

/** Line pitch in pixels (at scale 1). */
export function lineHeightOf(spec: PixelFontSpec): number {
  return spec.ascent + spec.descent + spec.lineGap;
}

/** Font units per design pixel. */
export function unitsPerPixel(spec: PixelFontSpec): number {
  return spec.unitsPerEm / spec.pixelsPerEm;
}

/** CSS `font` shorthand for the font at `scale` × its native size. */
export function cssFont(spec: PixelFontSpec, scale = 1): string {
  return `${spec.weight} ${spec.pixelsPerEm * scale}px "${spec.family}"`;
}

/** Whether every character of `text` is drawn by the font itself (line breaks count as covered). */
export function fontCovers(spec: PixelFontSpec, text: string): boolean {
  return uncoveredChars(spec, text).length === 0;
}

/** Characters of `text` the font does not draw (each once, in order of appearance). */
export function uncoveredChars(spec: PixelFontSpec, text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (ch === '\n' || spec.charset.includes(ch) || out.includes(ch)) continue;
    out.push(ch);
  }
  return out;
}
