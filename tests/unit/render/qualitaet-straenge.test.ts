/**
 * M5-25: jede Qualitätsstufe erreicht jeden Strang der Render-Pipeline – zur Laufzeit, ohne Neuladen. Ein echter
 * Renderer auf dem Fake-GL-Kontext, die Einstellungen in einem echten Store, gebunden wie auf der Seite
 * (`startRenderQuality`): nach jedem Stufenwechsel tragen Licht (Lichtzahl, Schattenstufe – und so viele Lichter zeichnet
 * der Lichtpass wirklich), Partikel (Wetter- und Quellenanteil, Partikellicht), Wasser (Brechung, Spiegelung, Wellen,
 * Kaustiken), Atmosphäre und Post (Nebel, Bloom) und Welt-Oberfläche (Pfützenspiegel, Glühwürmchen – und was der Frame
 * davon an die Sprite-Programme gibt) die Werte der Stufe; die Barrierefreiheit erreicht die Stränge ebenso.
 */
import { describe, expect, it } from 'vitest';
import { createSettingsStore, QUALITY_LEVELS, QUALITY_PRESETS, qualityPatch, type QualityLevel, type SettingsStore } from '../../../src/engine/settings';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { REDUCED_FLICKER_SCALE } from '../../../src/render/light/settings';
import { PARTICLE_WORLD } from '../../../src/content/particles';
import { QualityController } from '../../../src/render/quality/controller';
import { startRenderQuality } from '../../../src/render/quality/boot';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { surfaceFrameOf } from '../../../src/render/surface/frame';
import { REDUCED_FIREFLY_SHARE, REDUCED_MOTION_SCALE } from '../../../src/render/surface/settings';
import { createFakeGl } from './fakeGl';

/** More point lights on screen than the highest level draws (256). */
const LIGHTS_ON_SCREEN = 300;

function page(): { gl: WebGL2RenderingContext; r: Renderer; store: SettingsStore; quality: QualityController } {
  const fake = createFakeGl();
  const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
  const store = createSettingsStore(null, { autoSave: false });
  // The first-start detection is done in this profile: no benchmark.
  store.update({ graphics: { autoDetected: true } });
  const quality = new QualityController(r, store.get());
  startRenderQuality({ settings: store, quality, search: '', debug: false, now: () => 0 });
  return { gl: fake.gl, r, store, quality };
}

/** A frame full of point lights in view (a grid around the camera). */
function crowdedScene(): RenderScene {
  const s = new RenderScene();
  s.beginFrame(1);
  for (let i = 0; i < LIGHTS_ON_SCREEN; i++) {
    const l = s.light.reset();
    l.x = (i % 20) * 20 - 200;
    l.y = Math.floor(i / 20) * 14 - 100;
    l.height = 12;
    l.radius = 24;
    l.r = 1;
    l.g = 0.8;
    l.b = 0.5;
    l.intensity = 1;
    s.lights.push(l);
  }
  return s;
}

function expectLevel(r: Renderer, level: QualityLevel): void {
  const p = QUALITY_PRESETS[level];
  // Light and shadows (§6.3 "Punktlichter", "Schatten").
  expect(r.lighting.settings.maxLights, level).toBe(p.maxLights);
  expect(r.lighting.lighting.maxLights, level).toBe(p.maxLights);
  expect(r.lighting.lighting.shadows, level).toBe(p.shadows);
  // Particles and weather (§6.3 "Wetter/Partikel", Ultra "Partikellicht").
  const reduced = p.weatherParticles === 'reduced';
  expect(r.particles.settings.weatherShare, level).toBe(reduced ? PARTICLE_WORLD.reduced.weather : 1);
  expect(r.particles.settings.emitterShare, level).toBe(reduced ? PARTICLE_WORLD.reduced.emitters : 1);
  expect(r.particles.system.settings.particleLights, level).toBe(p.particleLights);
  // Water (§6.3 "Wasser": vereinfacht / voll ohne Spiegelung / voll).
  expect(r.water.settings.refraction, level).toBe(p.water !== 'simple');
  expect(r.water.settings.reflection, level).toBe(p.water === 'full');
  expect(r.water.settings.waves, level).toBe(p.water !== 'simple');
  expect(r.water.settings.caustics, level).toBe(p.water !== 'simple');
  expect(r.water.pass.settings, level).toBe(r.water.settings);
  // Atmosphere and post (fog and bloom: single options, on at every level).
  expect(r.atmosphere.settings.fog, level).toBe(p.fog);
  expect(r.atmosphere.settings.bloom, level).toBe(p.bloom);
  // World surface (puddles mirror only with full water, half the fireflies with reduced particles).
  expect(r.surface.settings.puddleMirror, level).toBe(p.water === 'full');
  expect(r.surface.settings.fireflyShare, level).toBe(reduced ? REDUCED_FIREFLY_SHARE : 1);
}

describe('Qualitätsstufen erreichen jeden Strang (M5-25)', () => {
  it('jede Stufe, der Reihe nach und zurück, auf demselben Renderer ohne Neuladen', () => {
    const { gl, r, store, quality } = page();
    for (const level of [...QUALITY_LEVELS, ...[...QUALITY_LEVELS].reverse()]) {
      store.update(qualityPatch(level));
      expectLevel(r, level);
      expect(quality.state().level).toBe(level);
      expect(quality.state().source).toBe('einstellungen');
      // The next frame renders at the level: the light pass draws as many lights as the level allows …
      r.render(crowdedScene(), 960, 540, 'sharp');
      expect(r.lighting.lighting.visibleLights, level).toBeGreaterThan(QUALITY_PRESETS.ultra.maxLights);
      expect(r.lighting.lighting.drawnLights, level).toBe(QUALITY_PRESETS[level].maxLights);
      // … and the surface settings of the frame are the level's (the sprite and terrain programs read them).
      expect(surfaceFrameOf(gl).settings, level).toBe(r.surface.settings);
    }
  });

  it('nur die Stufe zu setzen (Konsole „set graphics.quality …“) bringt ihre Voreinstellung mit', () => {
    const { r, store } = page();
    store.update({ graphics: { quality: 'low' } });
    expect(store.get().graphics).toMatchObject({ quality: 'low', ...QUALITY_PRESETS.low });
    expectLevel(r, 'low');
    store.update({ graphics: { quality: 'ultra' } });
    expectLevel(r, 'ultra');
  });

  it('eine einzelne Option nach der Stufe erreicht ihren Strang, der Rest der Stufe bleibt', () => {
    const { r, store, quality } = page();
    store.update(qualityPatch('medium'));
    store.update({ graphics: { water: 'full' } });
    expect(r.water.settings.reflection).toBe(true);
    expect(r.lighting.lighting.shadows).toBe('hard');
    expect(r.lighting.lighting.maxLights).toBe(64);
    expect(quality.state().preset).toBe(false);
    store.update({ graphics: { fog: false, bloom: false } });
    expect(r.atmosphere.settings.fog).toBe(false);
    expect(r.atmosphere.settings.bloom).toBe(false);
  });

  it('die Barrierefreiheit erreicht die Stränge ebenso (Flacker- und Bewegungsreduktion)', () => {
    const { r, store } = page();
    store.update({ accessibility: { flashReduction: true, reducedMotion: true } });
    expect(r.lighting.lighting.flickerScale).toBe(REDUCED_FLICKER_SCALE);
    expect(r.particles.settings.flashReduction).toBe(true);
    expect(r.surface.settings.motionScale).toBe(REDUCED_MOTION_SCALE);
    expect(r.surface.settings.flickerScale).toBe(REDUCED_FLICKER_SCALE);
    expect(r.water.settings.motionScale).toBeLessThan(1);
    expect(r.atmosphere.settings.motionScale).toBeLessThan(1);
    expect(r.atmosphere.settings.steady).toBe(true);
  });

  it('ein Szenario rendert in seiner eigenen Stufe, die Einstellungen bleiben unberührt', () => {
    const { r, store, quality } = page();
    quality.setOverride('low');
    expectLevel(r, 'low');
    expect(store.get().graphics.quality).toBe('high');
    expect(quality.state()).toMatchObject({ level: 'low', settingsLevel: 'high', source: 'szenario' });
    // A settings change meanwhile keeps the scenario's level (only its own options follow).
    store.update({ accessibility: { flashReduction: true } });
    expectLevel(r, 'low');
    quality.setOverride(null);
    expectLevel(r, 'high');
  });
});
