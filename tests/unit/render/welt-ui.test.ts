/**
 * M1-23 Weltnahe UI (src/render/worldUi/worldUi.ts, src/render/passes/worldUiPass.ts): die Liste
 * je Frame (gepoolte Einträge, Raritäts- und Leistenfarben aus der Palette), Aufstieg und Ausblenden
 * der Schadenszahlen, Leistenfüllung, und der Pass: läuft nach Licht, Post und Outline, zeichnet alles
 * in einem instanzierten Draw-Call ins LDR-Ziel auf ganzen Zielpixeln, meldet sich unvollständig,
 * solange die Schrift fehlt. WebGL ist die aufzeichnende Attrappe.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_HEX, PALETTE_RAMPS, RARITY_REFS, UI_HEX } from '../../../src/generated/palette';
import { sceneAtlas } from '../../../src/render/assets/sceneSprites';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { paletteRefHex, paletteRefIndex } from '../../../src/render/palette/rows';
import { PASS_ORDER } from '../../../src/render/passes/registry';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { createSceneSource } from '../../../src/render/scenes';
import { SHADERS } from '../../../src/render/shaderLib';
import { GlyphAtlas, INK, type CellWindow, type GlyphRasterizer } from '../../../src/render/text/glyphAtlas';
import type { PixelFontSpec } from '../../../src/render/text/pixelFont';
import { rgbaFromHex, TEXT_INSTANCE_STRIDE, TEXT_MODE, TEXT_OFFSET } from '../../../src/render/text/textBatch';
import {
  BAR_COLORS,
  barFill,
  DAMAGE_COLORS,
  DAMAGE_FADE_START,
  DAMAGE_LIFETIME,
  DAMAGE_RISE_PX,
  damageOpacity,
  damageRise,
  LABEL_COLORS,
  WORLD_UI_COLORS,
  WorldUiList,
} from '../../../src/render/worldUi/worldUi';
import { createFakeGl } from './fakeGl';

/** A block font: every glyph is a 3 × 5 ink rectangle on the baseline, advance 4, space 2. */
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

function renderer() {
  const fake = createFakeGl();
  const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
  return { fake, r };
}

interface Instance {
  x: number;
  y: number;
  w: number;
  h: number;
  mode: number;
  color: number;
}

/** Instance records of the last instanced upload of the text program (the world UI batch). */
function instances(fake: ReturnType<typeof createFakeGl>, count: number): Instance[] {
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

describe('Welt-UI-Liste', () => {
  it('Farben stammen aus der Master-Palette: Raritäten (§4.5), UI-Farben, Leisten wie das UI-Kit', () => {
    expect(paletteRefIndex('nacht.0', PALETTE_RAMPS)).toBe(1);
    expect(paletteRefHex('feuer.2', PALETTE_RAMPS, PALETTE_HEX)).toBe(PALETTE_HEX[paletteRefIndex('feuer.2', PALETTE_RAMPS) - 1]);
    expect(() => paletteRefIndex('feuer.9', PALETTE_RAMPS)).toThrow(/Stufe 9/);
    expect(() => paletteRefIndex('gibtsnicht.1', PALETTE_RAMPS)).toThrow(/unbekannte Rampe/);
    for (const [tone, ref] of Object.entries(RARITY_REFS)) expect(LABEL_COLORS[tone as keyof typeof RARITY_REFS]).toBe(rgbaFromHex(paletteRefHex(ref, PALETTE_RAMPS, PALETTE_HEX)));
    expect(LABEL_COLORS.name).toBe(rgbaFromHex(UI_HEX.text));
    expect(LABEL_COLORS.feind).toBe(rgbaFromHex(UI_HEX.warnung));
    expect(WORLD_UI_COLORS.outline).toBe(rgbaFromHex(UI_HEX.dunkel));
    expect(BAR_COLORS.leben.light).toBe(rgbaFromHex(paletteRefHex('feuer.2', PALETTE_RAMPS, PALETTE_HEX)));
    expect(DAMAGE_COLORS.kritisch).toBe(rgbaFromHex(UI_HEX.akzent));
  });

  it('füllt gepoolte Einträge je Frame, ohne neue Objekte bei gleicher Anzahl', () => {
    const list = new WorldUiList();
    list.label(1, 2, 'Mara', 'episch');
    list.bar(3, 4, 20, 5, 10, 'ausdauer');
    list.marker(5, 6, 'E', 'Fackel nehmen');
    expect(list.count).toBe(3);
    const first = list.entry(0);
    expect(first).toMatchObject({ kind: 'label', x: 1, y: 2, text: 'Mara', color: LABEL_COLORS.episch });
    expect(list.entry(1)).toMatchObject({ kind: 'bar', width: 20, value: 5, max: 10, bar: 'ausdauer' });
    expect(list.entry(2)).toMatchObject({ kind: 'marker', key: 'E', text: 'Fackel nehmen' });
    expect(list.entry(3)).toBeUndefined();
    list.clear();
    expect(list.count).toBe(0);
    list.damage(0, 0, '12', 0.1, 'kritisch');
    expect(list.entry(0)).toBe(first);
    expect(list.entry(0)).toMatchObject({ kind: 'damage', text: '12', color: DAMAGE_COLORS.kritisch });
    // An expired damage number is not queued at all.
    list.damage(0, 0, '3', DAMAGE_LIFETIME);
    expect(list.count).toBe(1);
  });

  it('Schadenszahlen steigen mit Ausklingen auf und blenden in harten Stufen aus', () => {
    expect(damageRise(0)).toBe(0);
    expect(damageRise(DAMAGE_LIFETIME)).toBe(DAMAGE_RISE_PX);
    let last = -1;
    for (let t = 0; t <= DAMAGE_LIFETIME; t += DAMAGE_LIFETIME / 30) {
      const r = damageRise(t);
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
    // Ease-out: the first half of the life covers more than half of the rise.
    expect(damageRise(DAMAGE_LIFETIME / 2)).toBeGreaterThan(DAMAGE_RISE_PX / 2);
    expect(damageOpacity(0)).toBe(1);
    expect(damageOpacity(DAMAGE_LIFETIME * DAMAGE_FADE_START * 0.99)).toBe(1);
    expect(damageOpacity(-0.1)).toBe(0);
    expect(damageOpacity(DAMAGE_LIFETIME)).toBe(0);
    const steps = new Set<number>();
    for (let t = DAMAGE_LIFETIME * DAMAGE_FADE_START + 1e-6; t < DAMAGE_LIFETIME; t += DAMAGE_LIFETIME / 200) steps.add(damageOpacity(t));
    expect([...steps].every((o) => o > 0 && o < 1)).toBe(true);
    expect(steps.size).toBeLessThanOrEqual(3);
  });

  it('Leistenfüllung: gerundet, mindestens ein Pixel solange etwas übrig ist, nie über die Breite', () => {
    expect(barFill(20, 0, 50)).toBe(0);
    expect(barFill(20, 0.1, 50)).toBe(1);
    expect(barFill(20, 34, 50)).toBe(14);
    expect(barFill(20, 80, 50)).toBe(20);
    expect(barFill(20, 5, 0)).toBe(0);
  });
});

describe('Welt-UI-Pass', () => {
  it('läuft als letzter Pass nach Licht, Post und Outline', () => {
    const { r } = renderer();
    const names = r.passes.list().map((p) => p.name);
    expect(names.at(-1)).toBe('welt-ui');
    expect(PASS_ORDER.worldUi).toBeGreaterThan(PASS_ORDER.outline);
    expect(names.indexOf('welt-ui')).toBeGreaterThan(names.indexOf('post'));
  });

  it('ohne Schrift nichts zeichnen und unvollständig melden; mit Schrift ein Draw-Call auf ganzen Pixeln', () => {
    const { r, fake } = renderer();
    const scene = new RenderScene();
    scene.atlas = sceneAtlas();
    scene.camera.set(0.4, 0.3);
    const fill = (): void => {
      scene.beginFrame(0);
      scene.worldUi.label(10.4, 20.6, 'Mara', 'name');
      scene.worldUi.bar(10, 24, 20, 34, 50, 'leben');
    };
    fill();
    r.render(scene, 1920, 1080, 'sharp');
    expect(r.worldUi.complete).toBe(false);
    expect(r.worldUi.hasGlyphs).toBe(false);

    r.worldUi.setGlyphs(new GlyphAtlas(SPEC, raster, { preload: SPEC.charset }));
    fill();
    const drawsBefore = fake.count('drawArraysInstanced');
    r.render(scene, 1920, 1080, 'sharp');
    expect(r.worldUi.complete).toBe(true);
    // Sprites (none here) are drawn by the batcher; the world UI is exactly one more instanced call.
    const textDraw = fake.calls.filter((c) => c.name === 'drawArraysInstanced').at(-1);
    expect(fake.count('drawArraysInstanced') - drawsBefore).toBeGreaterThanOrEqual(1);
    const glyphs = 4;
    const barRects = 5 + 4;
    expect(textDraw?.args[3]).toBe(glyphs + barRects);
    const inst = instances(fake, glyphs + barRects);
    // Camera (0.4, 0.3) → view origin (−239.6, −134.7) → whole-pixel target origin (−241, −136).
    const originX = -241;
    const originY = -136;
    const labelTop = Math.round(20.6) - originY - SPEC.ascent;
    const glyphTop = labelTop + SPEC.ascent - GLYPH_H - 1;
    expect(inst.slice(0, glyphs).every((g) => g.mode === TEXT_MODE.outline && g.color === LABEL_COLORS.name)).toBe(true);
    expect(inst[0]?.y).toBe(glyphTop);
    const labelWidth = glyphs * 4 - 1;
    expect(inst[0]?.x).toBe(Math.round(10.4) - originX - Math.floor(labelWidth / 2) - 1);
    // Bar: 4 frame rects, empty rows, fill (34/50 of 20 = 14 px: 13 px + brighter end column).
    const bar = inst.slice(glyphs);
    const left = 10 - originX - 10;
    const top = 24 - originY;
    expect(bar[0]).toMatchObject({ x: left, y: top, w: 20, h: 1, mode: TEXT_MODE.rect, color: WORLD_UI_COLORS.outline });
    expect(bar[4]).toMatchObject({ x: left, y: top + 1, w: 20, h: 2, color: WORLD_UI_COLORS.barEmpty });
    expect(bar[5]).toMatchObject({ x: left, y: top + 1, w: 13, h: 1, color: BAR_COLORS.leben.light });
    expect(bar[8]).toMatchObject({ x: left + 13, y: top + 2, w: 1, h: 1, color: BAR_COLORS.leben.endBody });
    for (const i of inst) {
      expect(Number.isInteger(i.x)).toBe(true);
      expect(Number.isInteger(i.y)).toBe(true);
    }
  });

  it('Interaktionsmarker: Tastenkappe mit Taste und Aktionstext auf gemeinsamer Grundlinie', () => {
    const { r, fake } = renderer();
    r.worldUi.setGlyphs(new GlyphAtlas(SPEC, raster, { preload: SPEC.charset }));
    const scene = new RenderScene();
    scene.atlas = sceneAtlas();
    scene.beginFrame(0);
    scene.worldUi.marker(0, 0, 'E', 'Mar');
    r.render(scene, 1920, 1080, 'sharp');
    const count = 6 + 1 + 3;
    const inst = instances(fake, count);
    const face = inst[4];
    const key = inst[6];
    const text = inst[7];
    expect(face?.color).toBe(WORLD_UI_COLORS.keyFace);
    expect(inst[5]?.color).toBe(WORLD_UI_COLORS.keyShade);
    expect(key).toMatchObject({ mode: TEXT_MODE.plain, color: WORLD_UI_COLORS.keyInk });
    expect(text?.mode).toBe(TEXT_MODE.outline);
    // Same baseline: key glyph and action glyphs start on the same row.
    expect(text?.y).toBe(key?.y);
    // The cap (border 1 + padding 2) holds the key's ink; the group is centred on the anchor.
    const capLeft = inst[2]?.x ?? 0;
    expect((key?.x ?? 0) + 1).toBe(capLeft + 1 + 2);
    const groupRight = (inst[9]?.x ?? 0) + 1 + GLYPH_W;
    expect(Math.abs(capLeft + groupRight - 2 * (0 - -241))).toBeLessThanOrEqual(1);
  });

  it('die Welt-UI-Szene füllt Namen, Leisten, Zahlen und Marker in beiden Sprachen', () => {
    const texts: string[] = [];
    const src = createSceneSource('welt-ui', { gameAtlas: () => sceneAtlas(), t: (key) => (texts.push(key), key) });
    const { r } = renderer();
    src.activate?.(r);
    const scene = new RenderScene();
    scene.beginFrame(0.5);
    src.fill(scene, 0.5);
    const kinds = new Set<string>();
    for (let i = 0; i < scene.worldUi.count; i++) kinds.add(scene.worldUi.entry(i)?.kind ?? '');
    expect([...kinds].sort()).toEqual(['bar', 'damage', 'label', 'marker']);
    expect(texts).toContain('render.weltUi.spieler');
    expect(texts).toContain('render.weltUi.fackelNehmen');
    src.deactivate?.(r);
  });
});
