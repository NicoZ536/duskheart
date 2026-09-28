/**
 * M5-15: picture-wide state effects – the thresholds of §12.3 (tendrils from fear 40, drained colours from
 * 60), the low-health rim and its heartbeat (never faster than a calm pulse: no strobing; steady with flash
 * reduction), the condition → effect table against the content, the per-frame reset, the debug pins, and
 * the post pass's grading LUT (built only when the grade changes, skipped for neutral or inactive grades).
 */
import { describe, expect, it } from 'vitest';
import { CONDITIONS } from '../../../src/content/conditions';
import { defaultSettings } from '../../../src/engine/settings';
import { atmospherePostSettingsFrom } from '../../../src/render/post/settings';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { createGrading, GRADING_PARAM_COUNT } from '../../../src/render/post/grading';
import { isPostOverrideName, POST_OVERRIDE_NAMES, postDebugCommand, PostOverrides } from '../../../src/render/post/overrides';
import {
  CONDITION_POST_EFFECTS,
  fearDrain,
  FEAR_DESATURATION,
  fearTendrils,
  heartbeat,
  HEARTBEAT_SECONDS,
  HEARTBEAT_STEADY,
  hurtFromHealth,
  LAYER_TRANSITION_SECONDS,
  layerTransition,
  LOW_HEALTH_SHARE,
  PostState,
} from '../../../src/render/post/state';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { POST_LOOK, postDefines, transitionKey } from '../../../src/render/passes/postPass';
import { createFakeGl } from './fakeGl';
import { glslScalar } from './grading-glslScalar';

describe('Zustandseffekte (reine Funktionen)', () => {
  it('fear: tendrils from 40, colours drain from 60 (§12.3), both full at 100', () => {
    expect(fearTendrils(0.4)).toBe(0);
    expect(fearTendrils(0.41)).toBeGreaterThan(0);
    expect(fearTendrils(1)).toBe(1);
    expect(fearDrain(0.6)).toBe(0);
    expect(fearDrain(0.7)).toBeGreaterThan(0);
    expect(fearDrain(1)).toBeCloseTo(FEAR_DESATURATION, 12);
  });

  it('low health: nothing above the share, full at 0; unknown maximum means no player', () => {
    expect(hurtFromHealth(100, 100)).toBe(0);
    expect(hurtFromHealth(LOW_HEALTH_SHARE * 100, 100)).toBe(0);
    expect(hurtFromHealth(LOW_HEALTH_SHARE * 50, 100)).toBeCloseTo(0.5, 12);
    expect(hurtFromHealth(0, 100)).toBe(1);
    expect(hurtFromHealth(-5, 100)).toBe(1);
    expect(hurtFromHealth(10, 0)).toBe(0);
  });

  it('the heartbeat stays within 0…1, beats twice per period, never faster than the racing pulse, steady with flash reduction', () => {
    expect(HEARTBEAT_SECONDS.racing).toBeGreaterThanOrEqual(0.5);
    for (const hurt of [0.2, 1]) {
      const peaks: number[] = [];
      let prev = heartbeat(0, hurt, false);
      let rising = true;
      for (let t = 0.005; t < 6; t += 0.005) {
        const v = heartbeat(t, hurt, false);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        if (rising && v < prev - 1e-9) peaks.push(t);
        rising = v > prev;
        prev = v;
      }
      // Peaks of strong beats come at the period; no two peaks closer than 0.15 s (no flicker).
      for (let i = 1; i < peaks.length; i++) expect((peaks[i] as number) - (peaks[i - 1] as number)).toBeGreaterThan(0.15);
    }
    for (let t = 0; t < 3; t += 0.1) expect(heartbeat(t, 0.9, true)).toBe(HEARTBEAT_STEADY);
  });

  it('a layer transition covers the picture at the change and uncovers it within its duration', () => {
    expect(layerTransition(0)).toBe(1);
    expect(layerTransition(LAYER_TRANSITION_SECONDS / 2)).toBeCloseTo(0.5, 12);
    expect(layerTransition(LAYER_TRANSITION_SECONDS)).toBe(0);
    expect(layerTransition(Number.NaN)).toBe(0);
  });

  it('the Bayer transition closes like an iris: corners first, the middle last, a dithered rim between (TypeScript = GLSL)', () => {
    const bayer = Array.from({ length: 16 }, (_, i) => (i + 0.5) / 16);
    const covered = (radial: number, t: number): number => bayer.filter((b) => transitionKey(radial, b) < t).length / bayer.length;
    for (const r of [0, 0.3, 0.6, 1]) {
      expect(covered(r, 0)).toBe(0);
      expect(covered(r, 1)).toBe(1);
    }
    // Halfway: the corners are covered, the middle is clear, the ring between is dithered.
    expect(covered(1, 0.5)).toBe(1);
    expect(covered(0, 0.5)).toBe(0);
    // The middle of the rim at cover ½: where the key without its Bayer part is ½ − seam / 2.
    const seam = POST_LOOK.transitionSeam;
    const rim = covered(1 - (0.5 - seam / 2) / (1 - seam), 0.5);
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThan(1);
    // The dithered rim is a narrow ring, not the whole picture: most radii are fully covered or clear.
    let dithered = 0;
    for (let i = 0; i <= 100; i++) {
      const c = covered(i / 100, 0.5);
      if (c > 0 && c < 1) dithered++;
    }
    expect(dithered).toBeLessThanOrEqual(Math.ceil(100 * POST_LOOK.transitionSeam / (1 - POST_LOOK.transitionSeam)) + 1);
    const glsl = glslScalar('post.glsl', 'transitionKey', postDefines());
    for (let i = 0; i <= 12; i++) for (const b of bayer) expect(glsl(i / 10, b)).toBeCloseTo(transitionKey(i / 10, b), 6);
  });

  it('every condition with a picture-wide effect exists in the content; the effects stay within 0…1', () => {
    const ids = new Set(CONDITIONS.map((c) => c.id));
    for (const [id, e] of Object.entries(CONDITION_POST_EFFECTS)) {
      expect(ids.has(id), id).toBe(true);
      for (const v of Object.values(e)) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // §6.1 "Zustandseffekte (Furcht, niedrige HP, Kälte, Hitze, Erschöpfung, Gift, Rausch)": each has a cause in the content.
    const effects = new Set(Object.values(CONDITION_POST_EFFECTS).flatMap((e) => Object.keys(e)));
    expect([...effects].sort()).toEqual(['cold', 'drunk', 'heat', 'poison', 'tired']);
  });
});

describe('Nachbearbeitungs-Zustand und Anheftungen', () => {
  it('every effect is off at the start of a frame; the pins and the layer memory are kept', () => {
    const post = new PostState();
    post.fear = 1;
    post.hurt = 1;
    post.drunk = 1;
    post.transition = 1;
    post.lid = 0.5;
    post.distortion.shockwave(0, 0, 10, 4, 2);
    post.overrides.set('fear', 0.5);
    post.layerShown = -1;
    post.beginFrame();
    expect([post.fear, post.hurt, post.drunk, post.transition, post.lid, post.distortion.count]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(post.overrides.values.fear).toBe(0.5);
    expect(post.layerShown).toBe(-1);
    const scene = new RenderScene();
    scene.post.grain = 1;
    scene.corruption.strength = 1;
    scene.grading.active = true;
    scene.beginFrame(0);
    expect([scene.post.grain, scene.corruption.strength, scene.grading.active]).toEqual([0, 0, false]);
  });

  it('pins clamp to 0…1, win over the frame and release with null; the console command validates', () => {
    const o = new PostOverrides();
    const scene = new RenderScene();
    o.set('hurt', 3);
    o.set('corruption', 0.5);
    o.grading = false;
    scene.grading.active = true;
    scene.post.poison = 0.7;
    o.applyTo(scene.post, scene.grading, scene.corruption, 0);
    expect([scene.post.hurt, scene.corruption.strength, scene.grading.active, scene.post.poison]).toEqual([1, 0.5, false, 0.7]);
    o.set('hurt', null);
    expect(o.values.hurt).toBeNull();
    expect(POST_OVERRIDE_NAMES.every(isPostOverrideName)).toBe(true);
    expect(postDebugCommand(o, 'fear', 0.25).values.fear).toBe(0.25);
    expect(postDebugCommand(o, 'crt', true).crt).toBe(true);
    expect(() => postDebugCommand(o, 'crt', 1)).toThrow(TypeError);
    expect(() => postDebugCommand(o, 'fear', 'viel')).toThrow(TypeError);
    expect(() => postDebugCommand(o, 'blau', 1)).toThrow(/unbekannter Effekt/);
    expect(postDebugCommand(o, 'clear').values.fear).toBeNull();
    expect(o.any).toBe(false);
  });
});

describe('Nachbearbeitung: Grading-LUT (Fake-GL)', () => {
  function renderer() {
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    return { fake, r };
  }

  it('an ungraded or neutral frame builds no LUT; a grade builds it once and again only when it changes', () => {
    const { fake, r } = renderer();
    const post = r.atmosphere.post;
    expect(post).not.toBeNull();
    const scene = new RenderScene();
    const frame = (fill?: (s: RenderScene) => void): void => {
      scene.beginFrame(0);
      fill?.(scene);
      r.render(scene, 960, 540, 'sharp');
    };
    frame();
    expect([post?.graded, post?.lutBuilds]).toEqual([false, 0]);
    frame((s) => {
      s.grading.active = true;
      s.grading.params.set(createGrading({ vignette: 0.5 }));
    });
    expect([post?.graded, post?.lutBuilds]).toEqual([false, 0]);
    const warm = createGrading({ temperature: 0.3, saturation: 0.9 });
    fake.calls.length = 0;
    frame((s) => {
      s.grading.active = true;
      s.grading.params.set(warm);
    });
    expect([post?.graded, post?.lutBuilds]).toEqual([true, 1]);
    expect(fake.count('texSubImage3D')).toBe(1);
    frame((s) => {
      s.grading.active = true;
      s.grading.params.set(warm);
    });
    expect(post?.lutBuilds).toBe(1);
    const cooler = new Float32Array(warm);
    cooler[0] = 0.25;
    frame((s) => {
      s.grading.active = true;
      s.grading.params.set(cooler);
    });
    expect(post?.lutBuilds).toBe(2);
    expect(scene.grading.params).toHaveLength(GRADING_PARAM_COUNT);
  });

  it('a colour-blind mode runs every frame through the LUT – without a grade too – and a new mode rebuilds it', () => {
    const { r } = renderer();
    const post = r.atmosphere.post;
    const scene = new RenderScene();
    const frame = (): void => {
      scene.beginFrame(0);
      r.render(scene, 960, 540, 'sharp');
    };
    const s = defaultSettings();
    frame();
    expect([post?.graded, post?.lutApplied, post?.lutBuilds]).toEqual([false, false, 0]);
    r.atmosphere.configure(atmospherePostSettingsFrom({ graphics: s.graphics, accessibility: { ...s.accessibility, colorblind: 'deuteranopia' } }));
    frame();
    expect([post?.graded, post?.lutApplied, post?.lutBuilds]).toEqual([false, true, 1]);
    frame();
    expect(post?.lutBuilds).toBe(1);
    r.atmosphere.configure(atmospherePostSettingsFrom({ graphics: s.graphics, accessibility: { ...s.accessibility, colorblind: 'tritanopia' } }));
    frame();
    expect(post?.lutBuilds).toBe(2);
    r.atmosphere.configure(atmospherePostSettingsFrom({ graphics: s.graphics, accessibility: s.accessibility }));
    frame();
    expect(post?.lutApplied).toBe(false);
  });
});
