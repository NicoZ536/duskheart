/**
 * M5-11: the GPU particle system – births on the CPU (deterministic, independent of the frame steps, allocation-free
 * ring), the scene's source lists, the settings of the quality level, and the transform-feedback system on a fake GL
 * context: passes at `PASS_ORDER.particles`, one feedback step per frame, a start-over with prewarm when it has no
 * state, after a context loss, on a time jump and for a frozen frame whose sources changed, and ≥ 20 000 particles alive
 * in the stress scene.
 */
import { describe, expect, it } from 'vitest';
import { applyQualityPreset, defaultSettings } from '../../../src/engine/settings';
import { PARTICLE_EMITTERS, PARTICLE_WORLD } from '../../../src/content/particles';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { E, EMITTER_FLOATS } from '../../../src/render/particles/kinds';
import { MAX_SPAWNS_PER_STEP, P, PARTICLE_CAPACITY, PARTICLE_FLOATS, RING_CAPACITY, WEATHER_CAPACITY } from '../../../src/render/particles/layout';
import { EmitterList, DistortionList, ParticleScene } from '../../../src/render/particles/sceneParticles';
import { DEFAULT_PARTICLE_SETTINGS, particleSettingsFrom } from '../../../src/render/particles/settings';
import { emittedBy, ParticleRing, SpawnBatch, sourcePhase, spawnStep } from '../../../src/render/particles/spawn';
import { MAX_STEP_S, PREWARM_S, PREWARM_STEP_S, RESET_GAP_S } from '../../../src/render/particles/system';
import { particleEmitter, particleTables } from '../../../src/render/particles/tables';
import { PARTICLE_PASSES } from '../../../src/render/passes/particlePass';
import { PASS_ORDER } from '../../../src/render/passes/registry';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { STRESS_PARTICLES } from '../../../src/render/scenes/ids';
import { createFakeGl } from './fakeGl';

const tables = particleTables();

function births(list: EmitterList, t0: number, t1: number, steps: number): { born: number[]; records: Float32Array[] } {
  const ring = new ParticleRing(RING_CAPACITY);
  const batch = new SpawnBatch(8192);
  const born: number[] = [];
  const records: Float32Array[] = [];
  for (let s = 0; s < steps; s++) {
    const a = t0 + ((t1 - t0) * s) / steps;
    const b = t0 + ((t1 - t0) * (s + 1)) / steps;
    const n = spawnStep(list, tables.emitters, a, b, 1, ring, batch);
    for (let i = 0; i < n; i++) {
      const r = batch.records.slice(i * PARTICLE_FLOATS, (i + 1) * PARTICLE_FLOATS);
      born.push(Math.round((a - (r[P.age] as number)) * 1e4) / 1e4);
      records.push(r);
    }
  }
  return { born, records };
}

describe('Geburten', () => {
  it('ein Strom der Rate r gebiert r Partikel je Sekunde, gleich ob in einem oder in sechzig Schritten', () => {
    const list = new EmitterList();
    list.push(particleEmitter('brand_funken'), 100, 200, 0, 1, 42);
    const rate = PARTICLE_EMITTERS.find((e) => e.id === 'brand_funken')?.rate as number;
    const one = births(list, 10, 20, 1);
    const sixty = births(list, 10, 20, 600);
    expect(one.born.length).toBe(emittedBy(rate, sourcePhase(42, particleEmitter('brand_funken')), 20) - emittedBy(rate, sourcePhase(42, particleEmitter('brand_funken')), 10));
    expect(Math.abs(one.born.length - rate * 10)).toBeLessThanOrEqual(1);
    expect(sixty.born).toEqual(one.born);
    // Same particles, whichever steps: positions, velocities, life and seed agree.
    for (let i = 0; i < one.records.length; i++) {
      const a = one.records[i] as Float32Array;
      const b = sixty.records[i] as Float32Array;
      for (const f of [P.x, P.y, P.z, P.vx, P.vy, P.vz, P.life, P.kind, P.seed]) expect(b[f]).toBe(a[f]);
    }
    // Newborns start with age ≤ 0: the GPU step moves them only for their share of the step.
    for (const r of one.records) expect(r[P.age]).toBeLessThanOrEqual(0);
  });

  it('Geburten liegen in der Fläche der Quelle, Tempo, Steigen und Leben in ihren Bereichen; tangential heißt quer zum Radius', () => {
    const list = new EmitterList();
    const storm = particleEmitter('lumen_sturm');
    list.push(storm, 0, 0, 5, 0.05, 7);
    const e = PARTICLE_EMITTERS[storm] as (typeof PARTICLE_EMITTERS)[number];
    const { records } = births(list, 0, 2, 1);
    expect(records.length).toBeGreaterThan(100);
    let across = 0;
    for (const r of records) {
      const x = r[P.x] as number;
      const y = r[P.y] as number;
      expect((x / (e.flaeche.breite / 2)) ** 2 + (y / (e.flaeche.tiefe / 2)) ** 2).toBeLessThanOrEqual(1 + 1e-4);
      const speed = Math.hypot(r[P.vx] as number, r[P.vy] as number);
      expect(speed).toBeGreaterThanOrEqual(e.tempo.min - 1e-3);
      expect(speed).toBeLessThanOrEqual(e.tempo.max + 1e-3);
      expect(r[P.vz]).toBeGreaterThanOrEqual(e.steigen.min - 1e-3);
      expect(r[P.vz]).toBeLessThanOrEqual(e.steigen.max + 1e-3);
      expect(r[P.z]).toBeGreaterThanOrEqual(5 + e.hoehe.min - 1e-3);
      expect(r[P.layer]).toBe(0);
      // Direction relative to the patch radius (in the patch's proportions): a quarter turn ± half the spread.
      const radial = Math.atan2(y / e.flaeche.tiefe, x / e.flaeche.breite);
      const dir = Math.atan2(r[P.vy] as number, r[P.vx] as number);
      const off = Math.abs(((dir - radial - Math.PI / 2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (off <= (e.streuung * Math.PI) / 360 + 1e-3) across++;
    }
    expect(across).toBe(records.length);
  });

  it('Stärke skaliert die Rate, Stärke 0 gebiert nichts, ein Rückstau wird gekappt statt ausgeschüttet', () => {
    const preset = particleEmitter('lumen_sturm');
    const full = new EmitterList();
    full.push(preset, 0, 0, 0, 1, 1);
    const half = new EmitterList();
    half.push(preset, 0, 0, 0, 0.5, 1);
    half.push(preset, 0, 0, 0, 0, 2);
    const a = births(full, 0, 1, 1).born.length;
    const b = births(half, 0, 1, 1).born.length;
    expect(Math.abs(b - a / 2)).toBeLessThanOrEqual(1);
    expect(half.count).toBe(1);
    const late = births(full, 0, 60, 1).born.length;
    expect(late).toBe(MAX_SPAWNS_PER_STEP);
  });

  it('der Ring vergibt Plätze reihum, überschreibt die ältesten und zählt die Lebenden', () => {
    const ring = new ParticleRing(4);
    const batch = new SpawnBatch(16);
    const list = new EmitterList();
    list.push(particleEmitter('brand_funken'), 0, 0, 0, 1, 3);
    const n = spawnStep(list, tables.emitters, 0, 1, 1, ring, batch);
    expect(n).toBe(4);
    expect(ring.used).toBe(4);
    expect(ring.head).toBe(0);
    expect(ring.alive(0)).toBe(4);
    expect(ring.alive(100)).toBe(0);
    spawnStep(list, tables.emitters, 1, 1.25, 1, ring, batch);
    expect(batch.first).toBe(0);
    ring.reset();
    expect([ring.head, ring.used, ring.alive(0)]).toEqual([0, 0, 0]);
  });

  it('die Quellentabelle hat für jede Quelle einen Datensatz', () => {
    expect(tables.emitters.data.length).toBe(PARTICLE_EMITTERS.length * EMITTER_FLOATS);
    expect(tables.emitters.data[particleEmitter('brand_rauch') * EMITTER_FLOATS + E.kind]).toBe(tables.kinds.index('rauch'));
  });
});

describe('Szenenteil und Einstellungen', () => {
  it('Quellen- und Hitzelisten wachsen und leeren sich je Frame; das Wetter gilt nur für seinen Frame', () => {
    const p = new ParticleScene();
    for (let i = 0; i < 200; i++) p.emitters.push(0, i, i, 0, 0.5, i);
    for (let i = 0; i < 70; i++) p.distortion.push(i, 0, 4, 12, 20, 1);
    p.distortion.push(0, 0, 0, 0, 10, 1);
    p.weather.set('regen', 2);
    expect([p.emitters.count, p.distortion.count, p.weather.amount, p.weather.id]).toEqual([200, 70, 1, 'regen']);
    expect(p.emitters.x[199]).toBe(199);
    p.beginFrame();
    expect([p.emitters.count, p.distortion.count, p.weather.id, p.weather.amount]).toEqual([0, 0, null, 0]);
    const d = new DistortionList();
    d.push(1, 2, 3, 4, 5, 0);
    expect(d.count).toBe(0);
  });

  it('„Niedrig“ reduziert Wetter und Quellen, Ultra lässt Partikel leuchten, Blitzreduktion kommt aus der Barrierefreiheit', () => {
    const s = defaultSettings();
    expect(DEFAULT_PARTICLE_SETTINGS).toEqual({ weatherShare: 1, emitterShare: 1, particleLights: false, flashReduction: false });
    const low = particleSettingsFrom({ ...s, graphics: applyQualityPreset(s.graphics, 'low') });
    expect([low.weatherShare, low.emitterShare]).toEqual([PARTICLE_WORLD.reduced.weather, PARTICLE_WORLD.reduced.emitters]);
    expect(particleSettingsFrom({ ...s, graphics: applyQualityPreset(s.graphics, 'ultra') }).particleLights).toBe(true);
    expect(particleSettingsFrom({ ...s, accessibility: { ...s.accessibility, flashReduction: true } }).flashReduction).toBe(true);
  });
});

function renderer() {
  const fake = createFakeGl();
  const r = new Renderer(fake.gl, { caps: { floatTargets: false, forcedRgba8: true, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
  return { fake, r };
}

function frame(r: Renderer, scene: RenderScene, time: number, sources = true): void {
  scene.beginFrame(time);
  if (sources) {
    scene.particles.emitters.push(particleEmitter('brand_funken'), 0, 0, 8, 1, 11);
    scene.particles.emitters.push(particleEmitter('brand_rauch'), 0, 0, 12, 1, 12);
    // A dense source: every step has births, so every step runs the feedback pass.
    scene.particles.emitters.push(particleEmitter('lumen_sturm'), 40, 0, 0, 0.2, 14);
  }
  r.render(scene, 1920, 1080, 'sharp');
}

describe('GPU-Partikelsystem (Transform Feedback, Attrappe)', () => {
  it('drei Pässe am Platz der Partikel, ein Feedback-Schritt je Frame, Neustart mit Vorlauf nur wenn nötig', () => {
    const { fake, r } = renderer();
    const names = r.passes.list().filter((p) => p.order === PASS_ORDER.particles).map((p) => p.name);
    expect(names).toEqual([PARTICLE_PASSES.shimmer, PARTICLE_PASSES.particles, PARTICLE_PASSES.lightning]);
    const scene = new RenderScene();
    const stats = r.particles.system.stats;
    frame(r, scene, 10);
    // First frame: start-over and prewarm over PREWARM_S – feedback passes of PREWARM_STEP_S, each in sub-steps of at
    // most MAX_STEP_S (the motion of frame-by-frame stepping, a few draw calls instead of one per sub-step).
    expect(stats.resets).toBe(1);
    expect(stats.steps).toBe(Math.ceil(PREWARM_S / PREWARM_STEP_S - 1e-9));
    expect(stats.substeps).toBe(Math.ceil(PREWARM_S / MAX_STEP_S - 1e-9));
    expect(fake.count('beginTransformFeedback')).toBe(stats.steps);
    expect(stats.alive).toBeGreaterThan(0);
    expect(r.stats.particles).toBe(stats.alive);
    const before = fake.count('beginTransformFeedback');
    frame(r, scene, 10 + 1 / 60);
    expect([stats.resets, stats.steps, stats.substeps, fake.count('beginTransformFeedback') - before]).toEqual([1, 1, 1, 1]);
    // Frozen time, same sources: nothing to do; changed sources: a fresh steady state.
    frame(r, scene, 10 + 1 / 60);
    expect([stats.resets, stats.steps]).toEqual([1, 0]);
    scene.beginFrame(10 + 1 / 60);
    scene.particles.emitters.push(particleEmitter('lagerfeuer_rauch'), 50, 0, 10, 1, 13);
    r.render(scene, 1920, 1080, 'sharp');
    expect(stats.resets).toBe(2);
    // A jump in time starts over, as does going back.
    frame(r, scene, 10 + 1 / 60 + RESET_GAP_S * 2);
    expect(stats.resets).toBe(3);
    frame(r, scene, 5);
    expect(stats.resets).toBe(4);
    // Context loss: every buffer is new, the system starts over.
    r.contextLost();
    r.contextRestored();
    frame(r, scene, 5 + 1 / 60);
    expect(stats.resets).toBe(5);
  });

  it('Transform Feedback schreibt in den anderen Puffer, der Ring beginnt hinter dem Wetterpool', () => {
    const { fake, r } = renderer();
    const scene = new RenderScene();
    frame(r, scene, 3);
    const ranges = fake.calls.filter((c) => c.name === 'bindBufferRange');
    expect(ranges.length).toBeGreaterThan(0);
    for (const c of ranges) expect(c.args[3]).toBe(WEATHER_CAPACITY * 48);
    const draws = fake.calls.filter((c) => c.name === 'drawArrays' && c.args[1] === WEATHER_CAPACITY);
    expect(draws.length).toBe(ranges.length);
    expect(fake.calls.some((c) => c.name === 'transformFeedbackVaryings')).toBe(true);
    expect(PARTICLE_CAPACITY).toBeGreaterThanOrEqual(STRESS_PARTICLES);
  });

  it('Wetter allein: Schritt und Zeichnen nur über den Teil des Pools, den das Wetter braucht', () => {
    const { fake, r } = renderer();
    const scene = new RenderScene();
    const weatherFrame = (time: number, amount: number): void => {
      scene.beginFrame(time);
      scene.particles.weather.set('regen', amount);
      r.render(scene, 1920, 1080, 'sharp');
    };
    weatherFrame(3, 0.5);
    const half = r.particles.system.stats.weather;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(WEATHER_CAPACITY);
    // Feedback steps are the only point draws; the particles are the only instanced strips of the pool's size.
    const steps = () => fake.calls.filter((c) => c.name === 'drawArrays' && c.args[0] === fake.gl.POINTS);
    expect(steps().length).toBe(r.particles.system.stats.steps);
    for (const c of steps()) expect([c.args[1], c.args[2]]).toEqual([0, half]);
    const strips = fake.calls.filter((c) => c.name === 'drawArraysInstanced' && c.args[0] === fake.gl.TRIANGLE_STRIP).map((c) => c.args[3]);
    expect(strips).toContain(half);
    expect(strips).not.toContain(WEATHER_CAPACITY);
    // More rain: the range grows with the weather's number; less rain: the range keeps what still falls.
    weatherFrame(3 + 1 / 60, 1);
    const full = r.particles.system.stats.weather;
    expect(full).toBeGreaterThan(half);
    expect(steps().at(-1)?.args[2]).toBe(full);
    weatherFrame(3 + 2 / 60, 0.25);
    expect(steps().at(-1)?.args[2]).toBe(full);
  });

  it('Partikellicht (Ultra) zeichnet die leuchtenden Partikel ein zweites Mal als Licht, sonst nicht', () => {
    const { fake, r } = renderer();
    const scene = new RenderScene();
    frame(r, scene, 3);
    const plain = fake.count('drawArraysInstanced');
    r.particles.configure({ ...DEFAULT_PARTICLE_SETTINGS, particleLights: true });
    frame(r, scene, 3 + 1 / 60);
    expect(fake.count('drawArraysInstanced') - plain).toBe(plain + 1);
  });

  it('ohne Quellen und Wetter läuft kein Schritt über leere Puffer', () => {
    const { fake, r } = renderer();
    const scene = new RenderScene();
    frame(r, scene, 3, false);
    expect(fake.count('beginTransformFeedback')).toBe(0);
    expect(r.particles.system.stats.alive).toBe(0);
  });
});
