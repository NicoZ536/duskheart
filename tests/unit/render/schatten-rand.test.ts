/**
 * M5-Review Minor 1: Sonnenschatten springen nicht mehr am Bildrand (MASTERPROMPT §6.1 Pass 4). Ein Empfänger sieht
 * seinen Schatten dort nach, wohin sein eigener Punkt entlang des Schattenvektors auf die Bodenebene fällt
 * (`ground + Richtung · Länge · z`); das Silhouetten-Ziel reicht dafür auf der Seite, auf die die Schatten fallen, um den
 * längsten gezeichneten Schatten des höchsten Empfängers über das Bild hinaus und um den Höhenbereich weiter nach Süden
 * (`light/shadowFrame.ts`). Werfer werden auf der Sonnenseite so weit über das Bild hinaus geschoben, wie ihr Schatten
 * reicht – ein Baum außerhalb des Bildes wirft seinen Abendschatten hinein.
 */
import { describe, expect, it } from 'vitest';
import { GBUFFER_HEIGHT_RANGE_PX } from '../../../src/render/gbuffer';
import { SDF, SUN_SHADOW } from '../../../src/render/light/params';
import { casterReach, drawnShadowLength, SHADOW_LOOKUP_REACH_PX, shadowTargetOrigin, shadowTargetSize } from '../../../src/render/light/shadowFrame';
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
