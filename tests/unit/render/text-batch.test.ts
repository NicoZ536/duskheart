/**
 * M1-20/M1-23 Text-Batch (src/render/text/textBatch.ts): Instanz-Datensätze auf ganzen Zielpixeln,
 * Effekte und Rechtecke, ein instanzierter Draw-Call, Wachstum ohne Datenverlust, Nachladen des
 * Atlas bei neuen Glyphen, Kontextverlust. WebGL ist durch die aufzeichnende Attrappe ersetzt.
 */
import { describe, expect, it } from 'vitest';
import { GpuResourceRegistry } from '../../../src/render/gl/resources';
import { GLYPH_PADDING, GlyphAtlas, INK, type CellWindow, type GlyphRasterizer } from '../../../src/render/text/glyphAtlas';
import type { PixelFontSpec } from '../../../src/render/text/pixelFont';
import { packRgba, rgbaFromHex, TEXT_INSTANCE_STRIDE, TEXT_MODE, TEXT_OFFSET, TextBatch } from '../../../src/render/text/textBatch';
import { createFakeGl } from './fakeGl';

const SPEC: PixelFontSpec = {
  family: 'Testschrift',
  weight: 400,
  unitsPerEm: 800,
  pixelsPerEm: 8,
  gridOriginX: 0,
  gridOriginY: 0,
  ascent: 7,
  descent: 2,
  lineGap: 1,
  charset: 'IL ?',
  fallback: '?',
  halfPixelLetters: '',
  source: { npm: '@test/schrift', version: '1.0.0', license: 'OFL-1.1', author: 'Test', files: [] },
};

/** "I" = 1 × 7 column, "L" = 3 × 7 L-shape, "?" = 2 × 2 block; all advances 4, space 2. */
const raster: GlyphRasterizer = {
  advance: (ch) => (ch === ' ' ? 2 : 4),
  sample(ch: string, w: CellWindow) {
    const out = new Uint8Array(w.cols * w.rows);
    for (let y = 0; y < w.rows; y++) {
      const row = w.rowMax - y;
      for (let x = 0; x < w.cols; x++) {
        const col = w.colMin + x;
        const ink = ch === 'I' ? col === 0 && row >= 0 && row <= 6 : ch === 'L' ? (col === 0 && row >= 0 && row <= 6) || (row === 0 && col >= 0 && col <= 2) : ch === '?' ? col >= 0 && col <= 1 && row >= 0 && row <= 1 : false;
        if (ink) out[y * w.cols + x] = INK;
      }
    }
    return out;
  },
};

function setup(initialInstances?: number) {
  const fake = createFakeGl();
  const resources = new GpuResourceRegistry();
  const atlas = new GlyphAtlas(SPEC, raster);
  const batch = new TextBatch(fake.gl, resources, atlas, initialInstances === undefined ? {} : { initialInstances });
  return { fake, resources, atlas, batch };
}

function instance(batch: TextBatch, i: number) {
  const b = batch.instanceBytes;
  const o = i * TEXT_INSTANCE_STRIDE;
  const view = new DataView(b.buffer, b.byteOffset);
  const i16 = (k: number) => view.getInt16(o + k, true);
  const u16 = (k: number) => view.getUint16(o + k, true);
  return {
    x: i16(TEXT_OFFSET.pos),
    y: i16(TEXT_OFFSET.pos + 2),
    w: u16(TEXT_OFFSET.box),
    h: u16(TEXT_OFFSET.box + 2),
    u: u16(TEXT_OFFSET.box + 4),
    v: u16(TEXT_OFFSET.box + 6),
    mode: b[o + TEXT_OFFSET.mode],
    color: [...b.subarray(o + TEXT_OFFSET.color, o + TEXT_OFFSET.color + 4)],
    effect: [...b.subarray(o + TEXT_OFFSET.effect, o + TEXT_OFFSET.effect + 4)],
  };
}

describe('Text-Batch', () => {
  it('Farben: #rrggbb + Alpha → 0xRRGGBBAA, ungültige Angaben werfen', () => {
    expect(rgbaFromHex('#f4ecd8')).toBe(0xf4ecd8ff);
    expect(rgbaFromHex('#120e18', 128)).toBe(0x120e1880);
    expect(packRgba(1, 2, 3, 4)).toBe(0x01020304);
    expect(() => rgbaFromHex('f4ecd8')).toThrow(/#rrggbb/);
  });

  it('schreibt je Glyphe die gepolsterte Atlaszelle auf ganze Zielpixel, mit Farbe und Effekt', () => {
    const { batch, atlas } = setup();
    batch.begin(320, 180);
    batch.text('LI', 10, 20, { color: 0x11223344, effect: 'outline', effectColor: 0x55667788 });
    expect(batch.count).toBe(2);
    const l = atlas.glyph('L');
    const first = instance(batch, 0);
    // Bitmap top = block top + ascent + offsetY; the padded cell starts one pixel up and left.
    expect(first).toEqual({ x: 10 + l.offsetX - GLYPH_PADDING, y: 20 + SPEC.ascent + l.offsetY - GLYPH_PADDING, w: 3 + 2, h: 7 + 2, u: l.atlasX, v: l.atlasY, mode: TEXT_MODE.outline, color: [0x11, 0x22, 0x33, 0x44], effect: [0x55, 0x66, 0x77, 0x88] });
    expect(instance(batch, 1).x).toBe(10 + 4 - GLYPH_PADDING);
  });

  it('richtet am Ankerpunkt aus (Mitte, rechts) und rundet auf ganze Pixel', () => {
    const { batch } = setup();
    batch.begin(320, 180);
    const l = batch.text('LL', 100.4, 50.6, { color: 0xffffffff, align: 'center' });
    const x0 = instance(batch, 0).x + GLYPH_PADDING;
    expect(x0).toBe(100 - Math.floor(l.width / 2));
    expect(instance(batch, 0).y).toBe(51 + SPEC.ascent - 7 - GLYPH_PADDING);
    batch.text('L', 200, 0, { color: 0xffffffff, align: 'right' });
    expect(instance(batch, 2).x + GLYPH_PADDING + 3).toBe(200);
  });

  it('Rechtecke und Schatten haben eigene Modi; weit außerhalb liegende Instanzen entfallen', () => {
    const { batch } = setup();
    batch.begin(320, 180);
    batch.rect(4, 5, 30.2, 2, 0xff0000ff);
    batch.text('I', 0, 0, { color: 0xffffffff, effect: 'shadow', effectColor: 0x000000ff });
    batch.rect(0, 0, 0, 5, 0xff0000ff);
    batch.text('I', 40000, 0, { color: 0xffffffff });
    expect(batch.count).toBe(2);
    expect(instance(batch, 0)).toMatchObject({ x: 4, y: 5, w: 30, h: 2, mode: TEXT_MODE.rect, color: [255, 0, 0, 255] });
    expect(instance(batch, 1).mode).toBe(TEXT_MODE.shadow);
  });

  it('zeichnet alles in einem instanzierten Draw-Call und setzt danach zurück', () => {
    const { batch, fake } = setup();
    batch.begin(320, 180);
    batch.text('LIL I', 0, 0, { color: 0xffffffff });
    const n = batch.count;
    expect(batch.end()).toBe(1);
    const draw = fake.calls.filter((c) => c.name === 'drawArraysInstanced');
    expect(draw).toHaveLength(1);
    expect(draw[0]?.args.slice(1)).toEqual([0, 4, n]);
    expect(fake.count('enable')).toBe(1);
    expect(fake.count('disable')).toBe(1);
    expect(batch.count).toBe(0);
    batch.begin(320, 180);
    expect(batch.end()).toBe(0);
    expect(fake.count('drawArraysInstanced')).toBe(1);
  });

  it('wächst über die Anfangskapazität hinaus, ohne frühere Datensätze zu verlieren', () => {
    const { batch } = setup(2);
    batch.begin(320, 180);
    batch.rect(1, 2, 3, 4, 0x01020304);
    batch.text('LLLLL', 0, 0, { color: 0xffffffff });
    expect(batch.count).toBe(6);
    expect(batch.capacity).toBeGreaterThanOrEqual(6);
    expect(instance(batch, 0)).toMatchObject({ x: 1, y: 2, w: 3, h: 4, color: [1, 2, 3, 4] });
  });

  it('lädt den Atlas neu hoch, sobald neue Glyphen gebacken wurden', () => {
    const { batch, fake } = setup();
    const uploads = () => fake.calls.filter((c) => c.name === 'texImage2D').length;
    const before = uploads();
    batch.begin(320, 180);
    batch.text('I', 0, 0, { color: 0xffffffff });
    batch.end();
    const afterFirst = uploads();
    expect(afterFirst).toBe(before + 1);
    batch.begin(320, 180);
    batch.text('I', 0, 0, { color: 0xffffffff });
    batch.end();
    expect(uploads()).toBe(afterFirst);
    batch.begin(320, 180);
    batch.text('L', 0, 0, { color: 0xffffffff });
    batch.end();
    expect(uploads()).toBe(afterFirst + 1);
  });

  it('übersteht Kontextverlust: nichts zeichnen solange verloren, danach alles neu aufgebaut', () => {
    const { batch, fake, resources, atlas } = setup();
    atlas.ensure('IL');
    fake.lose();
    resources.loseAll();
    batch.begin(320, 180);
    batch.text('I', 0, 0, { color: 0xffffffff });
    expect(batch.end()).toBe(0);
    fake.restore();
    resources.restoreAll();
    expect(batch.texture.handle).not.toBeNull();
    const upload = fake.calls.filter((c) => c.name === 'texImage2D').at(-1);
    expect(upload?.args.at(-1)).toBe(atlas.pixels);
    batch.begin(320, 180);
    batch.text('I', 0, 0, { color: 0xffffffff });
    expect(batch.end()).toBe(1);
  });

  it('gibt beim Entsorgen alle eigenen GPU-Ressourcen frei', () => {
    const { batch, resources } = setup();
    expect(resources.count).toBe(5);
    batch.dispose();
    expect(resources.count).toBe(0);
  });
});
