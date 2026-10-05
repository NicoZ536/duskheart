/**
 * M5-Review Minor 1: Sonnenschatten springen nicht mehr am Bildrand (MASTERPROMPT §6.1 Pass 4). Ein Empfänger sieht
 * seinen Schatten dort nach, wohin sein eigener Punkt entlang des Schattenvektors auf die Bodenebene fällt
 * (`ground + Richtung · Länge · z`); das Silhouetten-Ziel reicht dafür auf der Seite, auf die die Schatten fallen, um den
 * längsten gezeichneten Schatten des höchsten Empfängers über das Bild hinaus und um den Höhenbereich weiter nach Süden
 * (`light/shadowFrame.ts`). Werfer werden auf der Sonnenseite so weit über das Bild hinaus geschoben, wie ihr Schatten
 * reicht – ein Baum außerhalb des Bildes wirft seinen Abendschatten hinein.
 *
 * M5-48: jeder Frame löscht und zeichnet nur den Teil des Ziels, den seine eigene Schattenlänge braucht (`shadowScissor`,
 * GL-Scissor) – kein Nachschlagepunkt eines Empfängers (samt Halbschatten) liegt außerhalb, mittags ein Bruchteil der
 * Fläche.
 */
import { describe, expect, it } from 'vitest';
import { GBUFFER_HEIGHT_RANGE_PX } from '../../../src/render/gbuffer';
import { OCCLUDER_CLASS, SDF, SUN_SHADOW } from '../../../src/render/light/params';
import { casterReach, drawnShadowLength, SHADOW_LOOKUP_REACH_PX, shadowScissor, shadowTargetOrigin, shadowTargetSize } from '../../../src/render/light/shadowFrame';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { sceneAtlas } from '../../../src/render/assets/sceneSprites';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { findLightPipeline, installLightPipeline } from '../../../src/render/light/pipeline';
import { splitDaylight } from '../../../src/render/light/skyMath';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { createFakeGl } from './fakeGl';
import { SHADERS } from '../../../src/render/shaderLib';

const VIEW = { left: 1000, top: 500, width: 480, height: 270 };
const M = SDF.marginPx;
/** The tallest object of the world (trees, §4.4) – the game view's `OBJECT_REACH_PX`. */
const TALLEST = 96;

/** Shadow directions all round (unit vectors, +y south) and calendar lengths up to the horizon's. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = Array.from({ length: 16 }, (_, i) => [Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)]);
const LENGTHS = [0.3, 1, 2.4, 3];

describe('Silhouetten-Ziel über den Bildrand hinaus (M5-Review Minor 1)', () => {
  it('jeder Empfänger der Ansicht findet seinen Nachschlagepunkt im Ziel – jede Richtung, jede Länge, jede Höhe', () => {
    const size = shadowTargetSize(VIEW.width, VIEW.height, M);
    const origin = new Float32Array(2);
    for (const [sx, sy] of DIRECTIONS) {
      for (const length of LENGTHS) {
        shadowTargetOrigin(VIEW.left, VIEW.top, M, sx, sy, origin);
        const l = drawnShadowLength(length);
        for (const x of [VIEW.left, VIEW.left + VIEW.width / 2, VIEW.left + VIEW.width - 1]) {
          for (const screenY of [VIEW.top, VIEW.top + VIEW.height - 1]) {
            for (const z of [0, 16, 48, 96, GBUFFER_HEIGHT_RANGE_PX]) {
              // A pixel drawn at screenY with height z stands on the ground z px further south.
              const gy = screenY + z;
              const ax = x + sx * l * z;
              const ay = gy + sy * l * z;
              expect(ax).toBeGreaterThanOrEqual(origin[0] ?? NaN);
              expect(ax).toBeLessThan((origin[0] ?? NaN) + size.width);
              expect(ay).toBeGreaterThanOrEqual(origin[1] ?? NaN);
              expect(ay).toBeLessThan((origin[1] ?? NaN) + size.height);
            }
          }
        }
      }
    }
  });

  it('die Reichweite ist der längste gezeichnete Schatten des höchsten Empfängers; das Ziel wächst nur einmal', () => {
    expect(SHADOW_LOOKUP_REACH_PX).toBe(Math.ceil(SUN_SHADOW.maxLength * GBUFFER_HEIGHT_RANGE_PX));
    const size = shadowTargetSize(VIEW.width, VIEW.height, M);
    expect(size.width).toBe(VIEW.width + 2 * M + SHADOW_LOOKUP_REACH_PX);
    expect(size.height).toBe(VIEW.height + 2 * M + GBUFFER_HEIGHT_RANGE_PX + SHADOW_LOOKUP_REACH_PX);
    // Shadows east and south: the reach lies east and south, the target starts at the margin.
    const o = shadowTargetOrigin(VIEW.left, VIEW.top, M, 0.8, 0.6, new Float32Array(2));
    expect([o[0], o[1]]).toEqual([VIEW.left - M, VIEW.top - M]);
    // West and north: it starts a reach further west and north.
    shadowTargetOrigin(VIEW.left, VIEW.top, M, -0.8, -0.6, o);
    expect([o[0], o[1]]).toEqual([VIEW.left - M - SHADOW_LOOKUP_REACH_PX, VIEW.top - M - SHADOW_LOOKUP_REACH_PX]);
  });

  it('Werfer auf der Sonnenseite: die Silhouette eines Baums außerhalb der geschobenen Fläche erreicht das Bild nicht', () => {
    for (const [sx, sy] of DIRECTIONS) {
      for (const length of LENGTHS) {
        const reach = casterReach(sx, sy, length, TALLEST, { left: 0, top: 0, right: 0, bottom: 0 });
        const l = drawnShadowLength(length) * TALLEST;
        // The tip of the tallest caster's shadow lies within the pushed extension: a caster beyond it never reaches the view.
        expect(reach.left + reach.right).toBeCloseTo(Math.abs(sx) * l, 9);
        expect(reach.top + reach.bottom).toBeCloseTo(Math.abs(sy) * l, 9);
        if (sx > 0) expect(reach.right).toBe(0);
        if (sx < 0) expect(reach.left).toBe(0);
        if (sy > 0) expect(reach.bottom).toBe(0);
        if (sy < 0) expect(reach.top).toBe(0);
      }
    }
    // Evening, shadows long to the east: casters up to 2.4 × 96 px west of the view.
    const evening = casterReach(1, 0, 3, TALLEST, { left: 0, top: 0, right: 0, bottom: 0 });
    expect(evening.left).toBeCloseTo(SUN_SHADOW.maxLength * TALLEST, 9);
  });

  it('die Shader lesen und schreiben das Ziel in seiner eigenen Lage', () => {
    const reader = (SHADERS['shadow.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(reader).toContain('ivec2 t = shadowTexel(at); if (!shadowInside(t)) return vec3(1.0);');
    expect(reader).not.toContain('sdfTexel(at)');
    for (const vert of ['shadow_sprite.vert', 'shadow_prism.vert', 'shadow_block.vert']) {
      const src = (SHADERS[vert] ?? '').replace(/\s+/g, ' ');
      expect(src).toContain('vec2 q = (world - uShadowFrame.xy) / uShadowFrame.zw * 2.0 - 1.0;');
    }
    // The ground under a caster point comes from the mask at the fragment's world point, not its texel.
    const ground = (SHADERS['shadow_ground.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(ground).toContain('vec2 q = shadowFragWorld() - uSdfFrame.xy;');
  });
});

/** The world rectangle [x0, x1) × [y0, y1) of GL scissor `box` in the target placed at `origin` of `size`. */
function boxWorld(box: Int32Array, origin: Float32Array, size: { width: number; height: number }): [number, number, number, number] {
  const ox = origin[0] ?? NaN;
  const oy = origin[1] ?? NaN;
  const x = box[0] ?? NaN;
  const y = box[1] ?? NaN;
  return [ox + x, ox + x + (box[2] ?? NaN), oy + size.height - y - (box[3] ?? NaN), oy + size.height - y];
}

describe('Genutzter Teil des Silhouetten-Ziels (M5-48)', () => {
  it('jeder Nachschlagepunkt samt Halbschatten liegt im Scissor des Frames – jede Richtung, jede Länge, jede Höhe', () => {
    const size = shadowTargetSize(VIEW.width, VIEW.height, M);
    const origin = new Float32Array(2);
    const box = new Int32Array(4);
    // Every lookup and tap; the ones outside the scissor are collected and checked in one expect (four expects per tap
    // were 100 000 calls, M6-93).
    const draussen: string[] = [];
    for (const [sx, sy] of DIRECTIONS) {
      for (const length of [0, 0.05, ...LENGTHS]) {
        shadowTargetOrigin(VIEW.left, VIEW.top, M, sx, sy, origin);
        shadowScissor(VIEW.width, VIEW.height, M, sx, sy, length, size.width, size.height, box);
        // Inside the target.
        expect(box[0]).toBeGreaterThanOrEqual(0);
        expect(box[1]).toBeGreaterThanOrEqual(0);
        expect((box[0] ?? 0) + (box[2] ?? 0)).toBeLessThanOrEqual(size.width);
        expect((box[1] ?? 0) + (box[3] ?? 0)).toBeLessThanOrEqual(size.height);
        const [x0, x1, y0, y1] = boxWorld(box, origin, size);
        const l = drawnShadowLength(length);
        for (const x of [VIEW.left, VIEW.left + VIEW.width / 2, VIEW.left + VIEW.width - 1]) {
          for (const screenY of [VIEW.top, VIEW.top + VIEW.height / 2, VIEW.top + VIEW.height - 1]) {
            for (const z of [0, 8, 16, 48, 96, GBUFFER_HEIGHT_RANGE_PX]) {
              const gy = screenY + z;
              // The lookup (in float32 like the shader) and its four penumbra taps.
              const ax = Math.fround(x + Math.fround(sx) * Math.fround(l * z));
              const ay = Math.fround(gy + Math.fround(sy) * Math.fround(l * z));
              for (const [dx, dy] of [
                [0, 0],
                [SUN_SHADOW.maxPenumbraPx, 0],
                [-SUN_SHADOW.maxPenumbraPx, 0],
                [0, SUN_SHADOW.maxPenumbraPx],
                [0, -SUN_SHADOW.maxPenumbraPx],
              ] as const) {
                const tx = Math.floor(ax + dx);
                const ty = Math.floor(ay + dy);
                if (!(tx >= x0 && tx < x1 && ty >= y0 && ty < y1)) draussen.push(`${sx} ${sy} ${length} ${x} ${screenY} ${z} (${dx}, ${dy}): (${tx}, ${ty}) außerhalb [${x0}, ${x1}) × [${y0}, ${y1})`);
              }
            }
          }
        }
      }
    }
    expect(draussen).toEqual([]);
  });

  it('mittags ein Bruchteil des Ziels, am Abend fast alles; der längste Schatten nutzt die Reichweite ganz', () => {
    const size = shadowTargetSize(VIEW.width, VIEW.height, M);
    const area = (sx: number, sy: number, length: number): number => {
      const b = shadowScissor(VIEW.width, VIEW.height, M, sx, sy, length, size.width, size.height, new Int32Array(4));
      return ((b[2] ?? 0) * (b[3] ?? 0)) / (size.width * size.height);
    };
    // Noon (shadows 0.3 × the height, towards the north): about half of the target.
    expect(area(0, -1, 0.3)).toBeLessThan(0.62);
    expect(area(0.2, -0.98, 0.3)).toBeLessThan(0.62);
    // Evening, the longest drawn shadow diagonally: most of the target; along an axis its reach in full on that axis.
    expect(area(Math.SQRT1_2, Math.SQRT1_2, 3)).toBeGreaterThan(0.75);
    expect(area(-1, 0, SUN_SHADOW.maxLength)).toBeCloseTo((VIEW.width + 2 * M + SHADOW_LOOKUP_REACH_PX) / size.width * ((VIEW.height + 2 * M + GBUFFER_HEIGHT_RANGE_PX) / size.height), 9);
    // The box grows with the length and never shrinks the frame, its margin and the height range south.
    let last = 0;
    for (const length of [0, 0.3, 0.6, 1, 1.6, 2.4]) {
      const a = area(0.6, 0.8, length);
      expect(a).toBeGreaterThanOrEqual(last);
      last = a;
    }
    const noSun = shadowScissor(VIEW.width, VIEW.height, M, 0, 0, 0, size.width, size.height, new Int32Array(4));
    expect([noSun[2], noSun[3]]).toEqual([VIEW.width + 2 * M, VIEW.height + 2 * M + GBUFFER_HEIGHT_RANGE_PX]);
  });

  it('der Schattenpass löscht und zeichnet im Scissor und schaltet ihn danach ab', () => {
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    const pipeline = findLightPipeline(r.passes) ?? installLightPipeline(r.passes);
    const run = pipeline.shadow.execute.bind(pipeline.shadow);
    let calls: { name: string; args: readonly unknown[] }[] = [];
    pipeline.shadow.execute = (ctx) => {
      const from = fake.calls.length;
      run(ctx);
      calls = fake.calls.slice(from);
    };
    const s = new RenderScene();
    s.beginFrame(1);
    s.atlas = sceneAtlas();
    s.sky.occluders.rect(-200, -200, 200, -60, 16, OCCLUDER_CLASS.terrain, true, 16);
    splitDaylight(0.5, 0.14, s.sky.directional);
    s.sky.directional.shadowX = 0.6;
    s.sky.directional.shadowY = -0.8;
    s.sky.directional.shadowLength = 0.35;
    s.sky.sunCasters.block(-40, 0, 40, 6, 0, 16);
    r.render(s, 480, 270, 'sharp');
    const names = calls.map((c) => c.name);
    const scissorTest = fake.gl.SCISSOR_TEST;
    const on = calls.findIndex((c) => c.name === 'enable' && c.args[0] === scissorTest);
    const off = calls.findIndex((c) => c.name === 'disable' && c.args[0] === scissorTest);
    const clear = names.indexOf('clearBufferfv');
    expect(on).toBeGreaterThanOrEqual(0);
    expect(on).toBeLessThan(clear);
    expect(off).toBeGreaterThan(names.lastIndexOf('drawArraysInstanced'));
    // The frame (the view and its border of a pixel): the target's size less margin, reach and height range.
    const target = pipeline.shadow.texture();
    const size = { width: target?.width ?? NaN, height: target?.height ?? NaN };
    const fw = size.width - 2 * M - SHADOW_LOOKUP_REACH_PX;
    const fh = size.height - 2 * M - GBUFFER_HEIGHT_RANGE_PX - SHADOW_LOOKUP_REACH_PX;
    expect(fw).toBeGreaterThanOrEqual(480);
    expect(fh).toBeGreaterThanOrEqual(270);
    const box = shadowScissor(fw, fh, M, 0.6, -0.8, 0.35, size.width, size.height, new Int32Array(4));
    expect(calls.find((c) => c.name === 'scissor')?.args).toEqual(Array.from(box));
    expect((box[2] ?? 0) * (box[3] ?? 0)).toBeLessThan(0.6 * size.width * size.height);
  });
});
