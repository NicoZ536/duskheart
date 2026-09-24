/**
 * M1-20/M1-27 Pixelschrift: der Deskriptor (src/render/text/pixelFont.ts) stimmt mit der Schriftdatei
 * des gepinnten npm-Pakets überein – Einheiten je Geviert, Designraster, Zeilenmetrik wie im DOM,
 * Zeichenabdeckung –, die Ergänzungsschrift „DH Satzzeichen“ (assets-src/schrift) passt auf dasselbe
 * Raster, und der Glyphenatlas backt aus den echten Konturen beider Schriften pixelgenau: keine
 * unklaren Abtastungen, nichts abgeschnitten, und die Glyphen, an denen die alte Schrift scheiterte
 * (5/S, , . : ; ! ? „ “ ” ‚ ‘ ’ – — × ° %), haben genau die erwartete Form, Lage und Breite.
 * Paket, Einbindung in base.css und CREDITS.md werden ebenfalls geprüft. Den Browserweg (Canvas2D-Bake,
 * DOM neben WebGL) zeigt das Screenshot-Szenario `schrift`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { SATZZEICHEN } from '../../../assets-src/schrift/satzzeichen';
import { GLYPH_PADDING, GlyphAtlas, INK, type CellWindow, type GlyphRasterizer } from '../../../src/render/text/glyphAtlas';
import { layoutText } from '../../../src/render/text/layout';
import { cssFont, fontCovers, glyphCharOf, lineHeightOf, PIXEL_FONT, uncoveredChars, unitsPerPixel } from '../../../src/render/text/pixelFont';
import { buildTrueType } from '../../../tools/assets/truetype';

const ROOT = process.cwd();
const PKG_DIR = join(ROOT, 'node_modules', PIXEL_FONT.source.npm);
const SUPPLEMENT = PIXEL_FONT.supplement;

type Point = readonly [number, number];

interface Font {
  readonly unitsPerEm: number;
  /** hhea ascender / descender (descender negative). */
  readonly ascender: number;
  readonly descender: number;
  readonly cmap: ReadonlyMap<number, number>;
  advance(glyph: number): number;
  /** Closed outlines of a glyph (composites resolved; on-curve points only in pixel fonts). */
  contours(glyph: number): Point[][];
}

const WOFF_SIGNATURE = 0x774f4646;
const WOFF_HEADER = 44;
const WOFF_ENTRY = 20;
const SFNT_HEADER = 12;
const SFNT_ENTRY = 16;

/** Minimal sfnt reader (WOFF 1.0 or plain TrueType): `head`, `hhea`, `hmtx`, `cmap` (4 and 12), `loca`, `glyf`. */
function readFont(bytes: Uint8Array, name: string): Font {
  const b = Buffer.from(bytes);
  const tables = new Map<string, Buffer>();
  const woff = b.readUInt32BE(0) === WOFF_SIGNATURE;
  const numTables = b.readUInt16BE(woff ? 12 : 4);
  for (let i = 0; i < numTables; i++) {
    const o = woff ? WOFF_HEADER + i * WOFF_ENTRY : SFNT_HEADER + i * SFNT_ENTRY;
    const tag = b.toString('latin1', o, o + 4);
    if (woff) {
      const off = b.readUInt32BE(o + 4);
      const comp = b.readUInt32BE(o + 8);
      const orig = b.readUInt32BE(o + 12);
      const raw = b.subarray(off, off + comp);
      tables.set(tag, comp < orig ? inflateSync(raw) : raw);
    } else {
      const off = b.readUInt32BE(o + 8);
      tables.set(tag, b.subarray(off, off + b.readUInt32BE(o + 12)));
    }
  }
  const table = (tag: string): Buffer => {
    const t = tables.get(tag);
    if (t === undefined) throw new Error(`${name}: Tabelle ${tag} fehlt`);
    return t;
  };
  const head = table('head');
  const hhea = table('hhea');
  const hmtx = table('hmtx');
  const numHMetrics = hhea.readUInt16BE(34);
  const longLoca = head.readInt16BE(50) === 1;
  const numGlyphs = table('maxp').readUInt16BE(4);
  const loca = table('loca');
  const glyf = table('glyf');
  const offsets: number[] = [];
  for (let i = 0; i <= numGlyphs; i++) offsets.push(longLoca ? loca.readUInt32BE(i * 4) : loca.readUInt16BE(i * 2) * 2);
  const cmapTable = table('cmap');
  const cmap = new Map<number, number>();
  for (let i = 0; i < cmapTable.readUInt16BE(2); i++) {
    const so = cmapTable.readUInt32BE(8 + i * 8);
    const format = cmapTable.readUInt16BE(so);
    if (format === 4) {
      const segX2 = cmapTable.readUInt16BE(so + 6);
      const endO = so + 14;
      const startO = endO + segX2 + 2;
      const deltaO = startO + segX2;
      const rangeO = deltaO + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmapTable.readUInt16BE(endO + s * 2);
        const start = cmapTable.readUInt16BE(startO + s * 2);
        const delta = cmapTable.readInt16BE(deltaO + s * 2);
        const range = cmapTable.readUInt16BE(rangeO + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g = range === 0 ? (c + delta) & 0xffff : cmapTable.readUInt16BE(rangeO + s * 2 + range + (c - start) * 2);
          if (range !== 0 && g !== 0) g = (g + delta) & 0xffff;
          if (g !== 0) cmap.set(c, g);
        }
      }
    } else if (format === 12) {
      for (let k = 0; k < cmapTable.readUInt32BE(so + 12); k++) {
        const first = cmapTable.readUInt32BE(so + 16 + k * 12);
        const last = cmapTable.readUInt32BE(so + 20 + k * 12);
        const g = cmapTable.readUInt32BE(so + 24 + k * 12);
        for (let c = first; c <= last; c++) cmap.set(c, g + c - first);
      }
    }
  }
  const contours = (gid: number, dx = 0, dy = 0, out: Point[][] = []): Point[][] => {
    const s = offsets[gid] ?? 0;
    const e = offsets[gid + 1] ?? 0;
    if (e <= s) return out;
    const n = glyf.readInt16BE(s);
    let p = s + 10;
    if (n < 0) {
      for (;;) {
        const flags = glyf.readUInt16BE(p);
        const child = glyf.readUInt16BE(p + 2);
        p += 4;
        const words = (flags & 1) !== 0;
        const ax = words ? glyf.readInt16BE(p) : glyf.readInt8(p);
        const ay = words ? glyf.readInt16BE(p + 2) : glyf.readInt8(p + 1);
        p += words ? 4 : 2;
        p += (flags & 8) !== 0 ? 2 : (flags & 0x40) !== 0 ? 4 : (flags & 0x80) !== 0 ? 8 : 0;
        contours(child, dx + ax, dy + ay, out);
        if ((flags & 0x20) === 0) break;
      }
      return out;
    }
    const ends: number[] = [];
    for (let i = 0; i < n; i++) {
      ends.push(glyf.readUInt16BE(p));
      p += 2;
    }
    p += 2 + glyf.readUInt16BE(p);
    const last = ends.at(-1) ?? -1;
    const flags: number[] = [];
    while (flags.length <= last) {
      const f = glyf.readUInt8(p++);
      flags.push(f);
      if ((f & 8) !== 0) for (let r = glyf.readUInt8(p++); r > 0; r--) flags.push(f);
    }
    const coords = (short: number, same: number): number[] => {
      let v = 0;
      return flags.map((f) => {
        if ((f & short) !== 0) {
          const d = glyf.readUInt8(p++);
          v += (f & same) !== 0 ? d : -d;
        } else if ((f & same) === 0) {
          v += glyf.readInt16BE(p);
          p += 2;
        }
        return v;
      });
    };
    const xs = coords(2, 16);
    const ys = coords(4, 32);
    if (flags.some((f) => (f & 1) === 0)) throw new Error(`${name}: Glyphe ${gid} hat Kurvenpunkte (Pixelschrift erwartet nur Ecken)`);
    let start = 0;
    for (const end of ends) {
      const c: Point[] = [];
      for (let i = start; i <= end; i++) c.push([(xs[i] ?? 0) + dx, (ys[i] ?? 0) + dy]);
      out.push(c);
      start = end + 1;
    }
    return out;
  };
  return {
    unitsPerEm: head.readUInt16BE(18),
    ascender: hhea.readInt16BE(4),
    descender: hhea.readInt16BE(6),
    cmap,
    advance: (g) => hmtx.readUInt16BE(Math.min(g, numHMetrics - 1) * 4),
    contours: (g) => contours(g),
  };
}

const MAIN = readFont(new Uint8Array(readFileSync(join(PKG_DIR, PIXEL_FONT.source.files[0] ?? ''))), PIXEL_FONT.family);
const SUPP = readFont(buildTrueType(SATZZEICHEN), SATZZEICHEN.name);

/** The font and glyph that draw `ch` in the browser: the supplement for its characters, else the main font. */
function glyphOf(ch: string): { font: Font; glyph: number } | null {
  const code = ch.codePointAt(0) ?? 0;
  const font = SUPPLEMENT?.chars.includes(ch) === true ? SUPP : MAIN;
  const glyph = font.cmap.get(code);
  return glyph === undefined ? null : { font, glyph };
}

/** Non-zero winding number of `(x, y)` in the outlines. */
function winding(contours: readonly Point[][], x: number, y: number): number {
  let w = 0;
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const [ax, ay] = c[i] ?? [0, 0];
      const [bx, by] = c[(i + 1) % c.length] ?? [0, 0];
      const side = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
      if (ay <= y && by > y && side > 0) w++;
      else if (ay > y && by <= y && side < 0) w--;
    }
  }
  return w;
}

/** Sub-samples per cell side: the coverage of a design pixel is the share of its 4 × 4 sample points inside the outline. */
const SUBSAMPLES = 4;
const COVERAGE_MAX = 255;

/**
 * Rasteriser from the font outlines, standing in for Canvas2D: the same coverage per design-pixel
 * cell the browser bake measures (it draws the glyph 8× and averages 8 × 8 blocks).
 */
class OutlineRasterizer implements GlyphRasterizer {
  advance(ch: string): number {
    const g = glyphOf(ch);
    return g === null ? 0 : g.font.advance(g.glyph) / unitsPerPixel(PIXEL_FONT);
  }
  sample(ch: string, win: CellWindow): Uint8Array {
    const out = new Uint8Array(win.cols * win.rows);
    const g = glyphOf(ch);
    if (g === null) return out;
    const outline = g.font.contours(g.glyph);
    const upp = unitsPerPixel(PIXEL_FONT);
    for (let y = 0; y < win.rows; y++) {
      const row = win.rowMax - y;
      for (let x = 0; x < win.cols; x++) {
        const col = win.colMin + x;
        let inside = 0;
        for (let sy = 0; sy < SUBSAMPLES; sy++) {
          for (let sx = 0; sx < SUBSAMPLES; sx++) {
            const fx = PIXEL_FONT.gridOriginX + (col + (sx + 0.5) / SUBSAMPLES) * upp;
            const fy = PIXEL_FONT.gridOriginY + (row + (sy + 0.5) / SUBSAMPLES) * upp;
            if (winding(outline, fx, fy) !== 0) inside++;
          }
        }
        out[y * win.cols + x] = Math.round((inside * COVERAGE_MAX) / (SUBSAMPLES * SUBSAMPLES));
      }
    }
    return out;
  }
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

const atlas = new GlyphAtlas(PIXEL_FONT, new OutlineRasterizer(), { preload: PIXEL_FONT.charset });

describe('Pixelschrift: Deskriptor gegen Schriftdatei', () => {
  it('Einheiten je Geviert stimmen, die native Größe ergibt ganze Designpixel', () => {
    expect(MAIN.unitsPerEm).toBe(PIXEL_FONT.unitsPerEm);
    expect(SUPP.unitsPerEm).toBe(PIXEL_FONT.unitsPerEm);
    expect(Number.isInteger(PIXEL_FONT.pixelsPerEm)).toBe(true);
    expect(unitsPerPixel(PIXEL_FONT)).toBe(SATZZEICHEN.metrik.einheitenJePixel);
  });

  it('jedes Zeichen des Zeichensatzes steht in der Schrift (auch ÄÖÜäöüß); Ersatzzeichen fehlen der Schrift, ihr Ziel nicht', () => {
    const missing = [...PIXEL_FONT.charset].filter((ch) => glyphOf(ch) === null);
    expect(missing).toEqual([]);
    for (const ch of 'ÄÖÜäöüß') expect(PIXEL_FONT.charset).toContain(ch);
    expect(PIXEL_FONT.charset).toContain(PIXEL_FONT.fallback);
    for (const [ch, target] of Object.entries(PIXEL_FONT.substitutes ?? {})) {
      expect(MAIN.cmap.has(ch.codePointAt(0) ?? 0), `U+${(ch.codePointAt(0) ?? 0).toString(16)}`).toBe(false);
      expect(glyphCharOf(PIXEL_FONT, ch)).toBe(target);
    }
  });

  it('alle Konturpunkte aller Zeichen liegen exakt auf dem Designraster (keine Halbpixel), alle Vorschübe sind ganze Pixel', () => {
    const upp = unitsPerPixel(PIXEL_FONT);
    const offGrid = new Set<string>();
    for (const ch of PIXEL_FONT.charset) {
      const g = glyphOf(ch);
      if (g === null) continue;
      for (const [x, y] of g.font.contours(g.glyph).flat()) {
        if ((x - PIXEL_FONT.gridOriginX) % upp !== 0 || (y - PIXEL_FONT.gridOriginY) % upp !== 0) offGrid.add(ch);
      }
      expect(g.font.advance(g.glyph) % upp, ch).toBe(0);
    }
    expect([...offGrid].join('')).toBe(PIXEL_FONT.halfPixelLetters);
    expect(PIXEL_FONT.halfPixelLetters).toBe('');
  });

  it('Zeilenmetrik wie im DOM: die Grundlinie liegt bei 12 px Zeilenhöhe genau „ascent“ Pixel unter der Zeilenoberkante', () => {
    const upp = unitsPerPixel(PIXEL_FONT);
    const boxAscent = MAIN.ascender / upp;
    const boxDescent = -MAIN.descender / upp;
    const line = lineHeightOf(PIXEL_FONT);
    // CSS: half-leading = (line-height − (ascent + descent)) / 2, baseline = half-leading + ascent.
    const baseline = (line - boxAscent - boxDescent) / 2 + boxAscent;
    expect(baseline).toBe(PIXEL_FONT.ascent);
    expect(Number.isInteger(baseline)).toBe(true);
    expect(line).toBe(PIXEL_FONT.ascent + PIXEL_FONT.descent + PIXEL_FONT.lineGap);
    // The supplement has the same line box, so mixing it into a line moves nothing.
    expect([SUPP.ascender, SUPP.descender]).toEqual([MAIN.ascender, MAIN.descender]);
  });

  it('Oberlänge und Unterlänge fassen jede Glyphe – nur der Ring von Å ragt eine Zeile darüber; Umlautpunkte in Zeile 8', () => {
    const above: string[] = [];
    for (const ch of PIXEL_FONT.charset) {
      const g = atlas.glyph(ch);
      if (g.height === 0) continue;
      if (-g.offsetY > PIXEL_FONT.ascent) above.push(ch);
      expect(g.offsetY + g.height, ch).toBeLessThanOrEqual(PIXEL_FONT.descent);
    }
    expect(above.join('')).toBe('Å');
    expect(-atlas.glyph('Å').offsetY).toBe(PIXEL_FONT.ascent + 1);
    for (const ch of 'ÄÖÜ') expect(-atlas.glyph(ch).offsetY, ch).toBe(9);
  });

  it('die Ergänzungsschrift zeichnet genau die Zeichen, die die Hauptschrift in voller Geviertbreite hat', () => {
    expect(SUPPLEMENT).toBeDefined();
    const chars = [...(SUPPLEMENT?.chars ?? '')];
    expect(chars.sort()).toEqual(Object.keys(SATZZEICHEN.glyphen).sort());
    expect(SUPPLEMENT?.family).toBe(SATZZEICHEN.name);
    for (const ch of chars) {
      const main = MAIN.cmap.get(ch.codePointAt(0) ?? 0);
      expect(main, ch).toBeDefined();
      expect(MAIN.advance(main ?? 0), ch).toBe(PIXEL_FONT.unitsPerEm);
      expect(atlas.glyph(ch).advance, ch).toBeLessThan(PIXEL_FONT.pixelsPerEm);
    }
  });
});

describe('Pixelschrift: Glyphenatlas aus den Konturen (M1-27)', () => {
  it('der ganze Zeichensatz backt ohne unklare Abtastung, ohne Abschneiden, ohne fehlende Zeichen', () => {
    expect(atlas.stats.glyphs).toBe([...PIXEL_FONT.charset].length);
    expect(atlas.stats.ambiguousSamples).toBe(0);
    expect(atlas.stats.clipped).toEqual([]);
    expect(atlas.stats.missing).toEqual([]);
  });

  /** [Zeichen, Vorschub, Versatz x, Versatz y (Oberkante zur Grundlinie), Bitmap]. */
  const ERWARTET: ReadonlyArray<readonly [string, number, number, number, readonly string[]]> = [
    ['5', 5, 0, -7, ['####', '#...', '#...', '###.', '...#', '...#', '###.']],
    ['S', 6, 0, -7, ['.###.', '#...#', '#....', '.###.', '....#', '#...#', '.###.']],
    [',', 4, 0, -1, ['.#', '.#', '#.']],
    ['.', 4, 1, -1, ['#']],
    [':', 4, 1, -5, ['#', '.', '.', '.', '#']],
    [';', 4, 0, -5, ['.#', '..', '..', '..', '.#', '.#', '#.']],
    ['!', 4, 1, -7, ['#', '#', '#', '#', '#', '.', '#']],
    ['?', 6, 0, -7, ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..']],
    ['„', 7, 1, -1, ['.#.#', '.#.#', '#.#.']],
    ['‚', 5, 1, -1, ['.#', '.#', '#.']],
    ['“', 7, 1, -7, ['.#..#', '#..#.', '##.##']],
    ['”', 7, 1, -7, ['##.##', '.#..#', '#..#.']],
    ['‘', 4, 1, -7, ['.#', '#.', '##']],
    ['’', 4, 1, -7, ['##', '.#', '#.']],
    ['–', 5, 0, -4, ['#####']],
    ['—', 10, 0, -4, ['#########']],
    ['×', 6, 0, -6, ['#...#', '.#.#.', '..#..', '.#.#.', '#...#']],
    ['°', 4, 0, -8, ['.#.', '#.#', '.#.']],
    ['%', 8, 0, -7, ['.#...#.', '#.#.#..', '.#..#..', '...#...', '..#..#.', '..#.#.#', '.#...#.']],
    ['·', 3, 1, -3, ['#']],
    ['…', 7, 1, -1, ['#.#.#']],
    ['Ä', 6, 0, -9, ['.#.#.', '.....', '..#..', '..#..', '.#.#.', '.#.#.', '.###.', '#...#', '#...#']],
  ];

  it.each(ERWARTET)('„%s“: Vorschub %i, Lage (%i, %i) und Form wie gezeichnet', (ch, advance, offsetX, offsetY, bitmap) => {
    const g = atlas.glyph(ch);
    expect([g.advance, g.offsetX, g.offsetY]).toEqual([advance, offsetX, offsetY]);
    expect(readBack(atlas, ch)).toEqual(bitmap);
  });

  it('5 und S, 0 und O, 1, l und I sind verschieden', () => {
    const differ = (a: string, b: string): void => expect(readBack(atlas, a).join('/'), `${a}/${b}`).not.toBe(readBack(atlas, b).join('/'));
    differ('5', 'S');
    differ('0', 'O');
    differ('1', 'l');
    differ('1', 'I');
    differ('l', 'I');
  });

  it('tiefe Anführungszeichen hängen unter die Grundlinie, hohe stehen oben bündig mit den Versalien', () => {
    const cap = atlas.glyph('H').offsetY;
    for (const ch of '„‚,') expect(atlas.glyph(ch).offsetY + atlas.glyph(ch).height, ch).toBe(2);
    for (const ch of '“”‘’') expect(atlas.glyph(ch).offsetY, ch).toBe(cap);
  });

  it('das geschützte Leerzeichen hat die Breite des Leerzeichens (wie im DOM, HarfBuzz-Ersatz)', () => {
    expect(atlas.glyph(' ')).toBe(atlas.glyph(' '));
    expect(atlas.glyph(' ').advance).toBe(5);
  });

  it('lateinischer Satz: „Funke’s“ und „Tag 3 · 12:00“ ohne Lücken aus Geviert-Zeichen', () => {
    const width = (text: string): number => layoutText(atlas, text).width;
    // ’ adds 4 px (1 + 2 + 1) between e and s, · takes 3 px between two spaces.
    expect(width('Funke’s') - width('Funkes')).toBe(4);
    expect(width('3 · 12') - width('3  12')).toBe(3);
    expect(width('„Größe“') - width('Größe')).toBeLessThanOrEqual(7 + 7);
  });
});

describe('Pixelschrift: Paket, Einbindung, CREDITS', () => {
  it('das Paket ist exakt gepinnt, Version und Lizenz stimmen', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies[PIXEL_FONT.source.npm]).toBe(PIXEL_FONT.source.version);
    const installed = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as { version: string; license: string };
    expect(installed.version).toBe(PIXEL_FONT.source.version);
    expect(installed.license).toBe(PIXEL_FONT.source.license);
  });

  it('base.css bindet genau die Schriftschnitte des Pakets ein, deren Dateien der Deskriptor nennt, und keine andere Schrift', () => {
    const css = readFileSync(join(ROOT, 'src/ui/base.css'), 'utf8');
    for (const file of PIXEL_FONT.source.files) {
      const subset = /-(latin(?:-ext)?)-(\d+)-normal\.woff$/.exec(file);
      expect(subset, file).not.toBeNull();
      expect(css).toContain(`@import '${PIXEL_FONT.source.npm}/${subset?.[1] ?? ''}-${subset?.[2] ?? ''}.css'`);
    }
    const imports = [...css.matchAll(/@import '(@fontsource\/[^/']+)\//g)].map((m) => m[1]);
    expect(new Set(imports)).toEqual(new Set([PIXEL_FONT.source.npm]));
  });

  it('CREDITS.md nennt Schrift, Urheber, Lizenz, Paket und Version sowie die eigene Ergänzungsschrift', () => {
    const credits = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8');
    for (const s of [PIXEL_FONT.family, PIXEL_FONT.source.npm, PIXEL_FONT.source.version, PIXEL_FONT.source.license, PIXEL_FONT.source.author, SATZZEICHEN.name]) expect(credits).toContain(s);
  });
});

describe('Pixelschrift: Hilfen', () => {
  it('cssFont setzt die Schrift nur in ganzzahligen Vielfachen der nativen Größe, die Ergänzungsschrift zuerst', () => {
    expect(cssFont(PIXEL_FONT)).toBe(`400 ${PIXEL_FONT.pixelsPerEm}px "${SATZZEICHEN.name}", "${PIXEL_FONT.family}"`);
    expect(cssFont(PIXEL_FONT, 3)).toBe(`400 ${PIXEL_FONT.pixelsPerEm * 3}px "${SATZZEICHEN.name}", "${PIXEL_FONT.family}"`);
  });

  it('uncoveredChars meldet fehlende Zeichen einmal; Zeilenumbrüche und Ersatzzeichen zählen als gedeckt', () => {
    expect(fontCovers(PIXEL_FONT, 'Größe Übermäßig Ärger\n„Neue Welt“ – 12 %')).toBe(true);
    expect(uncoveredChars(PIXEL_FONT, 'a→b→c★€')).toEqual(['→', '★', '€']);
  });
});
