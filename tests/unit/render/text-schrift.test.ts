/**
 * M1-20 Pixelschrift: the font descriptor (src/render/text/pixelFont.ts) matches the font file of
 * the pinned npm package – units per em, design grid, line metrics and character coverage – and the
 * package is pinned, loaded by base.css and credited in CREDITS.md with its licence.
 * The browser half (bake, DOM vs WebGL) is the screenshot scenario `schrift`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cssFont, fontCovers, lineHeightOf, PIXEL_FONT, uncoveredChars, unitsPerPixel } from '../../../src/render/text/pixelFont';

const ROOT = process.cwd();
const PKG_DIR = join(ROOT, 'node_modules', PIXEL_FONT.source.npm);

interface Font {
  readonly unitsPerEm: number;
  readonly cmap: ReadonlyMap<number, number>;
  /** Outline points of a glyph (composites resolved). */
  points(glyph: number): Array<readonly [number, number]>;
}

/** Minimal WOFF 1.0 reader: zlib-compressed sfnt tables, `head`, `cmap` (formats 4 and 12), `loca`, `glyf`. */
function readWoff(file: string): Font {
  const b = readFileSync(file);
  const tables = new Map<string, Buffer>();
  const numTables = b.readUInt16BE(12);
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const tag = b.toString('latin1', o, o + 4);
    const off = b.readUInt32BE(o + 4);
    const comp = b.readUInt32BE(o + 8);
    const orig = b.readUInt32BE(o + 12);
    const raw = b.subarray(off, off + comp);
    tables.set(tag, comp < orig ? inflateSync(raw) : raw);
  }
  const table = (tag: string): Buffer => {
    const t = tables.get(tag);
    if (t === undefined) throw new Error(`${file}: Tabelle ${tag} fehlt`);
    return t;
  };
  const head = table('head');
  const unitsPerEm = head.readUInt16BE(18);
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
  const points = (gid: number, dx = 0, dy = 0, out: Array<readonly [number, number]> = []): Array<readonly [number, number]> => {
    const s = offsets[gid] ?? 0;
    const e = offsets[gid + 1] ?? 0;
    if (e <= s) return out;
    const contours = glyf.readInt16BE(s);
    let p = s + 10;
    if (contours < 0) {
      for (;;) {
        const flags = glyf.readUInt16BE(p);
        const child = glyf.readUInt16BE(p + 2);
        p += 4;
        const words = (flags & 1) !== 0;
        const ax = words ? glyf.readInt16BE(p) : glyf.readInt8(p);
        const ay = words ? glyf.readInt16BE(p + 2) : glyf.readInt8(p + 1);
        p += words ? 4 : 2;
        p += (flags & 8) !== 0 ? 2 : (flags & 0x40) !== 0 ? 4 : (flags & 0x80) !== 0 ? 8 : 0;
        points(child, dx + ax, dy + ay, out);
        if ((flags & 0x20) === 0) break;
      }
      return out;
    }
    let last = 0;
    for (let i = 0; i < contours; i++) {
      last = glyf.readUInt16BE(p);
      p += 2;
    }
    p += 2 + glyf.readUInt16BE(p);
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
    xs.forEach((x, i) => out.push([x + dx, (ys[i] ?? 0) + dy]));
    return out;
  };
  return { unitsPerEm, cmap, points: (g) => points(g) };
}

const fonts = PIXEL_FONT.source.files.map((f) => readWoff(join(PKG_DIR, f)));

/** The font file that maps `ch` (the first of the subsets that has it). */
function glyphOf(ch: string): { font: Font; glyph: number } | null {
  const code = ch.codePointAt(0) ?? 0;
  for (const font of fonts) {
    const glyph = font.cmap.get(code);
    if (glyph !== undefined) return { font, glyph };
  }
  return null;
}

/** Letters, digits and the German umlauts must follow the design grid (punctuation may not, see pixelFont.ts). */
const GRID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÄÖÜäöüß';
/**
 * Largest deviation of an outline point from the grid [design px]: an edge at most 0.35 px off a cell
 * border leaves the cell ≥ 65 % or ≤ 35 % covered, so the 50 % threshold decides unambiguously.
 */
const GRID_TOLERANCE_PX = 0.35;

describe('Pixelschrift: Deskriptor gegen Schriftdatei', () => {
  it('Einheiten je Geviert stimmen, die native Größe ergibt ganze Designpixel', () => {
    for (const f of fonts) expect(f.unitsPerEm).toBe(PIXEL_FONT.unitsPerEm);
    expect(Number.isInteger(PIXEL_FONT.pixelsPerEm)).toBe(true);
    expect(unitsPerPixel(PIXEL_FONT)).toBeCloseTo(PIXEL_FONT.unitsPerEm / PIXEL_FONT.pixelsPerEm, 10);
  });

  it('jedes Zeichen des Zeichensatzes steht in der Schrift (auch ÄÖÜäöüß)', () => {
    const missing = [...PIXEL_FONT.charset].filter((ch) => glyphOf(ch) === null);
    expect(missing).toEqual([]);
    for (const ch of 'ÄÖÜäöüß') expect(PIXEL_FONT.charset).toContain(ch);
    expect(PIXEL_FONT.charset).toContain(PIXEL_FONT.fallback);
  });

  it('Buchstaben, Ziffern und Umlaute liegen auf dem Designraster; Halbpixel-Details nur bei den genannten Zeichen', () => {
    const upp = unitsPerPixel(PIXEL_FONT);
    const tolerance = GRID_TOLERANCE_PX * upp;
    const offGrid = (v: number, origin: number): number => {
      const k = Math.round((v - origin) / upp);
      return Math.abs(v - origin - k * upp);
    };
    const offending = new Set<string>();
    for (const ch of GRID_CHARS) {
      const g = glyphOf(ch);
      expect(g, ch).not.toBeNull();
      if (g === null) continue;
      for (const [x, y] of g.font.points(g.glyph)) {
        if (offGrid(x, PIXEL_FONT.gridOriginX) > tolerance || offGrid(y, PIXEL_FONT.gridOriginY) > tolerance) offending.add(ch);
      }
    }
    expect([...offending].join('')).toBe(PIXEL_FONT.halfPixelLetters);
  });

  it('Oberlänge und Unterlänge des Deskriptors fassen alle Zeichen, Umlautpunkte liegen in der obersten Zeile', () => {
    const upp = unitsPerPixel(PIXEL_FONT);
    const rowOf = (y: number): number => Math.round((y - PIXEL_FONT.gridOriginY) / upp);
    let top = -Infinity;
    let bottom = Infinity;
    for (const ch of PIXEL_FONT.charset) {
      const g = glyphOf(ch);
      if (g === null) continue;
      for (const [, y] of g.font.points(g.glyph)) {
        top = Math.max(top, rowOf(y));
        bottom = Math.min(bottom, rowOf(y));
      }
    }
    // Edges: the top edge of row r is r + 1, the bottom edge of row −d is −d.
    expect(top).toBeLessThanOrEqual(PIXEL_FONT.ascent);
    expect(bottom).toBeGreaterThanOrEqual(-PIXEL_FONT.descent);
    const u = glyphOf('Ü');
    expect(u).not.toBeNull();
    if (u !== null) expect(Math.max(...u.font.points(u.glyph).map(([, y]) => rowOf(y)))).toBe(PIXEL_FONT.ascent);
    expect(lineHeightOf(PIXEL_FONT)).toBe(PIXEL_FONT.ascent + PIXEL_FONT.descent + PIXEL_FONT.lineGap);
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

  it('base.css bindet die Schriftschnitte des Pakets ein, deren Dateien der Deskriptor nennt', () => {
    const css = readFileSync(join(ROOT, 'src/ui/base.css'), 'utf8');
    for (const file of PIXEL_FONT.source.files) {
      const subset = /-(latin(?:-ext)?)-(\d+)-normal\.woff$/.exec(file);
      expect(subset, file).not.toBeNull();
      expect(css).toContain(`@import '${PIXEL_FONT.source.npm}/${subset?.[1] ?? ''}-${subset?.[2] ?? ''}.css'`);
    }
  });

  it('CREDITS.md nennt Schrift, Urheber, Lizenz, Paket und Version', () => {
    const credits = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8');
    for (const s of [PIXEL_FONT.family, PIXEL_FONT.source.npm, PIXEL_FONT.source.version, PIXEL_FONT.source.license, PIXEL_FONT.source.author]) expect(credits).toContain(s);
  });
});

describe('Pixelschrift: Hilfen', () => {
  it('cssFont setzt die Schrift nur in ganzzahligen Vielfachen der nativen Größe', () => {
    expect(cssFont(PIXEL_FONT)).toBe(`400 ${PIXEL_FONT.pixelsPerEm}px "${PIXEL_FONT.family}"`);
    expect(cssFont(PIXEL_FONT, 3)).toBe(`400 ${PIXEL_FONT.pixelsPerEm * 3}px "${PIXEL_FONT.family}"`);
  });

  it('uncoveredChars meldet fehlende Zeichen einmal, Zeilenumbrüche zählen als gedeckt', () => {
    expect(fontCovers(PIXEL_FONT, 'Größe Übermäßig Ärger\n„Neue Welt“ – 12 %')).toBe(true);
    expect(uncoveredChars(PIXEL_FONT, 'a→b→c★')).toEqual(['→', '★']);
  });
});
