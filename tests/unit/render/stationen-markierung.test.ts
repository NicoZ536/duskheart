/**
 * The interaction marker over stations and objects (M4-38; MASTERPROMPT §26 "automatische Tastensymbole", §4.6): the
 * world UI pass draws the key cap sprite `hinweis_taste` of the hint glyphs (assets-src/sprites/icons/hinweise.ts – the
 * cap the HUD and the build mode show) in its palette colours, the key's name centred in its face (rows 3–10) and the
 * action text beside it on the same baseline; a longer name stretches the face while both rims stay (nine-slice); an
 * atlas without the sprite (render debug scenes) keeps the pass's drawn cap. WebGL is the recording stand-in.
 */
import { describe, expect, it } from 'vitest';
import HINWEISE from '../../../assets-src/sprites/icons/hinweise';
import { PALETTE_HEX } from '../../../src/generated/palette';
import type { AtlasData, AtlasSprite } from '../../../src/render/assets/atlas';
import { sceneAtlas } from '../../../src/render/assets/sceneSprites';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { KEY_CAP_FACE, KEY_CAP_RIM, KEY_CAP_SPRITE, KeyCapShape } from '../../../src/render/passes/keyCap';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { GlyphAtlas, INK, type CellWindow, type GlyphRasterizer } from '../../../src/render/text/glyphAtlas';
import type { PixelFontSpec } from '../../../src/render/text/pixelFont';
import { rgbaFromHex, TEXT_INSTANCE_STRIDE, TEXT_MODE, TEXT_OFFSET } from '../../../src/render/text/textBatch';
import { WORLD_UI_COLORS } from '../../../src/render/worldUi/worldUi';
import { createFakeGl } from './fakeGl';

const CAP = (() => {
  const s = HINWEISE.find((x) => x.id === KEY_CAP_SPRITE);
  if (s === undefined) throw new Error('hinweis_taste fehlt');
  return s;
})();
const RGBA = 4;

/** Colour of source pixel (x, y) of the cap, 0 transparent. */
function capColor(x: number, y: number): number {
  const i = CAP.frames[0]?.index[y * CAP.w + x] ?? 0;
  return i === 0 ? 0 : rgbaFromHex(PALETTE_HEX[i - 1] as string);
}

/** `base` with the real key cap sprite added below its content (albedo R = palette index, as the atlas stores it). */
function withCap(base: AtlasData): AtlasData {
  const m = base.manifest;
  if (base.albedo.kind !== 'pixels' || base.normal.kind !== 'pixels') throw new Error('Pixelatlas erwartet');
  const top = m.height + 1;
  const height = top + CAP.h;
  const albedo = new Uint8Array(m.width * height * RGBA);
  albedo.set(base.albedo.pixels as Uint8Array);
  const normal = new Uint8Array(m.width * height * RGBA);
  normal.set(base.normal.pixels as Uint8Array);
  const f = CAP.frames[0];
  if (f === undefined) throw new Error('Kappe ohne Frame');
  for (let y = 0; y < CAP.h; y++)
    for (let x = 0; x < CAP.w; x++) {
      const i = f.index[y * CAP.w + x] ?? 0;
      if (i === 0) continue;
      const o = ((top + y) * m.width + x) * RGBA;
      albedo[o] = i;
      albedo[o + 3] = 255;
      normal.set([128, 128, 0, 255], o);
    }
  const sprite: AtlasSprite = {
    id: KEY_CAP_SPRITE,
    group: 'hinweise',
    size: [CAP.w, CAP.h],
    frames: [{ x: 0, y: top, w: CAP.w, h: CAP.h, ax: CAP.anchor[0], ay: CAP.anchor[1] }],
    clips: {},
    sockets: {},
    heightHint: 'flach',
    emissive: false,
    symmetric: CAP.spiegelbar,
  };
  return { manifest: { ...m, height, sprites: { ...m.sprites, [KEY_CAP_SPRITE]: sprite } }, albedo: { kind: 'pixels', pixels: albedo }, normal: { kind: 'pixels', pixels: normal } };
}

/** Paints queued rectangles into a grid relative to (x0, y0). */
function painter(x0 = 0, y0 = 0) {
  const grid = new Map<string, number>();
  return {
    grid,
    rect(x: number, y: number, w: number, h: number, color: number) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) grid.set(`${x - x0 + i},${y - y0 + j}`, color);
    },
    at: (x: number, y: number) => grid.get(`${x},${y}`) ?? 0,
  };
}

/** A block font: every glyph is a 3 × 5 ink rectangle on the baseline, advance 4, space 2 (as in welt-ui.test.ts). */
const SPEC: PixelFontSpec = {
  family: 'Blockschrift',
  weight: 400,
  unitsPerEm: 800,
  pixelsPerEm: 8,
  gridOriginX: 0,
  gridOriginY: 0,
  ascent: 7,
  descent: 2,
  lineGap: 1,
  charset: 'EMar +0123456789?',
  fallback: '?',
  halfPixelLetters: '',
  source: { npm: '@test/block', version: '1.0.0', license: 'OFL-1.1', author: 'Test', files: [] },
};
const GLYPH_W = 3;
const GLYPH_H = 5;
const raster: GlyphRasterizer = {
  advance: (ch) => (ch === ' ' ? 2 : 4),
  sample(ch: string, w: CellWindow) {
    const out = new Uint8Array(w.cols * w.rows);
    if (ch === ' ') return out;
    for (let y = 0; y < w.rows; y++) {
      const row = w.rowMax - y;
      for (let x = 0; x < w.cols; x++) {
        const col = w.colMin + x;
        if (col >= 0 && col < GLYPH_W && row >= 0 && row < GLYPH_H) out[y * w.cols + x] = INK;
      }
    }
    return out;
  },
};

interface Instance {
  x: number;
  y: number;
  w: number;
  h: number;
  mode: number;
  color: number;
}

/** Instance records of the last instanced draw of the text program (the world UI batch). */
function lastInstances(fake: ReturnType<typeof createFakeGl>): Instance[] {
  const count = fake.calls.filter((c) => c.name === 'drawArraysInstanced').at(-1)?.args[3] as number;
  const upload = fake.calls.filter((c) => c.name === 'bufferSubData').at(-1);
  const bytes = upload?.args[2] as Uint8Array;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const out: Instance[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * TEXT_INSTANCE_STRIDE;
    out.push({
      x: view.getInt16(o + TEXT_OFFSET.pos, true),
      y: view.getInt16(o + TEXT_OFFSET.pos + 2, true),
      w: view.getUint16(o + TEXT_OFFSET.box, true),
      h: view.getUint16(o + TEXT_OFFSET.box + 2, true),
      mode: bytes[o + TEXT_OFFSET.mode] ?? -1,
      color: view.getUint32(o + TEXT_OFFSET.color, false),
    });
  }
  return out;
}

function renderMarker(atlas: AtlasData, key: string, text: string): Instance[] {
  const fake = createFakeGl();
  const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
  r.worldUi.setGlyphs(new GlyphAtlas(SPEC, raster, { preload: SPEC.charset }));
  const scene = new RenderScene();
  scene.atlas = atlas;
  scene.beginFrame(0);
  scene.worldUi.marker(0, 0, key, text);
  r.render(scene, 1920, 1080, 'sharp');
  return lastInstances(fake);
}

describe('Tastenkappe der Interaktionsmarker (hinweis_taste)', () => {
  it('liest die Kappe aus dem Atlas: Ränder 3 px, Fläche 10 px, Unterkante in Zeile 13; ohne Sprite keine', () => {
    expect(KeyCapShape.from(sceneAtlas())).toBeNull();
    const cap = KeyCapShape.from(withCap(sceneAtlas()));
    if (cap === null) throw new Error('Kappe nicht gelesen');
    expect(cap.height).toBe(16);
    expect(cap.bottomRow).toBe(13);
    expect(cap.faceWidth).toBe(16 - KEY_CAP_RIM.left - KEY_CAP_RIM.right);
    // One letter fits the face; a longer name widens it by its ink and a pixel of padding either side.
    expect(cap.widthFor(GLYPH_W)).toBe(16);
    expect(cap.widthFor(20)).toBe(KEY_CAP_RIM.left + 22 + KEY_CAP_RIM.right);
  });

  it('ungestreckt Pixel für Pixel das Sprite in seinen Palettenfarben; gestreckt bleiben die Ränder, die Fläche wächst', () => {
    const cap = KeyCapShape.from(withCap(sceneAtlas())) as KeyCapShape;
    const plain = painter(40, 30);
    cap.draw(plain, 40, 30, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(plain.at(x, y), `${x},${y}`).toBe(capColor(x, y));
    const wide = painter();
    cap.draw(wide, 0, 0, 28);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 28; x++) {
        const src = x < KEY_CAP_RIM.left ? x : x >= 28 - KEY_CAP_RIM.right ? x - 12 : KEY_CAP_RIM.left + ((x - KEY_CAP_RIM.left) % 10);
        expect(wide.at(x, y), `${x},${y}`).toBe(capColor(src, y));
      }
    expect(new Set(wide.grid.values()).size).toBe(new Set(Array.from({ length: 256 }, (_, i) => capColor(i % 16, Math.floor(i / 16))).filter((c) => c !== 0)).size);
  });

  it('der Pass zeichnet die Sprite-Kappe: die Taste mittig in ihrer Fläche, der Text auf derselben Grundlinie, die Unterkante am Ziel', () => {
    const inst = renderMarker(withCap(sceneAtlas()), 'E', 'Mar');
    const rects = inst.filter((i) => i.mode === TEXT_MODE.rect);
    const key = inst.find((i) => i.mode === TEXT_MODE.plain && i.color === WORLD_UI_COLORS.keyInk);
    const text = inst.filter((i) => i.mode === TEXT_MODE.outline);
    if (key === undefined) throw new Error('Taste fehlt');
    expect(text).toHaveLength(3);
    // The cap's first pixels: row 1 from column 2, column 1 from row 2.
    const capL = Math.min(...rects.map((r) => r.x)) - 1;
    const capT = Math.min(...rects.map((r) => r.y)) - 1;
    const grid = painter(capL, capT);
    for (const r of rects) grid.rect(r.x, r.y, r.w, r.h, r.color);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(grid.at(x, y), `${x},${y}`).toBe(capColor(x, y));
    // The key's ink (glyph cells carry a 1 px margin) centred in the face (columns 3–12, rows 3–10).
    const inkLeft = key.x + 1 - capL;
    const inkTop = key.y + 1 - capT;
    expect(inkLeft).toBe(KEY_CAP_RIM.left + Math.floor((10 - GLYPH_W) / 2));
    expect(inkTop).toBe(KEY_CAP_FACE.top + Math.floor((KEY_CAP_FACE.bottom - KEY_CAP_FACE.top + 1 - GLYPH_H) / 2));
    expect(inkTop + GLYPH_H - 1).toBeLessThanOrEqual(KEY_CAP_FACE.bottom);
    for (const g of text) expect(g.y).toBe(key.y);
    // Camera (0, 0) → whole-pixel target origin (−241, −136): the cap's last row sits right above the anchor's row.
    expect(capT + 13).toBe(136 - 1);
    const groupRight = Math.max(...text.map((g) => g.x)) + 1 + GLYPH_W;
    expect(Math.abs(capL + groupRight - 2 * 241)).toBeLessThanOrEqual(1);
  });

  it('ohne das Sprite bleibt die gezeichnete Kappe des Passes', () => {
    const inst = renderMarker(sceneAtlas(), 'E', 'Mar');
    expect(inst.some((i) => i.mode === TEXT_MODE.rect && i.color === WORLD_UI_COLORS.keyFace)).toBe(true);
  });
});
