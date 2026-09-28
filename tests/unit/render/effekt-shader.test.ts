/**
 * M5-24 „Effekt-Shader: … Weißblitz, Palettenwechsel-Effekte, Dither-Fades“ – the pure rules the sprite program
 * follows (their TypeScript mirrors in src/render/surface/rules.ts, the shader lines checked against them) and the
 * instance data that carries them (src/render/batch/spriteList.ts), plus the effect scenes of the screenshots
 * (src/render/surface/effectShowcase.ts):
 * - palette swap: nothing swaps at blend 0, everything at 1; pixel by pixel – the light steps of a ramp before the
 *   dark ones; the sprite's seed spreads the order of seasonal foliage (a forest turns tree by tree), a world-anchored
 *   cluster noise that of an effect (it creeps over the sprite), never as a cross-fade;
 * - dither fade: a Bayer pattern on the sprite's own pixels – exactly the share of the fade gone in every 4 × 4 cell,
 *   a pixel once gone stays gone as the fade grows;
 * - white flash: light, not paint (emissive white), softened with the flash-reduction option;
 * - the effect scenes show what their screenshots claim.
 */
import { describe, expect, it } from 'vitest';
import { SHADERS } from '../../../src/render/shaderLib';
import { SpriteDesc, SpriteList } from '../../../src/render/batch/spriteList';
import { INSTANCE_STRIDE, MAX_PALETTE_ROWS, OFFSET, SPRITE_FLAG, SURFACE_FLAG } from '../../../src/render/batch/spriteLayout';
import { bayer4, creepThreshold, fadeKeeps, swapThreshold } from '../../../src/render/surface/rules';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';
import { surfaceSettingsFrom } from '../../../src/render/surface/settings';
import { defaultSettings } from '../../../src/engine/settings';
import { EFFECT_STEPS, EffectShowcaseScene, type EffectSceneId } from '../../../src/render/surface/effectShowcase';
import { RenderScene } from '../../../src/render/scene';

const FRAG = SHADERS['sprite_gbuffer.frag'] ?? '';
const FRAME = { x: 0, y: 0, w: 16, h: 16, ax: 8, ay: 15 };

function bytes(list: SpriteList, i: number, offset: number): number[] {
  const u8 = new Uint8Array(list.words.buffer);
  return [...u8.subarray(i * INSTANCE_STRIDE + offset, i * INSTANCE_STRIDE + offset + 4)];
}

describe('Palettenwechsel-Effekte', () => {
  it('bei 0 wechselt nichts, bei 1 alles – jede Schwelle liegt dazwischen', () => {
    for (let r = 0; r <= 10; r++) {
      for (let s = 0; s <= 10; s++) {
        const t = swapThreshold(r / 10, s / 10);
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThan(1);
      }
    }
  });

  it('helle Stufen vor dunklen, der Seed verteilt die Sprites', () => {
    for (const seed of [0, 0.3, 0.7, 1]) {
      let last = -1;
      for (let r = 10; r >= 0; r--) {
        const t = swapThreshold(r / 10, seed);
        expect(t).toBeGreaterThan(last);
        last = t;
      }
    }
    // Two trees, same leaf: the one with the smaller seed turns first.
    expect(swapThreshold(0.5, 0.2)).toBeLessThan(swapThreshold(0.5, 0.8));
    expect(SURFACE_PARAMS.seasons.rankWeight).toBeGreaterThan(0.5);
  });

  it('Effekte kriechen in weltfesten Clustern über das Sprite: helle Stufen zuerst, das Rauschen verteilt den Rest', () => {
    for (let r = 0; r <= 10; r++) {
      for (let n = 0; n <= 10; n++) {
        const t = creepThreshold(r / 10, n / 10);
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThan(1);
        if (r > 0) expect(creepThreshold(r / 10, n / 10)).toBeLessThan(creepThreshold((r - 1) / 10, n / 10));
      }
    }
    // Within one ramp step the noise decides: every blend between the lightest and the darkest threshold shows a mix.
    expect(creepThreshold(0.5, 0.1)).toBeLessThan(creepThreshold(0.5, 0.9));
    expect(SURFACE_PARAMS.effects.creepRankWeight).toBeLessThan(SURFACE_PARAMS.seasons.rankWeight);
  });

  it('der Shader rechnet dieselben Schwellen', () => {
    expect(FRAG).toContain('? mix(clusterNoise(world, DH_CREEP_WAVELENGTH, DH_CREEP_DETAIL, 1.0, 131u), 1.0 - rampRank(index), DH_CREEP_RANK_WEIGHT) * 0.98 + 0.01');
    expect(FRAG).toContain(': mix(spriteSeed(), 1.0 - rampRank(index), DH_SEASON_RANK_WEIGHT) * 0.98 + 0.01;');
    expect(FRAG).toContain('if (blend > threshold)');
  });

  it('zweite Zeile, Anteil und Art stehen im Instanz-Datensatz; ein Laubwurf ist kein Tausch', () => {
    const list = new SpriteList(8);
    const d = new SpriteDesc();
    d.frame = FRAME;
    d.paletteRow2 = 5;
    d.rowBlend = 0.5;
    list.push(d);
    d.shed = true;
    list.push(d);
    d.shed = false;
    d.creep = true;
    list.push(d);
    d.reset();
    d.frame = FRAME;
    d.weathered = true;
    d.bend = 1;
    list.push(d);
    expect(bytes(list, 0, OFFSET.surface)).toEqual([5, 128, SURFACE_FLAG.swap, 0]);
    expect(bytes(list, 1, OFFSET.surface)).toEqual([5, 128, SURFACE_FLAG.shed, 0]);
    expect(bytes(list, 2, OFFSET.surface)).toEqual([5, 128, SURFACE_FLAG.swap | SURFACE_FLAG.creep, 0]);
    expect(bytes(list, 3, OFFSET.surface)).toEqual([0, 0, SURFACE_FLAG.weathered, 255]);
    d.paletteRow2 = MAX_PALETTE_ROWS;
    expect(() => list.push(d)).toThrow(RangeError);
  });
});

describe('Dither-Fades', () => {
  it('in jeder 4×4-Zelle ist genau der Anteil des Fades weg, am Sprite verankert', () => {
    for (const fade of [0, 0.25, 0.5, 0.75, 1]) {
      let kept = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (fadeKeeps(fade, x, y)) kept++;
      expect(kept).toBe(Math.round(16 * (1 - fade)));
      // The same pattern in every cell of the sprite.
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(fadeKeeps(fade, x, y)).toBe(fadeKeeps(fade, x % 4, y % 4));
    }
    expect(FRAG).toContain('if (float(vMisc.w) / 255.0 > bayer4(vec2(p))) discard;');
  });

  it('was einmal weg ist, bleibt weg, wenn der Fade wächst', () => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        let gone = false;
        for (let f = 0; f <= 255; f++) {
          const keeps = fadeKeeps(f / 255, x, y);
          if (gone) expect(keeps).toBe(false);
          if (!keeps) gone = true;
        }
      }
    }
    expect(bayer4(0, 0)).toBeGreaterThan(0);
    expect(bayer4(3, 3)).toBeLessThan(1);
  });

  it('der Fade steht als Byte im Datensatz', () => {
    const list = new SpriteList(2);
    const d = new SpriteDesc();
    d.frame = FRAME;
    d.fade = 0.25;
    list.push(d);
    expect(bytes(list, 0, OFFSET.misc)[3]).toBe(64);
  });
});

describe('Weißblitz', () => {
  it('ist Licht, keine Farbe: emissives Weiß, mit Blitzreduktion gedämpft', () => {
    expect(FRAG).toContain('emissive = max(emissive, uFlashStrength);');
    const s = defaultSettings();
    expect(surfaceSettingsFrom(s).flashStrength).toBe(1);
    s.accessibility.flashReduction = true;
    expect(surfaceSettingsFrom(s).flashStrength).toBe(SURFACE_PARAMS.effects.reducedFlash);
    expect(SURFACE_PARAMS.effects.reducedFlash).toBeGreaterThan(0);
    expect(SURFACE_PARAMS.effects.reducedFlash).toBeLessThan(1);
  });
});

describe('Effekt-Szenen der Screenshots', () => {
  function fill(id: EffectSceneId): RenderScene {
    const scene = new RenderScene();
    scene.beginFrame(1.7);
    new EffectShowcaseScene(id).fill(scene, 1.7);
    return scene;
  }

  function flags(scene: RenderScene): { misc: number[]; surface: number[] }[] {
    const out: { misc: number[]; surface: number[] }[] = [];
    for (let i = 0; i < scene.sprites.count; i++) out.push({ misc: bytes(scene.sprites, i, OFFSET.misc), surface: bytes(scene.sprites, i, OFFSET.surface) });
    return out;
  }

  it('Outline: Figuren, Fels und Pilz tragen sie, Fackeln leuchten, es ist Nacht', () => {
    const scene = fill('shader-outline');
    const outlined = flags(scene).filter((f) => ((f.misc[1] ?? 0) & SPRITE_FLAG.outline) !== 0).length;
    expect(outlined).toBeGreaterThanOrEqual(4);
    expect(scene.lights.count).toBe(2);
    expect(scene.env.ambientIntensity).toBeLessThan(0.3);
  });

  it('Weißblitz: jedes Ding einmal ohne, einmal mit Blitz', () => {
    const f = flags(fill('shader-weissblitz'));
    const flashed = f.filter((x) => ((x.misc[1] ?? 0) & SPRITE_FLAG.flash) !== 0).length;
    expect(flashed).toBeGreaterThanOrEqual(4);
    expect(f.length - flashed).toBeGreaterThanOrEqual(flashed);
  });

  it('Palettentausch und Dither: jede Stufe von 0 bis ganz', () => {
    const swapped = flags(fill('shader-palettentausch')).filter((x) => ((x.surface[2] ?? 0) & SURFACE_FLAG.swap) !== 0);
    for (const x of swapped) expect((x.surface[2] ?? 0) & SURFACE_FLAG.creep).toBe(SURFACE_FLAG.creep);
    const blends = new Set(swapped.map((x) => x.surface[1]));
    expect([...blends].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(EFFECT_STEPS.map((s) => Math.round(s * 255)));
    const fades = new Set(flags(fill('shader-dither')).map((x) => x.misc[3]));
    for (const s of EFFECT_STEPS) expect(fades.has(Math.round(s * 255))).toBe(true);
  });
});
