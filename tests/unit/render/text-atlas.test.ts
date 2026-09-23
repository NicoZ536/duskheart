/**
 * M1-20 Glyphenatlas und Textlayout (src/render/text): harte Alpha-Schwelle, Zuschnitt und
 * Ganzpixel-Lage der Glyphen, Packen mit transparentem Rand, Wachstum, Ersatzzeichen, Statistik –
 * mit einem Bitmap-Rasterer statt Canvas2D (der Browserweg ist das Screenshot-Szenario `schrift`).
 */
import { describe, expect, it } from 'vitest';
import { ALPHA_THRESHOLD, bakeGlyph, GLYPH_PADDING, GlyphAtlas, glyphWindow, gridSnap, INK, type CellWindow, type GlyphRasterizer } from '../../../src/render/text/glyphAtlas';
import { layoutText, measureText, TextLayout } from '../../../src/render/text/layout';
import { PIXELIFY_SANS, type PixelFontSpec } from '../../../src/render/text/pixelFont';

/** Test font: 8 px em, grid 1 px right of the pen (snap 1), rows on the baseline. */
const SPEC: PixelFontSpec = {
  family: 'Testschrift',
  weight: 400,
  unitsPerEm: 800,
  pixelsPerEm: 8,
  gridOriginX: 100,
  gridOriginY: 0,
  ascent: 7,
  descent: 2,
  lineGap: 1,
  charset: 'AHIgp ?\u00a0ÄBCDE',
  fallback: '?',
  halfPixelLetters: '',
  source: { npm: '@test/schrift', version: '1.0.0', license: 'OFL-1.1', author: 'Test', files: [] },
};

interface GlyphDef {
  readonly advance: number;
  /** Design column of the first raster column and design row of the first raster row (top). */
  readonly left: number;
  readonly top: number;
  /** `#` = ink (255), `.` = empty, a digit d = coverage d·28. */
  readonly rows: readonly string[];
}

const CAP = ['#####', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'];
const GLYPHS: Readonly<Record<string, GlyphDef>> = {
  A: { advance: 6.4, left: 0, top: 6, rows: CAP },
  H: { advance: 6.4, left: 0, top: 6, rows: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'] },
  I: { advance: 2.4, left: 0, top: 6, rows: ['#', '#', '#', '#', '#', '#', '#'] },
  // Descender: rows 4 … −2.
  g: { advance: 5.5, left: 0, top: 4, rows: ['####', '#..#', '#..#', '####', '...#', '...#', '####'] },
  // Partial coverage: 4·28 = 112 (below the threshold, ambiguous), 5·28 = 140 (ink, ambiguous), 9·28 = 252 (ink).
  p: { advance: 4, left: 0, top: 2, rows: ['459', '#.#'] },
  '?': { advance: 5, left: 0, top: 6, rows: ['####', '...#', '..#.', '..#.', '....', '..#.', '..#.'] },
  Ä: { advance: 6.4, left: 0, top: 8, rows: ['.#.#.', '.....', ...CAP] },
  ' ': { advance: 2.2, left: 0, top: 0, rows: [] },
  '\u00a0': { advance: 2.2, left: 0, top: 0, rows: [] },
  ...Object.fromEntries([...'BCDE'].map((c) => [c, { advance: 6.4, left: 0, top: 6, rows: CAP }])),
};
const COVERAGE_STEP = 28;

class BitmapRasterizer implements GlyphRasterizer {
  samples = 0;
  constructor(private readonly defs: Readonly<Record<string, GlyphDef>> = GLYPHS) {}
  advance(ch: string): number {
    return this.defs[ch]?.advance ?? 0;
  }
  sample(ch: string, win: CellWindow): Uint8Array {
    this.samples++;
    const def = this.defs[ch];
    const out = new Uint8Array(win.cols * win.rows);
    if (def === undefined) return out;
    for (let y = 0; y < win.rows; y++) {
      const row = win.rowMax - y;
      const line = def.rows[def.top - row];
      if (line === undefined) continue;
      for (let x = 0; x < win.cols; x++) {
        const c = line[win.colMin + x - def.left];
        if (c === undefined || c === '.') continue;
        out[y * win.cols + x] = c === '#' ? INK : Number(c) * COVERAGE_STEP;
      }
    }
    return out;
  }
}

function atlasOf(width?: number): { atlas: GlyphAtlas; raster: BitmapRasterizer } {
  const raster = new BitmapRasterizer();
  return { atlas: new GlyphAtlas(SPEC, raster, width === undefined ? {} : { width }), raster };
}

/** The bitmap of a baked glyph read back from the atlas (`#`/`.` rows). */
function readBack(atlas: GlyphAtlas, ch: string): string[] {
  const g = atlas.glyph(ch);
  const rows: string[] = [];
  for (let y = 0; y < g.height; y++) {
    let r = '';
    for (let x = 0; x < g.width; x++) r += atlas.pixels[(g.atlasY + GLYPH_PADDING + y) * atlas.width + g.atlasX + GLYPH_PADDING + x] === INK ? '#' : '.';
    rows.push(r);
  }
  return rows;
}

describe('Glyphenatlas: Backen', () => {
  it('Raster-Einrastung: Pixelify beginnt 1 Spalte rechts vom Stift, Zeilen auf der Grundlinie (kein −0)', () => {
    expect(gridSnap(PIXELIFY_SANS)).toEqual([1, 0]);
    expect(Object.is(gridSnap(PIXELIFY_SANS)[1], 0)).toBe(true);
    expect(gridSnap(SPEC)).toEqual([1, 0]);
  });

  it('das Abtastfenster umfasst zwei Geviert Breite, Ober- und Unterlänge plus Rand', () => {
    const w = glyphWindow(SPEC);
    expect(w.cols).toBeGreaterThanOrEqual(2 * SPEC.pixelsPerEm);
    expect(w.rowMax).toBeGreaterThanOrEqual(SPEC.ascent);
    expect(w.rowMax - w.rows + 1).toBeLessThan(-SPEC.descent);
  });

  it('schneidet auf die Tinte zu und legt die Bitmap ganzzahlig zu Stift und Grundlinie', () => {
    const r = new BitmapRasterizer();
    const a = bakeGlyph(SPEC, r, 'A');
    expect([a.width, a.height, a.offsetX, a.offsetY, a.advance]).toEqual([5, 7, 1, -7, 6]);
    const g = bakeGlyph(SPEC, r, 'g');
    // Top row 4 lies 5 rows above the baseline; the descender reaches 2 rows below it.
    expect([g.offsetY, g.offsetY + g.height]).toEqual([-5, 2]);
    const umlaut = bakeGlyph(SPEC, r, 'Ä');
    expect(umlaut.offsetY).toBe(-9);
    expect(umlaut.height).toBe(9);
  });

  it('harte Schwelle bei 50 %: 112 bleibt leer, 140 wird Tinte; beide zählen als unklar', () => {
    expect(ALPHA_THRESHOLD).toBe(128);
    const p = bakeGlyph(SPEC, new BitmapRasterizer(), 'p');
    expect(p.width).toBe(3);
    expect([...p.bits]).toEqual([0, INK, INK, INK, 0, INK]);
    expect(p.ambiguous).toBe(2);
  });

  it('Leerzeichen hat keine Bitmap, aber einen gerundeten Vorschub', () => {
    const s = bakeGlyph(SPEC, new BitmapRasterizer(), ' ');
    expect([s.width, s.height, s.advance]).toEqual([0, 0, 2]);
  });

  it('Tinte am Fensterrand gilt als abgeschnitten', () => {
    const wide: GlyphDef = { advance: 30, left: -2, top: 6, rows: ['#'.repeat(glyphWindow(SPEC).cols)] };
    const b = bakeGlyph(SPEC, new BitmapRasterizer({ ...GLYPHS, A: wide }), 'A');
    expect(b.clipped).toBe(true);
    expect(bakeGlyph(SPEC, new BitmapRasterizer(), 'A').clipped).toBe(false);
  });
});

describe('Glyphenatlas: Packen, Cache, Ersatz', () => {
  it('liest die gebackene Bitmap unverändert zurück, mit transparentem Ring', () => {
    const { atlas } = atlasOf();
    expect(readBack(atlas, 'A')).toEqual(CAP);
    const g = atlas.glyph('A');
    for (let x = 0; x < g.width + 2 * GLYPH_PADDING; x++) {
      expect(atlas.pixels[g.atlasY * atlas.width + g.atlasX + x]).toBe(0);
      expect(atlas.pixels[(g.atlasY + g.height + 1) * atlas.width + g.atlasX + x]).toBe(0);
    }
  });

  it('backt jede Glyphe einmal, jede neue erhöht die Version', () => {
    const { atlas, raster } = atlasOf();
    const v0 = atlas.version;
    const a = atlas.glyph('A');
    expect(atlas.version).toBe(v0 + 1);
    expect(atlas.glyph('A')).toBe(a);
    atlas.ensure('AHA');
    expect(atlas.version).toBe(v0 + 2);
    expect(raster.samples).toBe(2);
  });

  it('Zeichen außerhalb der Schrift werden zum Ersatzzeichen und einmal gemeldet', () => {
    const { atlas } = atlasOf();
    const q = atlas.glyph('?');
    expect(atlas.glyph('→')).toBe(q);
    atlas.ensure('→→★');
    expect(atlas.stats.missing).toEqual(['→', '★']);
    expect(atlas.covers('A')).toBe(true);
    expect(atlas.covers('→')).toBe(false);
  });

  it('wächst durch Verdoppeln der Höhe und behält dabei alle Glyphen', () => {
    const { atlas } = atlasOf(8);
    atlas.ensure('AHIgpÄ?BCDE');
    expect(atlas.height).toBeGreaterThan(64);
    expect(Number.isInteger(Math.log2(atlas.height))).toBe(true);
    expect(readBack(atlas, 'A')).toEqual(CAP);
    expect(atlas.pixels.length).toBe(atlas.width * atlas.height);
    const cells = [...'AHIgpÄ?BCDE'].map((c) => atlas.glyph(c));
    for (const a of cells) {
      for (const b of cells) {
        if (a === b) continue;
        const overlap = a.atlasX < b.atlasX + b.width + 2 && b.atlasX < a.atlasX + a.width + 2 && a.atlasY < b.atlasY + b.height + 2 && b.atlasY < a.atlasY + a.height + 2;
        expect(overlap, `${a.char}/${b.char}`).toBe(false);
      }
    }
  });

  it('Statistik zählt Glyphen und unklare Abtastungen; ungültige Optionen werden abgelehnt', () => {
    const { atlas } = atlasOf();
    atlas.ensure('Ap');
    expect(atlas.stats.glyphs).toBe(2);
    expect(atlas.stats.ambiguousSamples).toBe(2);
    expect(atlas.stats.clipped).toEqual([]);
    expect(() => new GlyphAtlas(SPEC, new BitmapRasterizer(), { width: 100 })).toThrow(/Zweierpotenz/);
    expect(() => new GlyphAtlas({ ...SPEC, fallback: '#' }, new BitmapRasterizer())).toThrow(/Ersatzzeichen/);
  });
});

describe('Textlayout', () => {
  const { atlas } = atlasOf();
  const lh = SPEC.ascent + SPEC.descent + SPEC.lineGap;

  it('setzt Glyphen mit ganzzahligem Vorschub auf die Grundlinie', () => {
    const l = layoutText(atlas, 'AH');
    expect(l.count).toBe(2);
    expect([l.glyphs[0]?.x, l.glyphs[0]?.y]).toEqual([1, 0]);
    expect([l.glyphs[1]?.x, l.glyphs[1]?.y]).toEqual([7, 0]);
    expect([l.width, l.height, l.lines]).toEqual([12, SPEC.ascent + SPEC.descent, 1]);
  });

  it('Leerzeichen erzeugen keine Glyphen; Zeilenumbruch mit \\n', () => {
    const l = layoutText(atlas, 'A H\nI');
    expect(l.count).toBe(3);
    expect(l.glyphs[1]?.x).toBe(6 + 2 + 1);
    expect([l.glyphs[2]?.x, l.glyphs[2]?.y]).toEqual([1, lh]);
    expect(l.lines).toBe(2);
    expect(l.height).toBe(lh + SPEC.ascent + SPEC.descent);
  });

  it('bricht an Leerzeichen um, zu lange Wörter zwischen Zeichen', () => {
    const words = layoutText(atlas, 'AH AH AH', { maxWidth: 26 });
    expect(words.lines).toBe(2);
    const second = words.glyphs.slice(0, words.count).filter((p) => p.y === lh);
    expect(second.map((p) => p.x)).toEqual([1, 7]);
    const long = layoutText(atlas, 'AAAAA', { maxWidth: 14 });
    expect(long.lines).toBe(3);
    expect(long.glyphs.slice(0, long.count).every((p) => p.x + p.glyph.width <= 14)).toBe(true);
    // A no-break space is no break opportunity.
    const nb = layoutText(atlas, 'AH\u00a0AH', { maxWidth: 20 });
    expect(nb.glyphs[2]?.y).toBe(0);
  });

  it('richtet Zeilen links, mittig und rechts im Block aus', () => {
    const right = layoutText(atlas, 'A', { maxWidth: 20, align: 'right' });
    expect((right.glyphs[0]?.x ?? 0) + 5).toBe(20);
    const center = layoutText(atlas, 'A', { maxWidth: 21, align: 'center' });
    expect(center.glyphs[0]?.x).toBe(8);
    expect(center.width).toBe(21);
  });

  it('verwendet die Einträge des Layouts wieder (keine Allokation je Aufruf)', () => {
    const out = new TextLayout();
    layoutText(atlas, 'AHA', {}, out);
    const first = out.glyphs[0];
    layoutText(atlas, 'HI', {}, out);
    expect(out.glyphs[0]).toBe(first);
    expect(out.count).toBe(2);
    expect(measureText(atlas, 'AH', {}, out)).toEqual({ width: 12, height: SPEC.ascent + SPEC.descent, lines: 1 });
  });
});
