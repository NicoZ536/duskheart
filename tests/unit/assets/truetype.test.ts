/**
 * M1-27 TrueType aus Pixelrastern (tools/assets/truetype.ts): die Ergänzungsschrift „DH Satzzeichen“
 * ist eine gültige sfnt-Datei (Tabellenverzeichnis sortiert, Prüfsummen je Tabelle und über die ganze
 * Datei), deterministisch, und Pixelraster werden zu Rechteck-Konturen auf dem 100-Einheiten-Raster.
 * Dass Chromium die Datei annimmt und mit der Hauptschrift mischt, zeigt das Screenshot-Szenario
 * `schrift`; Form und Lage der Glyphen prüft tests/unit/render/text-schrift.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { SATZZEICHEN, type PixelSchrift } from '../../../assets-src/schrift/satzzeichen';
import { buildTrueType, fontFaceCss, fontGlyphs, glyphRects, tableChecksum, unicodeRange } from '../../../tools/assets/truetype';

const SFNT_HEADER = 12;
const ENTRY = 16;
const CHECKSUM_MAGIC = 0xb1b0afba;
const REQUIRED = ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'];

interface Entry {
  readonly tag: string;
  readonly checksum: number;
  readonly offset: number;
  readonly length: number;
}

function directory(file: Uint8Array): Entry[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const n = view.getUint16(4);
  return Array.from({ length: n }, (_, i) => {
    const o = SFNT_HEADER + i * ENTRY;
    return {
      tag: String.fromCharCode(...file.subarray(o, o + 4)),
      checksum: view.getUint32(o + 4),
      offset: view.getUint32(o + 8),
      length: view.getUint32(o + 12),
    };
  });
}

describe('TrueType-Schreiber', () => {
  const file = buildTrueType(SATZZEICHEN);

  it('ist deterministisch und klein', () => {
    expect(buildTrueType(SATZZEICHEN)).toEqual(file);
    expect(file.length).toBeLessThan(4096);
    expect(new DataView(file.buffer).getUint32(0)).toBe(0x00010000);
  });

  it('enthält alle Pflichttabellen, sortiert und 4-Byte-ausgerichtet, mit stimmenden Prüfsummen', () => {
    const entries = directory(file);
    expect(entries.map((e) => e.tag)).toEqual(REQUIRED);
    for (const e of entries) {
      expect(e.offset % 4, e.tag).toBe(0);
      const data = file.subarray(e.offset, e.offset + e.length);
      if (e.tag === 'head') {
        // checkSumAdjustment (bytes 8–11) counts as 0 for the table checksum.
        const copy = Uint8Array.from(data);
        copy.fill(0, 8, 12);
        expect(tableChecksum(copy), e.tag).toBe(e.checksum);
      } else expect(tableChecksum(data), e.tag).toBe(e.checksum);
    }
    expect(tableChecksum(file)).toBe(CHECKSUM_MAGIC);
  });

  it('zerlegt Raster in Rechtecke: waagerechte Läufe, gleiche Läufe darunter zusammengefasst', () => {
    const rects = glyphRects({ vorschub: 6, oben: 4, raster: '.##.\n####\n####\n.##.' }, 100);
    expect(rects).toEqual([
      { x0: 100, y0: 400, x1: 300, y1: 500 },
      { x0: 0, y0: 200, x1: 400, y1: 400 },
      { x0: 100, y0: 100, x1: 300, y1: 200 },
    ]);
    expect(() => glyphRects({ vorschub: 2, oben: 0, raster: '#x' }, 100)).toThrow(/Zeichen „x“/);
  });

  it('Glyphen nach Codepunkt sortiert; ungültige Vorschübe und Schlüssel werden abgelehnt', () => {
    expect(fontGlyphs(SATZZEICHEN).map((g) => String.fromCodePoint(g.code)).join('')).toBe('·‘’“”•…');
    const bad = (glyphen: PixelSchrift['glyphen']): PixelSchrift => ({ ...SATZZEICHEN, glyphen });
    expect(() => fontGlyphs(bad({ '’': { vorschub: 0, oben: 6, raster: '#' } }))).toThrow(/Vorschub/);
    expect(() => fontGlyphs(bad({ ab: { vorschub: 3, oben: 6, raster: '#' } }))).toThrow(/einzelnes Zeichen/);
  });

  it('@font-face nennt Familie und unicode-range und bettet die Datei ein', () => {
    const css = fontFaceCss(SATZZEICHEN);
    expect(css).toContain(`font-family: "${SATZZEICHEN.name}";`);
    expect(css).toContain(`unicode-range: ${unicodeRange(SATZZEICHEN)};`);
    expect(css).toContain(`data:font/ttf;base64,${Buffer.from(file).toString('base64')}`);
  });
});
