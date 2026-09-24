/**
 * TrueType aus Pixelrastern (M1-27, ADR-0016): baut die Ergänzungsschrift
 * `assets-src/schrift/satzzeichen.ts` (lateinische Satzzeichen der Pixelschrift) als TrueType-Datei
 * und liefert ihre `@font-face`-Regel, die der UI-Schritt in `src/generated/ui-kit.css` schreibt –
 * mit der Schrift als `data:`-URL (≈ 2 KB): keine eigene Datei, die der PWA-Cache kennen oder der
 * Build umschreiben müsste, und sie ist geladen, sobald das Stylesheet es ist.
 *
 * Jede Glyphe ist ein Pixelraster; jedes Rechteck gleich gefärbter Pixel wird eine im Uhrzeigersinn
 * laufende Kontur auf dem 100-Einheiten-Raster (nur Punkte auf der Kurve, keine Hinting-Anweisungen).
 * So liegt jede Kante bei nativer Größe und bei jedem ganzzahligen Vielfachen genau auf einer
 * Pixelkante: DOM und Glyphenatlas sehen harte 0/1-Deckung, wie bei der Hauptschrift.
 *
 * Tabellen: `OS/2`, `cmap` (Format 4), `glyf`, `head`, `hhea`, `hmtx`, `loca` (lang), `maxp` (1.0),
 * `name`, `post` (3.0) mit Prüfsummen und `checkSumAdjustment` – deterministisch (feste Zeitstempel).
 */
import { rasterRows } from '../../assets-src/lib/sprite';
import type { PixelGlyphe, PixelSchrift } from '../../assets-src/schrift/satzzeichen';

/** Ein Rechteck in Schrifteinheiten (y nach oben, Grundlinie = 0). */
export interface GlyphRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Eine Glyphe in Schrifteinheiten. */
export interface FontGlyph {
  readonly code: number;
  readonly advance: number;
  readonly rects: readonly GlyphRect[];
}

const INK = '#';
const EMPTY = '.';

/**
 * Zerlegt das Raster einer Glyphe in Rechtecke: waagerechte Läufe je Zeile, senkrecht gleiche Läufe
 * zusammengefasst. `unit` = Schrifteinheiten je Designpixel.
 */
export function glyphRects(g: PixelGlyphe, unit: number, where = 'Glyphe'): GlyphRect[] {
  const rows = rasterRows(g.raster);
  const runs: Array<{ c0: number; c1: number; top: number; bottom: number }> = [];
  rows.forEach((row, i) => {
    const designRow = g.oben - i;
    let c = 0;
    while (c < row.length) {
      const ch = row[c];
      if (ch !== INK && ch !== EMPTY) throw new Error(`${where}: Zeichen „${ch ?? ''}“ in Zeile ${i} (erlaubt: ${INK} ${EMPTY})`);
      if (ch !== INK) {
        c++;
        continue;
      }
      let end = c;
      while (row[end + 1] === INK) end++;
      const open = runs.find((r) => r.c0 === c && r.c1 === end && r.bottom === designRow + 1);
      if (open !== undefined) open.bottom = designRow;
      else runs.push({ c0: c, c1: end, top: designRow, bottom: designRow });
      c = end + 1;
    }
  });
  return runs.map((r) => ({ x0: r.c0 * unit, y0: r.bottom * unit, x1: (r.c1 + 1) * unit, y1: (r.top + 1) * unit }));
}

/** Alle Glyphen der Schrift, nach Codepunkt sortiert (so bildet `cmap` Läufe auf Läufe ab). */
export function fontGlyphs(font: PixelSchrift): FontGlyph[] {
  const unit = font.metrik.einheitenJePixel;
  return Object.entries(font.glyphen)
    .map(([ch, g]) => {
      if ([...ch].length !== 1) throw new Error(`${font.name}: Schlüssel „${ch}“ ist kein einzelnes Zeichen`);
      if (!Number.isInteger(g.vorschub) || g.vorschub <= 0) throw new Error(`${font.name} „${ch}“: Vorschub ${g.vorschub} ist keine positive ganze Zahl`);
      return { code: ch.codePointAt(0) ?? 0, advance: g.vorschub * unit, rects: glyphRects(g, unit, `${font.name} „${ch}“`) };
    })
    .sort((a, b) => a.code - b.code);
}

// ---------------------------------------------------------------------------------------------
// TrueType-Schreiber
// ---------------------------------------------------------------------------------------------

/** Kleiner Big-Endian-Puffer. */
class Bytes {
  private readonly parts: number[] = [];
  u8(v: number): this {
    this.parts.push(v & BYTE);
    return this;
  }
  u16(v: number): this {
    return this.u8(v >>> BYTE_BITS).u8(v);
  }
  i16(v: number): this {
    return this.u16(v < 0 ? v + U16_RANGE : v);
  }
  u32(v: number): this {
    return this.u16(Math.floor(v / U16_RANGE) % U16_RANGE).u16(v % U16_RANGE);
  }
  tag(t: string): this {
    for (let i = 0; i < TAG_LENGTH; i++) this.u8(t.charCodeAt(i));
    return this;
  }
  bytes(b: Uint8Array): this {
    for (const v of b) this.parts.push(v);
    return this;
  }
  get length(): number {
    return this.parts.length;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

const BYTE = 0xff;
const BYTE_BITS = 8;
const U16_RANGE = 0x10000;
const U32_RANGE = 0x100000000;
const TAG_LENGTH = 4;
/** Tabellen werden auf 4 Byte ausgerichtet. */
const ALIGN = 4;
/** Punkte je Rechteck-Kontur. */
const POINTS_PER_RECT = 4;
/** `maxp` 1.0: Felder nach `maxZones` (Twilight, Speicher, Funktionen, Stapel, Anweisungen, Komponenten) – alle 0. */
const MAXP_ZERO_FIELDS = 8;
/** `hhea`: vier reservierte Felder und `metricDataFormat` – alle 0. */
const HHEA_ZERO_FIELDS = 5;
/** OS/2: Länge der PANOSE-Klassifikation (unbestimmt = 0). */
const PANOSE_BYTES = 10;
/** Schriftversion 1.0 als Fixed 16.16. */
const FONT_REVISION = 0x00010000;
/** sfnt-Version für TrueType-Konturen. */
const SFNT_TRUETYPE = 0x00010000;
/** `head`: Magische Zahl, Prüfsummen-Basis, Flags (Grundlinie bei y = 0, lsb = xMin, ganzzahlige Skalierung). */
const HEAD_MAGIC = 0x5f0f3cf5;
const CHECKSUM_BASE = 0xb1b0afba;
const HEAD_FLAGS = 0b1011;
/** Kleinste lesbare Größe [px] = native Größe der Pixelschrift. */
const LOWEST_REC_PPEM = 10;
/** `head.fontDirectionHint`: nur links-nach-rechts, auch neutrale Zeichen. */
const DIRECTION_HINT = 2;
/** `head.indexToLocFormat`: lange `loca`-Einträge. */
const LOCA_LONG = 1;
/** Fester Erstellungszeitpunkt (Sekunden seit 1904-01-01): 2026-09-23 00:00 UTC – deterministische Datei. */
const CREATED_1904 = 3_873_398_400;
/** Glyphe 0 (.notdef) ist leer; ihr Vorschub in Designpixeln. */
const NOTDEF_ADVANCE_PX = 5;
/** `glyf`-Flag „Punkt auf der Kurve“ (x und y als int16-Deltas). */
const ON_CURVE = 0x01;
/** `maxp` 1.0: Zonen (Glyphenzone + Twilight). */
const MAX_ZONES = 2;
/** OS/2 Version 4, Gewicht, Breite, fsSelection REGULAR. */
const OS2_VERSION = 4;
const WEIGHT_REGULAR = 400;
const WIDTH_NORMAL = 5;
const FS_SELECTION_REGULAR = 0x40;
/** OS/2 ulUnicodeRange1: Bit 1 Latin-1-Ergänzung, Bit 31 Allgemeine Interpunktion. */
const UNICODE_RANGE_1 = (1 << 1) + 2 ** 31;
/** OS/2 ulCodePageRange1: Bit 0 Latin 1 (1252). */
const CODEPAGE_LATIN1 = 1;
/** Hoch-/Tiefstellung und Durchstreichung als Anteile des Gevierts (OS/2-Pflichtfelder). */
const SUB_SUPER_SIZE = 0.65;
const SUB_OFFSET = 0.14;
const SUPER_OFFSET = 0.48;
const STRIKEOUT_POSITION = 0.3;
const SPACE_CODE = 0x20;
/** `post` 3.0: keine Glyphennamen; Unterstreichung 1 px unter der Grundlinie. */
const POST_VERSION_3 = 0x00030000;
/** `name`: Windows, Unicode BMP, Englisch (USA); Unicode-Plattform für `cmap`. */
const PLATFORM_UNICODE = 0;
const ENCODING_UNICODE_BMP = 3;
const PLATFORM_WINDOWS = 3;
const ENCODING_WINDOWS_BMP = 1;
const LANGUAGE_EN_US = 0x0409;
const CMAP_FORMAT_4 = 4;
const CMAP_LAST_CODE = 0xffff;
const NAME_IDS = { copyright: 0, family: 1, subfamily: 2, unique: 3, full: 4, version: 5, postscript: 6, license: 13 } as const;
/** `name`: Kopf (Format, Anzahl, Stringoffset) und ein Eintrag (Plattform, Kodierung, Sprache, Id, Länge, Offset) in Byte. */
const NAME_HEADER_BYTES = 6;
const NAME_RECORD_BYTES = 12;
/** `cmap` Format 4: fester Kopf plus `reservedPad` (16 Byte) und vier Felder je Segment (8 Byte). */
const CMAP4_FIXED_BYTES = 16;
const CMAP4_SEGMENT_BYTES = 8;
/** `cmap`-Kopf: Version + Anzahl (4 Byte) und zwei Kodierungseinträge zu je 8 Byte. */
const CMAP_HEADER_BYTES = 4;
const CMAP_ENCODING_RECORDS = 2;
const CMAP_ENCODING_RECORD_BYTES = 8;
/** sfnt: Tabellenverzeichnis-Kopf und ein Verzeichniseintrag in Byte. */
const SFNT_HEADER_BYTES = 12;
const SFNT_ENTRY_BYTES = 16;
/** `head.checkSumAdjustment` liegt 8 Byte nach Tabellenbeginn. */
const HEAD_CHECKSUM_OFFSET = 8;
/** Bitpositionen der Bytes eines Big-Endian-uint32. */
const SHIFT_BYTE_3 = 24;
const SHIFT_BYTE_2 = 16;

function pad(b: Uint8Array): Uint8Array {
  const n = Math.ceil(b.length / ALIGN) * ALIGN;
  if (n === b.length) return b;
  const out = new Uint8Array(n);
  out.set(b);
  return out;
}

/** Prüfsumme einer Tabelle (Summe der Big-Endian-uint32, mit Nullen aufgefüllt). */
export function tableChecksum(b: Uint8Array): number {
  const p = pad(b);
  let sum = 0;
  for (let i = 0; i < p.length; i += ALIGN) sum = (sum + (((p[i] ?? 0) << SHIFT_BYTE_3) >>> 0) + ((p[i + 1] ?? 0) << SHIFT_BYTE_2) + ((p[i + 2] ?? 0) << BYTE_BITS) + (p[i + 3] ?? 0)) % U32_RANGE;
  return sum;
}

function log2Floor(n: number): number {
  return Math.floor(Math.log2(n));
}

interface Bounds {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

function boundsOf(rects: readonly GlyphRect[]): Bounds | null {
  if (rects.length === 0) return null;
  return {
    xMin: Math.min(...rects.map((r) => r.x0)),
    yMin: Math.min(...rects.map((r) => r.y0)),
    xMax: Math.max(...rects.map((r) => r.x1)),
    yMax: Math.max(...rects.map((r) => r.y1)),
  };
}

/** Einfache Glyphe: je Rechteck eine Kontur im Uhrzeigersinn (unten links → oben links → oben rechts → unten rechts). */
function glyfEntry(rects: readonly GlyphRect[]): Uint8Array {
  const b = boundsOf(rects);
  if (b === null) return new Uint8Array(0);
  const out = new Bytes().i16(rects.length).i16(b.xMin).i16(b.yMin).i16(b.xMax).i16(b.yMax);
  rects.forEach((_, i) => out.u16(i * POINTS_PER_RECT + POINTS_PER_RECT - 1));
  out.u16(0);
  const points = rects.flatMap((r) => [
    [r.x0, r.y0],
    [r.x0, r.y1],
    [r.x1, r.y1],
    [r.x1, r.y0],
  ]);
  for (let i = 0; i < points.length; i++) out.u8(ON_CURVE);
  let px = 0;
  for (const [x = 0] of points) {
    out.i16(x - px);
    px = x;
  }
  let py = 0;
  for (const [, y = 0] of points) {
    out.i16(y - py);
    py = y;
  }
  return out.done();
}

function utf16be(s: string): Uint8Array {
  const b = new Bytes();
  for (let i = 0; i < s.length; i++) b.u16(s.charCodeAt(i));
  return b.done();
}

function nameTable(font: PixelSchrift): Uint8Array {
  const records: Array<[number, string]> = [
    [NAME_IDS.copyright, `© ${font.urheber}`],
    [NAME_IDS.family, font.name],
    [NAME_IDS.subfamily, 'Regular'],
    [NAME_IDS.unique, `${font.postscript} ${font.version}`],
    [NAME_IDS.full, font.name],
    [NAME_IDS.version, `Version ${font.version}`],
    [NAME_IDS.postscript, font.postscript],
    [NAME_IDS.license, font.lizenz],
  ];
  const strings = records.map(([, s]) => utf16be(s));
  const header = new Bytes().u16(0).u16(records.length).u16(NAME_HEADER_BYTES + NAME_RECORD_BYTES * records.length);
  let offset = 0;
  records.forEach(([id], i) => {
    const len = strings[i]?.length ?? 0;
    header.u16(PLATFORM_WINDOWS).u16(ENCODING_WINDOWS_BMP).u16(LANGUAGE_EN_US).u16(id).u16(len).u16(offset);
    offset += len;
  });
  for (const s of strings) header.bytes(s);
  return header.done();
}

/** `cmap` mit einer Format-4-Tabelle (Läufe aufeinanderfolgender Codepunkte über idDelta). */
function cmapTable(glyphs: readonly FontGlyph[]): Uint8Array {
  const segments: Array<{ start: number; end: number; gid: number }> = [];
  glyphs.forEach((g, i) => {
    const last = segments.at(-1);
    if (last !== undefined && g.code === last.end + 1) last.end = g.code;
    else segments.push({ start: g.code, end: g.code, gid: i + 1 });
  });
  segments.push({ start: CMAP_LAST_CODE, end: CMAP_LAST_CODE, gid: 0 });
  const segCount = segments.length;
  const searchRange = 2 * 2 ** log2Floor(segCount);
  const sub = new Bytes();
  const length = CMAP4_FIXED_BYTES + CMAP4_SEGMENT_BYTES * segCount;
  sub.u16(CMAP_FORMAT_4).u16(length).u16(0).u16(segCount * 2).u16(searchRange).u16(log2Floor(segCount)).u16(segCount * 2 - searchRange);
  for (const s of segments) sub.u16(s.end);
  sub.u16(0);
  for (const s of segments) sub.u16(s.start);
  // Die Schlusssegment-Delta 1 bildet 0xFFFF auf Glyphe 0 ab.
  for (const s of segments) sub.u16((s.start === CMAP_LAST_CODE ? 1 : s.gid - s.start + U16_RANGE) % U16_RANGE);
  for (let i = 0; i < segCount; i++) sub.u16(0);
  const subtable = sub.done();
  const headerLength = CMAP_HEADER_BYTES + CMAP_ENCODING_RECORDS * CMAP_ENCODING_RECORD_BYTES;
  return new Bytes().u16(0).u16(CMAP_ENCODING_RECORDS).u16(PLATFORM_UNICODE).u16(ENCODING_UNICODE_BMP).u32(headerLength).u16(PLATFORM_WINDOWS).u16(ENCODING_WINDOWS_BMP).u32(headerLength).bytes(subtable).done();
}

/** Baut die TrueType-Datei der Schrift. */
export function buildTrueType(font: PixelSchrift): Uint8Array {
  const m = font.metrik;
  const glyphs = fontGlyphs(font);
  const numGlyphs = glyphs.length + 1;
  const all: Array<{ advance: number; rects: readonly GlyphRect[] }> = [{ advance: NOTDEF_ADVANCE_PX * m.einheitenJePixel, rects: [] }, ...glyphs];
  const boxes = all.map((g) => boundsOf(g.rects));
  const drawn = boxes.filter((b): b is Bounds => b !== null);
  const bbox: Bounds = {
    xMin: Math.min(...drawn.map((b) => b.xMin)),
    yMin: Math.min(...drawn.map((b) => b.yMin)),
    xMax: Math.max(...drawn.map((b) => b.xMax)),
    yMax: Math.max(...drawn.map((b) => b.yMax)),
  };

  const glyf = new Bytes();
  const loca = new Bytes();
  for (const g of all) {
    loca.u32(glyf.length);
    glyf.bytes(pad(glyfEntry(g.rects)));
  }
  loca.u32(glyf.length);

  const hmtx = new Bytes();
  all.forEach((g, i) => hmtx.u16(g.advance).i16(boxes[i]?.xMin ?? 0));

  const maxPoints = Math.max(...all.map((g) => g.rects.length * POINTS_PER_RECT));
  const maxContours = Math.max(...all.map((g) => g.rects.length));
  const maxp = new Bytes().u32(SFNT_TRUETYPE).u16(numGlyphs).u16(maxPoints).u16(maxContours).u16(0).u16(0).u16(MAX_ZONES);
  for (let i = 0; i < MAXP_ZERO_FIELDS; i++) maxp.u16(0);

  const head = new Bytes()
    .u16(1)
    .u16(0)
    .u32(FONT_REVISION)
    .u32(0)
    .u32(HEAD_MAGIC)
    .u16(HEAD_FLAGS)
    .u16(m.einheitenJeGeviert)
    .u32(0)
    .u32(CREATED_1904)
    .u32(0)
    .u32(CREATED_1904)
    .i16(bbox.xMin)
    .i16(bbox.yMin)
    .i16(bbox.xMax)
    .i16(bbox.yMax)
    .u16(0)
    .u16(LOWEST_REC_PPEM)
    .i16(DIRECTION_HINT)
    .i16(LOCA_LONG)
    .i16(0);

  const advances = all.map((g) => g.advance);
  // Seitenabstände nur über gezeichnete Glyphen (die leere .notdef hat keine).
  const lsb = drawn.map((b) => b.xMin);
  const rsb = all.flatMap((g, i) => {
    const b = boxes[i];
    return b === null || b === undefined ? [] : [g.advance - b.xMax];
  });
  const hhea = new Bytes()
    .u16(1)
    .u16(0)
    .i16(m.oberlaenge)
    .i16(-m.unterlaenge)
    .i16(0)
    .u16(Math.max(...advances))
    .i16(Math.min(...lsb))
    .i16(Math.min(...rsb))
    .i16(bbox.xMax)
    .i16(1)
    .i16(0)
    .i16(0);
  for (let i = 0; i < HHEA_ZERO_FIELDS; i++) hhea.i16(0);
  hhea.u16(numGlyphs);

  const em = m.einheitenJeGeviert;
  const scaled = (f: number): number => Math.round(f * em);
  const os2 = new Bytes()
    .u16(OS2_VERSION)
    .i16(Math.round(advances.reduce((a, b) => a + b, 0) / advances.length))
    .u16(WEIGHT_REGULAR)
    .u16(WIDTH_NORMAL)
    .u16(0)
    .i16(scaled(SUB_SUPER_SIZE))
    .i16(scaled(SUB_SUPER_SIZE))
    .i16(0)
    .i16(scaled(SUB_OFFSET))
    .i16(scaled(SUB_SUPER_SIZE))
    .i16(scaled(SUB_SUPER_SIZE))
    .i16(0)
    .i16(scaled(SUPER_OFFSET))
    .i16(m.einheitenJePixel)
    .i16(scaled(STRIKEOUT_POSITION))
    .i16(0);
  for (let i = 0; i < PANOSE_BYTES; i++) os2.u8(0);
  os2.u32(UNICODE_RANGE_1).u32(0).u32(0).u32(0).tag('NONE').u16(FS_SELECTION_REGULAR);
  os2.u16(glyphs[0]?.code ?? SPACE_CODE).u16(glyphs.at(-1)?.code ?? SPACE_CODE);
  os2.i16(m.oberlaenge).i16(-m.unterlaenge).i16(0).u16(m.oberlaenge).u16(m.unterlaenge);
  os2.u32(CODEPAGE_LATIN1).u32(0).i16(m.xHoehe * m.einheitenJePixel).i16(m.versalhoehe * m.einheitenJePixel).u16(0).u16(SPACE_CODE).u16(1);

  const post = new Bytes().u32(POST_VERSION_3).u32(0).i16(-m.einheitenJePixel).i16(m.einheitenJePixel).u32(0).u32(0).u32(0).u32(0).u32(0);

  const tables: Array<[string, Uint8Array]> = [
    ['OS/2', os2.done()],
    ['cmap', cmapTable(glyphs)],
    ['glyf', glyf.done()],
    ['head', head.done()],
    ['hhea', hhea.done()],
    ['hmtx', hmtx.done()],
    ['loca', loca.done()],
    ['maxp', maxp.done()],
    ['name', nameTable(font)],
    ['post', post.done()],
  ];
  const numTables = tables.length;
  const searchRange = 2 ** log2Floor(numTables) * SFNT_ENTRY_BYTES;
  const dir = new Bytes().u32(SFNT_TRUETYPE).u16(numTables).u16(searchRange).u16(log2Floor(numTables)).u16(numTables * SFNT_ENTRY_BYTES - searchRange);
  let offset = SFNT_HEADER_BYTES + SFNT_ENTRY_BYTES * numTables;
  const body = new Bytes();
  let headOffset = 0;
  for (const [tag, data] of tables) {
    dir.tag(tag).u32(tableChecksum(data)).u32(offset).u32(data.length);
    if (tag === 'head') headOffset = offset;
    const padded = pad(data);
    body.bytes(padded);
    offset += padded.length;
  }
  const file = new Uint8Array(dir.length + body.length);
  file.set(dir.done());
  file.set(body.done(), dir.length);
  // head.checkSumAdjustment (Byte 8 der Tabelle) = 0xB1B0AFBA − Prüfsumme der ganzen Datei.
  const adjust = (CHECKSUM_BASE - tableChecksum(file) + U32_RANGE) % U32_RANGE;
  const at = headOffset + HEAD_CHECKSUM_OFFSET;
  file[at] = Math.floor(adjust / 2 ** SHIFT_BYTE_3) & BYTE;
  file[at + 1] = (adjust >>> SHIFT_BYTE_2) & BYTE;
  file[at + 2] = (adjust >>> BYTE_BITS) & BYTE;
  file[at + 3] = adjust & BYTE;
  return file;
}

// ---------------------------------------------------------------------------------------------
// CSS und Schritt
// ---------------------------------------------------------------------------------------------

/** `unicode-range` der Schrift, zusammenhängende Codepunkte als Bereich (`U+2018-2019`). */
export function unicodeRange(font: PixelSchrift): string {
  const codes = fontGlyphs(font).map((g) => g.code);
  const parts: string[] = [];
  for (let i = 0; i < codes.length; ) {
    const start = codes[i] ?? 0;
    let end = start;
    while (codes[i + 1] === end + 1) {
      end++;
      i++;
    }
    i++;
    const hex = (c: number): string => c.toString(16).toUpperCase();
    parts.push(start === end ? `U+${hex(start)}` : `U+${hex(start)}-${hex(end)}`);
  }
  return parts.join(', ');
}

/** `@font-face` der Schrift: nur für ihre Zeichen (`unicode-range`), die Datei als `data:`-URL. */
export function fontFaceCss(font: PixelSchrift): string {
  const data = Buffer.from(buildTrueType(font)).toString('base64');
  return [
    '@font-face {',
    `  font-family: "${font.name}";`,
    '  font-style: normal;',
    '  font-weight: 400;',
    '  font-display: block;',
    `  src: url("data:font/ttf;base64,${data}") format("truetype");`,
    `  unicode-range: ${unicodeRange(font)};`,
    '}',
  ].join('\n');
}
