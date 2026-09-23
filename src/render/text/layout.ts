/**
 * Text layout on whole pixels for the pixel font: pen advance per glyph, word wrap at spaces (long
 * words break between characters), hard breaks at `\n`, left/centre/right alignment inside the
 * block. Used by the WebGL text batch (`textBatch.ts`) and for measuring world UI labels.
 *
 * `layoutText` writes into a reusable `TextLayout` (placed glyphs are pooled objects), so a frame
 * that lays out the same number of labels as the last one allocates nothing.
 */
import type { FontMetrics, Glyph } from './glyphAtlas';

export type TextAlign = 'left' | 'center' | 'right';

/** What the layout needs from a font: glyphs by code point and line metrics. */
export interface GlyphSource {
  glyphCode(code: number): Glyph;
  readonly metrics: FontMetrics;
}

export interface LayoutOptions {
  /** Wrap width [px]; 0 or absent = no wrapping. Also the block width for alignment. */
  readonly maxWidth?: number;
  readonly align?: TextAlign;
  /** Line pitch [px]; default: the font's line height. */
  readonly lineHeight?: number;
}

/** A glyph bitmap placed in the block: `x`/`y` = top-left of its bitmap relative to the block. */
export interface PlacedGlyph {
  glyph: Glyph;
  x: number;
  y: number;
}

/** Code point that ends a word (break opportunity; a no-break space does not) and the line break. */
const BREAK_SPACE = 0x20;
const NEWLINE = 0x0a;
/** Code points above this take two UTF-16 units. */
const BMP_LAST = 0xffff;

export class TextLayout {
  /** Placed glyphs; only the first `count` entries are valid (the objects are reused). */
  readonly glyphs: PlacedGlyph[] = [];
  count = 0;
  /** Block width [px]: `maxWidth` if given, else the widest line's ink. */
  width = 0;
  /** Block height [px]: all lines, without the gap after the last one. */
  height = 0;
  lines = 0;
  /** First glyph index of every line, and the ink extent of each line (pen-relative). */
  private readonly lineFrom: number[] = [];
  private readonly inkLeft: number[] = [];
  private readonly inkRight: number[] = [];

  /** @internal Starts a new layout. */
  reset(): void {
    this.count = 0;
    this.width = 0;
    this.height = 0;
    this.lines = 0;
  }

  /** @internal Appends a placed glyph (reusing a pooled entry). */
  push(glyph: Glyph, x: number, y: number): void {
    const slot = this.glyphs[this.count];
    if (slot === undefined) this.glyphs.push({ glyph, x, y });
    else {
      slot.glyph = glyph;
      slot.x = x;
      slot.y = y;
    }
    this.count++;
  }

  /** @internal Closes line `this.lines` covering glyphs `from`…`to − 1`. */
  endLine(from: number, to: number): void {
    let left = 0;
    let right = 0;
    for (let i = from; i < to; i++) {
      const p = this.glyphs[i];
      if (p === undefined) continue;
      left = i === from ? p.x : Math.min(left, p.x);
      right = Math.max(right, p.x + p.glyph.width);
    }
    this.lineFrom[this.lines] = from;
    this.inkLeft[this.lines] = left;
    this.inkRight[this.lines] = right;
    this.lines++;
  }

  /** @internal Moves glyphs `from`…`count − 1` by (dx, dy). */
  shift(from: number, dx: number, dy: number): void {
    for (let i = from; i < this.count; i++) {
      const p = this.glyphs[i];
      if (p === undefined) continue;
      p.x += dx;
      p.y += dy;
    }
  }

  /** @internal Aligns every line inside the block and sets `width`. */
  align(align: TextAlign, maxWidth: number): void {
    let widest = 0;
    for (let l = 0; l < this.lines; l++) widest = Math.max(widest, this.inkRight[l] ?? 0);
    this.width = maxWidth > 0 ? maxWidth : widest;
    if (align === 'left') return;
    for (let l = 0; l < this.lines; l++) {
      const left = this.inkLeft[l] ?? 0;
      const right = this.inkRight[l] ?? 0;
      const dx = align === 'right' ? this.width - right : Math.floor((this.width - (right - left)) / 2) - left;
      const from = this.lineFrom[l] ?? 0;
      const to = l + 1 < this.lines ? (this.lineFrom[l + 1] ?? this.count) : this.count;
      for (let i = from; i < to; i++) {
        const p = this.glyphs[i];
        if (p !== undefined) p.x += dx;
      }
    }
  }
}

/** Lays out `text` into `out` (reused) and returns it. */
export function layoutText(font: GlyphSource, text: string, options: LayoutOptions = {}, out: TextLayout = new TextLayout()): TextLayout {
  const maxWidth = options.maxWidth ?? 0;
  const { ascent, descent } = font.metrics;
  const lineHeight = options.lineHeight ?? font.metrics.lineHeight;
  out.reset();
  let line = 0;
  let pen = 0;
  let lineStart = 0;
  /** First glyph after the last space of this line (−1: no space yet) and the pen where it starts. */
  let breakAt = -1;
  let breakPen = 0;
  // Walk code points by index: no iterator or one-character strings per glyph.
  for (let i = 0; i < text.length; ) {
    const code = text.codePointAt(i) ?? 0;
    i += code > BMP_LAST ? 2 : 1;
    if (code === NEWLINE) {
      out.endLine(lineStart, out.count);
      line++;
      lineStart = out.count;
      breakAt = -1;
      pen = 0;
      continue;
    }
    const g = font.glyphCode(code);
    if (code === BREAK_SPACE) {
      pen += g.advance;
      breakAt = out.count;
      breakPen = pen;
      continue;
    }
    if (maxWidth > 0 && g.width > 0 && pen > 0 && pen + g.offsetX + g.width > maxWidth) {
      // Word wrap: everything after the last space moves to the next line; a word longer than the
      // line breaks between characters.
      const wrapWord = breakAt >= lineStart && breakAt >= 0;
      const from = wrapWord ? breakAt : out.count;
      out.endLine(lineStart, from);
      line++;
      lineStart = from;
      breakAt = -1;
      if (wrapWord) {
        out.shift(from, -breakPen, lineHeight);
        pen -= breakPen;
      } else pen = 0;
    }
    if (g.width > 0) out.push(g, pen + g.offsetX, line * lineHeight + ascent + g.offsetY);
    pen += g.advance;
  }
  out.endLine(lineStart, out.count);
  out.height = (out.lines - 1) * lineHeight + ascent + descent;
  out.align(options.align ?? 'left', maxWidth);
  return out;
}

/** Size of `text` laid out with `options` (uses `scratch` when given, so nothing is allocated). */
export function measureText(font: GlyphSource, text: string, options: LayoutOptions = {}, scratch?: TextLayout): { width: number; height: number; lines: number } {
  const l = layoutText(font, text, options, scratch);
  return { width: l.width, height: l.height, lines: l.lines };
}
