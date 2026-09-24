/**
 * Glyph atlas of the pixel font (MASTERPROMPT §5 "Dieselbe Schrift für WebGL-Text: zur Laufzeit per
 * Canvas2D in einen Glyphen-Atlas backen, Alpha hart schwellen → pixelscharf").
 *
 * A `GlyphRasterizer` (Canvas2D in the browser, `canvasRasterizer.ts`; a bitmap stand-in in tests)
 * reports the coverage of every design-pixel cell of a glyph. The atlas thresholds it hard
 * (≥ 50 % = ink), trims the bitmap to its ink, snaps it to whole pixels relative to pen and
 * baseline and packs it into an R8 texture (0 or 255) with a one-texel transparent ring, so the text
 * shader can draw shadows and outlines from the neighbours. Glyphs are baked on first use; every
 * change bumps `version`, so a GPU copy knows when to re-upload.
 */
import { glyphCharOf, lineHeightOf, unitsPerPixel, type PixelFontSpec } from './pixelFont';

/** A rectangular window of design-pixel cells: columns right of the grid origin, rows up from the baseline row. */
export interface CellWindow {
  /** Leftmost column. */
  readonly colMin: number;
  readonly cols: number;
  /** Topmost row (row 0 is the row directly above the baseline). */
  readonly rowMax: number;
  readonly rows: number;
}

/** Rasterises single glyphs of one font. */
export interface GlyphRasterizer {
  /** Advance width of `ch` at the native size [px, may be fractional]. */
  advance(ch: string): number;
  /**
   * Coverage 0…255 of every cell of `window` (row-major, top row first, `cols × rows` values):
   * the share of the cell the glyph outline covers at the native size.
   */
  sample(ch: string, window: CellWindow): Uint8Array;
}

/** One baked glyph. Bitmap coordinates are whole pixels at scale 1. */
export interface Glyph {
  readonly char: string;
  /** Pen advance [px]. */
  readonly advance: number;
  /** Left edge of the bitmap relative to the pen [px]. */
  readonly offsetX: number;
  /** Top edge of the bitmap relative to the baseline [px, y down: negative = above]. */
  readonly offsetY: number;
  /** Bitmap size [px]; 0 × 0 for blank glyphs (space). */
  readonly width: number;
  readonly height: number;
  /** Top-left texel of the padded cell (the bitmap starts one texel right and down). */
  readonly atlasX: number;
  readonly atlasY: number;
}

export interface FontMetrics {
  /** Rows above the baseline a line reserves. */
  readonly ascent: number;
  /** Rows below the baseline a line reserves. */
  readonly descent: number;
  readonly lineGap: number;
  /** Line pitch [px] = ascent + descent + lineGap. */
  readonly lineHeight: number;
}

export interface GlyphAtlasStats {
  /** Baked glyphs. */
  readonly glyphs: number;
  /**
   * Cells with 25–75 % coverage: the outline does not follow the pixel grid there (half-pixel
   * details, diagonals), the threshold decides. 0 for a font drawn exactly on its grid.
   */
  readonly ambiguousSamples: number;
  /** Glyphs whose ink touched the border of the sampling window (would be cut off). */
  readonly clipped: readonly string[];
  /** Characters requested that the font does not draw (shown as the fallback glyph). */
  readonly missing: readonly string[];
}

/** Coverage from which a cell counts as ink (hard threshold at 50 %). */
export const ALPHA_THRESHOLD = 128;
/** Texel value of ink in the atlas. */
export const INK = 255;
/** Coverage band that counts as ambiguous (between 25 % and 75 %). */
const AMBIGUOUS_LOW = 64;
const AMBIGUOUS_HIGH = 192;
/** Transparent texels around every glyph bitmap (room for shadow and outline samples). */
export const GLYPH_PADDING = 1;
/** Extra cells sampled around the expected glyph box, to detect ink outside it. */
const WINDOW_MARGIN = 2;
/** Default atlas width [texels]. */
export const DEFAULT_ATLAS_WIDTH = 256;
/** Initial atlas height [texels]; doubles when full. */
const INITIAL_ATLAS_HEIGHT = 64;
/** Largest atlas side WebGL2 guarantees (`MAX_TEXTURE_SIZE` ≥ 2048). */
export const MAX_ATLAS_SIZE = 2048;

/** The sampling window used for every glyph of `spec`: two em wide, ascent + descent high, plus margins. */
export function glyphWindow(spec: PixelFontSpec): CellWindow {
  const cols = 2 * spec.pixelsPerEm + 2 * WINDOW_MARGIN;
  return { colMin: -WINDOW_MARGIN, cols, rowMax: spec.ascent - 1 + WINDOW_MARGIN, rows: spec.ascent + spec.descent + 2 * WINDOW_MARGIN };
}

/** Whole-pixel shift of the design grid relative to pen and baseline: [columns, rows]. */
export function gridSnap(spec: PixelFontSpec): readonly [number, number] {
  const upp = unitsPerPixel(spec);
  // `+ 0` turns a rounded −0 into 0 (offsets are compared with Object.is in tests and caches).
  return [Math.round(spec.gridOriginX / upp) + 0, Math.round(spec.gridOriginY / upp) + 0];
}

/** Result of thresholding one glyph (before packing). */
export interface GlyphBitmap {
  readonly advance: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  /** 0/INK per pixel, row-major. */
  readonly bits: Uint8Array;
  readonly ambiguous: number;
  readonly clipped: boolean;
}

/** Thresholds the sampled cells of `ch` into a trimmed bitmap placed on whole pixels. */
export function bakeGlyph(spec: PixelFontSpec, rasterizer: GlyphRasterizer, ch: string): GlyphBitmap {
  const win = glyphWindow(spec);
  const alpha = rasterizer.sample(ch, win);
  if (alpha.length !== win.cols * win.rows) throw new Error(`Glyphenatlas: Rasterer lieferte ${alpha.length} Werte für „${ch}“, erwartet ${win.cols * win.rows}`);
  let minX = win.cols;
  let minY = win.rows;
  let maxX = -1;
  let maxY = -1;
  let ambiguous = 0;
  for (let y = 0; y < win.rows; y++) {
    for (let x = 0; x < win.cols; x++) {
      const a = alpha[y * win.cols + x] ?? 0;
      if (a > AMBIGUOUS_LOW && a < AMBIGUOUS_HIGH) ambiguous++;
      if (a < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const advance = Math.round(rasterizer.advance(ch));
  if (maxX < 0) return { advance, offsetX: 0, offsetY: 0, width: 0, height: 0, bits: new Uint8Array(0), ambiguous, clipped: false };
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if ((alpha[(minY + y) * win.cols + minX + x] ?? 0) >= ALPHA_THRESHOLD) bits[y * width + x] = INK;
  }
  const [snapX, snapY] = gridSnap(spec);
  // Window column x is design column colMin + x; window row y is design row rowMax − y (row 0 lies
  // directly above the baseline, i.e. at y = −1 in y-down pixel coordinates).
  const topRow = win.rowMax - minY + snapY;
  const clipped = minX === 0 || minY === 0 || maxX === win.cols - 1 || maxY === win.rows - 1;
  return { advance, offsetX: win.colMin + minX + snapX, offsetY: -topRow - 1, width, height, bits, ambiguous, clipped };
}

/** Code point of a one-character string (0 for the empty string). */
function codeOf(ch: string): number {
  return ch.codePointAt(0) ?? 0;
}

export interface GlyphAtlasOptions {
  /** Atlas width [texels], a power of two (default 256). */
  readonly width?: number;
  /** Characters to bake right away (default: none). */
  readonly preload?: string;
}

/** R8 atlas of baked glyphs of one font; bakes lazily and grows by doubling its height. */
export class GlyphAtlas {
  readonly metrics: FontMetrics;
  private data: Uint8Array;
  private readonly w: number;
  private h = INITIAL_ATLAS_HEIGHT;
  private shelfX = 0;
  private shelfY = 0;
  private shelfH = 0;
  private versionValue = 0;
  private ambiguous = 0;
  /** Baked glyphs by code point, and characters outside the font mapped to their substitute's or the fallback glyph. */
  private readonly glyphs = new Map<number, Glyph>();
  private readonly aliases = new Map<number, Glyph>();
  private readonly charset: ReadonlySet<number>;
  private readonly clippedChars: string[] = [];
  private readonly missingChars: string[] = [];

  constructor(
    readonly spec: PixelFontSpec,
    private readonly rasterizer: GlyphRasterizer,
    options: GlyphAtlasOptions = {},
  ) {
    this.w = options.width ?? DEFAULT_ATLAS_WIDTH;
    if (!Number.isInteger(Math.log2(this.w)) || this.w > MAX_ATLAS_SIZE) throw new Error(`Glyphenatlas: Breite ${this.w} ist keine Zweierpotenz ≤ ${MAX_ATLAS_SIZE}`);
    this.data = new Uint8Array(this.w * this.h);
    this.metrics = { ascent: spec.ascent, descent: spec.descent, lineGap: spec.lineGap, lineHeight: lineHeightOf(spec) };
    this.charset = new Set([...spec.charset].map(codeOf));
    if (!this.charset.has(codeOf(spec.fallback))) throw new Error(`Glyphenatlas: Ersatzzeichen „${spec.fallback}“ fehlt im Zeichensatz von ${spec.family}`);
    this.ensure(options.preload ?? '');
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  /** R8 texels (0 or 255), row 0 first. Replaced by a larger array when the atlas grows. */
  get pixels(): Uint8Array {
    return this.data;
  }

  /** Increases with every baked glyph (GPU copies compare it before drawing). */
  get version(): number {
    return this.versionValue;
  }

  get stats(): GlyphAtlasStats {
    return { glyphs: this.glyphs.size, ambiguousSamples: this.ambiguous, clipped: [...this.clippedChars], missing: [...this.missingChars] };
  }

  /** Whether the font draws `ch` (itself or with the glyph of its substitute, e.g. the no-break space). */
  covers(ch: string): boolean {
    return ch !== '' && glyphCharOf(this.spec, ch) !== null;
  }

  /** Bakes every glyph of `text` that is not in the atlas yet. */
  ensure(text: string): void {
    for (const ch of text) this.glyph(ch);
  }

  /**
   * The glyph of one character (baked on first use); a character with a substitute gives the
   * substitute's glyph, other characters outside the font the fallback glyph.
   */
  glyph(ch: string): Glyph {
    return this.glyphCode(codeOf(ch));
  }

  /**
   * The glyph of a code point. After the first request this is a map lookup without allocation
   * (layout calls it per character and frame).
   */
  glyphCode(code: number): Glyph {
    const known = this.glyphs.get(code) ?? this.aliases.get(code);
    if (known !== undefined) return known;
    const ch = String.fromCodePoint(code);
    if (!this.charset.has(code)) {
      const substitute = glyphCharOf(this.spec, ch);
      if (substitute === null) this.missingChars.push(ch);
      const alias = this.glyph(substitute ?? this.spec.fallback);
      this.aliases.set(code, alias);
      return alias;
    }
    const baked = bakeGlyph(this.spec, this.rasterizer, ch);
    this.ambiguous += baked.ambiguous;
    if (baked.clipped) this.clippedChars.push(ch);
    const glyph = this.place(ch, baked);
    this.glyphs.set(code, glyph);
    this.versionValue++;
    return glyph;
  }

  /** Copies a bitmap into the next free shelf slot (growing the atlas when needed). */
  private place(ch: string, b: GlyphBitmap): Glyph {
    if (b.width === 0) return { char: ch, advance: b.advance, offsetX: b.offsetX, offsetY: b.offsetY, width: 0, height: 0, atlasX: 0, atlasY: 0 };
    const cellW = b.width + 2 * GLYPH_PADDING;
    const cellH = b.height + 2 * GLYPH_PADDING;
    if (cellW > this.w) throw new Error(`Glyphenatlas: „${ch}“ ist breiter als der Atlas (${cellW} > ${this.w})`);
    if (this.shelfX + cellW > this.w) {
      this.shelfY += this.shelfH;
      this.shelfX = 0;
      this.shelfH = 0;
    }
    while (this.shelfY + cellH > this.h) this.grow();
    const atlasX = this.shelfX;
    const atlasY = this.shelfY;
    for (let y = 0; y < b.height; y++) {
      this.data.set(b.bits.subarray(y * b.width, (y + 1) * b.width), (atlasY + GLYPH_PADDING + y) * this.w + atlasX + GLYPH_PADDING);
    }
    this.shelfX += cellW;
    this.shelfH = Math.max(this.shelfH, cellH);
    return { char: ch, advance: b.advance, offsetX: b.offsetX, offsetY: b.offsetY, width: b.width, height: b.height, atlasX, atlasY };
  }

  private grow(): void {
    const next = this.h * 2;
    if (next > MAX_ATLAS_SIZE) throw new Error(`Glyphenatlas: mehr als ${MAX_ATLAS_SIZE} Texel Höhe nötig`);
    const data = new Uint8Array(this.w * next);
    data.set(this.data);
    this.data = data;
    this.h = next;
  }
}
