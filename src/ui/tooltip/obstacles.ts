/**
 * What a tooltip keeps clear of (`placeTooltip`), read from the screen layer's DOM: the panel frames with their rims (the
 * rows that draw them, `frameRimInk`), and inside the panels the thin lines (dividers: solid upper or lower borders), the
 * glyphs of the text and its words (runs of glyphs without a breaking space). Lines and text count only in panels whose
 * columns meet the columns the tooltip may take; what a scroll area or a clipping box hides and what is not visible does not
 * count.
 */
import { bakeGlyph, createCanvasRasterizer, cssFont, type GlyphRasterizer } from '../../render/text';
import { UI_FONT } from '../font';
import { FRAME_ARTEN, frameRimInk } from '../kit';
import type { NavRect } from '../focus/nav';
import type { TooltipFrame, TooltipGlyph } from './place';

/** A rectangle by its edges [CSS px]. */
export interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The pixel font's box around a glyph (what a `Range` measures) [font px]: 12 above the baseline, 4 below – ascent 1200,
 * descent 400 units at 100 units per pixel (Fusion Pixel 10, src/render/text/pixelFont.ts).
 */
export const FONT_BOX = { ascent: 12, descent: 4 } as const;

/**
 * Ink of the font when it cannot be measured (font not loaded yet, no canvas) [font px] (src/render/text/pixelFont.ts):
 * capitals, digits and the ascenders of lowercase letters reach 7 rows above the baseline, accents up to 10 (the ring of
 * Å), descenders 2 rows below; each advance ends with 1 px letter spacing. Punctuation and symbols count with the whole
 * height – a row too many keeps the tooltip a row further away, never too close.
 */
export const FONT_INK = { letter: 7, accent: 10, descent: 2, spacing: 1 } as const;

/** Letters with a descender in the font (and the punctuation that reaches below the baseline). */
const DESCENDERS = new Set(['g', 'j', 'p', 'q', 'y', 'Q', 'ç', ',', ';']);
const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;

/**
 * The ink of a glyph relative to its pen and baseline [font px]: columns [`left`, `right`) right of the pen, `above` rows
 * above and `below` rows below the baseline.
 */
export interface GlyphInk {
  readonly left: number;
  readonly right: number;
  readonly above: number;
  readonly below: number;
}

/** The ink of `ch` with an advance of `advance` font px by the rules of `FONT_INK`; `null` for whitespace (no ink). */
export function glyphInk(ch: string, advance: number): GlyphInk | null {
  if (ch.trim() === '' || ch === '\u00ad' || advance <= FONT_INK.spacing) return null;
  const right = advance - FONT_INK.spacing;
  if (!LETTER_OR_DIGIT.test(ch)) return { left: 0, right, above: FONT_INK.accent, below: FONT_INK.descent };
  const accented = ch.normalize('NFD').length > 1;
  return { left: 0, right, above: accented ? FONT_INK.accent : FONT_INK.letter, below: DESCENDERS.has(ch) ? FONT_INK.descent : 0 };
}

let rasterizer: GlyphRasterizer | null = null;
const baked = new Map<string, GlyphInk | null>();

/**
 * The ink of `ch` as the font draws it – baked like the glyphs of the world UI (`bakeGlyph`, hard alpha threshold, whole
 * pixels; once per character) – or by `glyphInk` while the font is not loaded or no canvas is there.
 */
export function fontInk(ch: string, advance: number): GlyphInk | null {
  const known = baked.get(ch);
  if (known !== undefined || baked.has(ch)) return known ?? null;
  if (typeof document === 'undefined' || !document.fonts.check(cssFont(UI_FONT))) return glyphInk(ch, advance);
  try {
    rasterizer ??= createCanvasRasterizer(UI_FONT);
    const b = bakeGlyph(UI_FONT, rasterizer, ch);
    const ink = b.width === 0 || b.height === 0 ? null : { left: b.offsetX, right: b.offsetX + b.width, above: -b.offsetY, below: b.offsetY + b.height };
    baked.set(ch, ink);
    return ink;
  } catch {
    return glyphInk(ch, advance);
  }
}

/**
 * The ink of a glyph as `placeTooltip` counts it, from the box a `Range` measures around it (its advance and the font's
 * box, relative to the layer) and its `ink` in font px; `null` without ink.
 */
export function glyphBox(box: Edges, ink: GlyphInk | null): TooltipGlyph | null {
  const px = (box.bottom - box.top) / (FONT_BOX.ascent + FONT_BOX.descent);
  if (ink === null || px <= 0 || box.right <= box.left) return null;
  const baseline = box.bottom - FONT_BOX.descent * px;
  return { left: box.left + ink.left * px, right: box.left + ink.right * px, top: baseline - ink.above * px, bottom: baseline + ink.below * px };
}

/**
 * Spaces that end a word – every white space but the non-breaking ones (U+00A0, U+2007 figure space, U+202F narrow
 * no-break space, U+FEFF): a value and its unit joined by one ("37.0 °C") stay one value, as on the screen.
 */
const WORD_BREAK = /[^\S\u00a0\u2007\u202f\ufeff]/u;

/** Whether `ch` ends a word (`WORD_BREAK`). */
export function breaksWord(ch: string): boolean {
  return WORD_BREAK.test(ch);
}

/** A character of a panel's text as `readObstacles` measures it: its advance box, its ink as far as it shows, its kind. */
export interface MeasuredChar {
  readonly box: Edges;
  readonly ink: Edges | null;
  /** A breaking space (`breaksWord`). */
  readonly breaks: boolean;
}

/** How far apart [CSS px] two advance boxes may lie and still abut (rounding of the layout). */
const ABUT = 0.5;

/**
 * The words of `chars` (in reading order): the ink of each run of characters without a breaking space whose advance boxes
 * abut on one line – across elements too ("100" and "/100" set in two spans read as one value), but not across a gap (the
 * label and the value of a row) or a line break. A word without any shown ink is none.
 */
export function wordInk(chars: readonly MeasuredChar[]): Edges[] {
  const words: Edges[] = [];
  let ink: Edges | null = null;
  let prev: Edges | null = null;
  for (const c of chars) {
    const joins = prev !== null && Math.abs(c.box.left - prev.right) <= ABUT && Math.abs(c.box.bottom - prev.bottom) <= ABUT;
    if (c.breaks || !joins) {
      if (ink !== null) words.push(ink);
      ink = null;
    }
    prev = c.box;
    if (c.breaks || c.ink === null) continue;
    ink = ink === null ? c.ink : { left: Math.min(ink.left, c.ink.left), top: Math.min(ink.top, c.ink.top), right: Math.max(ink.right, c.ink.right), bottom: Math.max(ink.bottom, c.ink.bottom) };
  }
  if (ink !== null) words.push(ink);
  return words;
}

/** What `readObstacles` found: the frames, and the lines, glyphs and words inside the panels [CSS px relative to the layer]. */
export interface FoundObstacles {
  readonly frames: TooltipFrame[];
  readonly lines: NavRect[];
  readonly glyphs: TooltipGlyph[];
  readonly words: TooltipGlyph[];
}

function intersect(a: Edges, b: Edges): Edges | null {
  const r = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
  return r.right > r.left && r.bottom > r.top ? r : null;
}

/**
 * Reads the frames of `container` besides the tooltip `own`, and the lines and glyphs inside those whose columns meet
 * [`cols[0]`, `cols[1]`) [CSS px relative to `box`]; `step` is the CSS px per design px (rims).
 */
export function readObstacles(container: Element, own: Element, box: { left: number; top: number }, step: number, cols: readonly [number, number]): FoundObstacles {
  const found: FoundObstacles = { frames: [], lines: [], glyphs: [], words: [] };
  const style = new Map<Element, CSSStyleDeclaration>();
  const css = (el: Element): CSSStyleDeclaration => {
    let s = style.get(el);
    if (s === undefined) {
      s = getComputedStyle(el);
      style.set(el, s);
    }
    return s;
  };
  // The part of the viewport an element of `frame` can show: cut by every box between it and the frame that clips.
  const clips = new Map<Element, Edges | null>();
  const visibleIn = (el: Element, frame: Element): Edges | null => {
    if (clips.has(el)) return clips.get(el) ?? null;
    let area: Edges | null = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    const s = css(el);
    if (s.visibility !== 'visible' || s.display === 'none' || Number(s.opacity) === 0) area = null;
    else {
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const r = el.getBoundingClientRect();
        const inner = { left: r.left + el.clientLeft, top: r.top + el.clientTop, right: r.left + el.clientLeft + el.clientWidth, bottom: r.top + el.clientTop + el.clientHeight };
        area = intersect(area, inner);
      }
      const parent = el.parentElement;
      if (area !== null && el !== frame && parent !== null) {
        const outer = visibleIn(parent, frame);
        area = outer === null ? null : intersect(area, outer);
      }
    }
    clips.set(el, area);
    return area;
  };
  const range = document.createRange();
  for (const el of container.querySelectorAll('.dh-rahmen')) {
    if (own.contains(el)) continue;
    const art = FRAME_ARTEN.find((a) => el.classList.contains(`dh-rahmen--${a}`));
    const r = el.getBoundingClientRect();
    if (art === undefined || r.width === 0 || r.height === 0) continue;
    found.frames.push({ rect: { left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height }, rim: frameRimInk(art) * step });
    if (r.right - box.left <= cols[0] || r.left - box.left >= cols[1]) continue;
    // Lines: solid upper or lower borders of plain boxes (9-slice graphics – slots, buttons, frames – are not lines).
    for (const child of el.querySelectorAll('*')) {
      if (child.closest('.dh-rahmen') !== el) continue;
      const s = css(child);
      if (s.borderImageSource !== 'none') continue;
      const up = s.borderTopStyle !== 'none' ? Number.parseFloat(s.borderTopWidth) : 0;
      const down = s.borderBottomStyle !== 'none' ? Number.parseFloat(s.borderBottomWidth) : 0;
      if (!(up > 0) && !(down > 0)) continue;
      const area = visibleIn(child, el);
      const b = child.getBoundingClientRect();
      for (const [top, height] of [
        [b.top, up],
        [b.bottom - down, down],
      ] as const) {
        const line = area === null || !(height > 0) ? null : intersect({ left: b.left, top, right: b.right, bottom: top + height }, area);
        if (line !== null) found.lines.push({ left: line.left - box.left, top: line.top - box.top, width: line.right - line.left, height: line.bottom - line.top });
      }
    }
    // Glyphs: every character with ink, as far as it shows; words: the runs of them without a breaking space.
    const chars: MeasuredChar[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent ?? '';
      if (parent === null || text.trim() === '' || parent.closest('.dh-rahmen') !== el) continue;
      const area = visibleIn(parent, el);
      if (area === null) continue;
      for (let i = 0; i < text.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const c = range.getBoundingClientRect();
        const ch = text[i] ?? ' ';
        const px = c.height / (FONT_BOX.ascent + FONT_BOX.descent);
        const g = px > 0 ? glyphBox(c, fontInk(ch, Math.round(c.width / px))) : null;
        const shown = g === null ? null : intersect(g, area);
        const ink = shown === null ? null : { left: shown.left - box.left, top: shown.top - box.top, right: shown.right - box.left, bottom: shown.bottom - box.top };
        if (ink !== null) found.glyphs.push(ink);
        chars.push({ box: { left: c.left, top: c.top, right: c.right, bottom: c.bottom }, ink, breaks: breaksWord(ch) });
      }
    }
    found.words.push(...wordInk(chars));
  }
  return found;
}
