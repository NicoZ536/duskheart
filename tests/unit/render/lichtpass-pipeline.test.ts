/**
 * M5-01 … M5-05 auf einem Fake-GL-Kontext: die Pässe des Licht-Strangs im Renderer – Occluder-Maske und Jump-Flood
 * (ein instanzierter Aufruf für alle Standflächen, Saat, sechs Flutschritte, Auflösung), Sonnenschatten nur bei
 * gerichtetem Licht (Sprites, Gelände-Blöcke, Hausblöcke des Bauraster), die Schatten der Punktlichter nach der
 * §6.3-Qualitätsstufe, Kontextverlust und RGBA8-Rückfall ohne Float-Ziele.
 */
import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS, defaultSettings, type QualityLevel } from '../../../src/engine/settings';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { findLightPipeline, installLightPipeline, type LightPipeline } from '../../../src/render/light/pipeline';
import { LIGHTMAP_COMPARISON, OCCLUDER_CLASS, SDF, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { GBUFFER_HEIGHT_RANGE_PX } from '../../../src/render/gbuffer';
import { lightSettingsFrom } from '../../../src/render/light/settings';
import { splitDaylight } from '../../../src/render/light/skyMath';
import { jumpFloodSteps } from '../../../src/render/passes/occluderPass';
import { SHADOW_CODE } from '../../../src/render/passes/lightingPass';
import type { RenderPass } from '../../../src/render/passes/registry';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { sceneAtlas } from '../../../src/render/assets/sceneSprites';
import { SHADERS } from '../../../src/render/shaderLib';
import { LIGHTMAP_SHADER_SOURCE } from '../../../src/render/debug/lightmapShader';
import { LIGHTMAP_PASS_ORDER, LIGHTMAP_SOURCES_VIEW, LightmapDebugPass } from '../../../src/render/debug/lightmapPass';
import { createFakeGl, type FakeGl, type GlCall } from './fakeGl';
import { PassTimer, TIMING_WINDOW_FRAMES } from '../../../src/render/light/passTimer';
import type { GpuResourceRegistry } from '../../../src/render/gl/resources';

function litRenderer(floatTargets = true): { fake: FakeGl; r: Renderer; pipeline: LightPipeline } {
  const fake = createFakeGl();
  const r = new Renderer(fake.gl, { caps: { floatTargets, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
  const pipeline = findLightPipeline(r.passes) ?? installLightPipeline(r.passes);
  return { fake, r, pipeline };
}

/** Records the GL calls each of `passes` makes while it executes. */
function spy(fake: FakeGl, passes: readonly RenderPass[]): Map<string, GlCall[]> {
  const out = new Map<string, GlCall[]>();
  for (const p of passes) {
    const run = p.execute.bind(p);
    out.set(p.name, []);
    p.execute = (ctx) => {
      const from = fake.calls.length;
      run(ctx);
      out.get(p.name)?.push(...fake.calls.slice(from));
    };
  }
  return out;
}

const count = (calls: readonly GlCall[] | undefined, name: string): number => (calls ?? []).filter((c) => c.name === name).length;

/** A scene with a raised plateau, a wall and – with `sun` – a sun: a house block and a roof slab. */
function scene(sun: boolean): RenderScene {
  const s = new RenderScene();
  s.beginFrame(1);
  s.sky.occluders.rect(-200, -200, 200, -60, 16, OCCLUDER_CLASS.terrain, true, 16);
  s.sky.occluders.rect(-40, 0, 40, 6, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
  if (sun) {
    s.atlas = sceneAtlas();
    splitDaylight(0.5, 0.14, s.sky.directional);
    s.sky.directional.shadowX = -0.8;
    s.sky.directional.shadowY = -0.6;
    s.sky.directional.shadowLength = 1.2;
    s.sky.sunCasters.block(-40, 0, 40, 6, 0, 16);
    s.sky.sunCasters.block(-48, -64, 48, 8, 16, 26);
  }
  return s;
}

describe('Occluder-Pass und Jump-Flood (M5-01)', () => {
  it('zeichnet alle Standflächen in einem instanzierten Aufruf und flutet in 1 + 6 + 1 Vollbild-Durchgängen', () => {
    const { fake, r, pipeline } = litRenderer();
    const calls = spy(fake, [pipeline.occluder]);
    r.render(scene(false), 960, 540, 'sharp');
    const occ = calls.get('occluder');
    const instanced = (occ ?? []).filter((c) => c.name === 'drawArraysInstanced');
    expect(instanced.map((c) => c.args[3])).toEqual([2]);
    // Seed, the flood's steps, resolve: one fullscreen triangle each.
    expect(count(occ, 'drawArrays')).toBe(1 + jumpFloodSteps(SDF.firstStepPx).length + 1);
    expect(pipeline.occluder.ranInFrame(r.stats.frames - 1)).toBe(true);
    expect(pipeline.occluder.footprints.count).toBe(2);
  });

  it('flutet das Wasserfeld nur, wenn das Bild Wasser zeigen kann: sonst gehen die Wasser-Saaten ungeflutet durch', () => {
    const { fake, r, pipeline } = litRenderer();
    // The step variant without the water field: the water half of the loop is gone, the own water texel passes through.
    const steps = fake.calls.filter((c) => c.name === 'shaderSource').map((c) => String(c.args[1])).filter((s) => s.includes('One step of the jump flood'));
    expect(steps).toHaveLength(2);
    const land = steps.find((s) => s.includes('#define DH_JFA_LAND')) ?? '';
    expect(land).toMatch(/#ifdef DH_JFA_LAND\s+vec4 bestWater = texelFetch\(uWater, p, 0\);\s+#else/);
    const calls = spy(fake, [pipeline.occluder]);
    const frame = (s: RenderScene): boolean => {
      r.render(s, 960, 540, 'sharp');
      return pipeline.occluder.waterFlooded;
    };
    // No ground, no water sprite: nothing can be water.
    expect(frame(scene(false))).toBe(false);
    // The same flood passes in both variants: seed, six steps, resolve.
    expect(count(calls.get('occluder'), 'drawArrays')).toBe(1 + jumpFloodSteps(SDF.firstStepPx).length + 1);
    // A ground that may draw water (the world terrain) – or only the M1 tile map, which never does.
    const withGround = (drawsWater?: boolean): RenderScene => {
      const s = scene(false);
      s.ground.push(drawsWater === undefined ? { drawGBuffer: () => undefined } : { drawGBuffer: () => undefined, drawsWater });
      return s;
    };
    expect(frame(withGround())).toBe(true);
    expect(frame(withGround(false))).toBe(false);
    // The water strand's tile grid of the view decides where it is known: water or ice tiles in view.
    const known = (waterTiles: number, frozenTiles: number): RenderScene => {
      const s = withGround();
      s.water.tiles.known = true;
      s.water.tiles.waterTiles = waterTiles;
      s.water.tiles.frozenTiles = frozenTiles;
      return s;
    };
    expect(frame(known(0, 0))).toBe(false);
    expect(frame(known(12, 0))).toBe(true);
    expect(frame(known(0, 3))).toBe(true);
  });

  it('abgeschaltet: keine Felder – Licht ohne Schatten, das Bild bleibt vollständig', () => {
    const { r, pipeline } = litRenderer();
    r.passes.setEnabled('occluder', false);
    r.render(scene(false), 960, 540, 'sharp');
    expect(pipeline.occluder.ranInFrame(r.stats.frames - 1)).toBe(false);
    expect(pipeline.composite.enabled).toBe(true);
  });
});

describe('Sonnen- und Mondschatten (M5-02)', () => {
  it('ohne gerichtetes Licht zeichnet der Schattenpass nichts', () => {
    const { fake, r, pipeline } = litRenderer();
    const calls = spy(fake, [pipeline.shadow]);
    r.render(scene(false), 960, 540, 'sharp');
    expect(calls.get('shadow')).toEqual([]);
    expect(pipeline.shadow.ranInFrame(r.stats.frames - 1)).toBe(false);
  });

  it('mit Sonne: Gelände-Blöcke aus den Standflächen, Hausblöcke aus dem Bauraster, MIN/MAX-Mischung', () => {
    const { fake, r, pipeline } = litRenderer();
    const calls = spy(fake, [pipeline.shadow]);
    r.render(scene(true), 960, 540, 'sharp');
    const sh = calls.get('shadow');
    // The footprints (terrain prisms among them) and the build grid's two sun casters: one instanced call each.
    expect((sh ?? []).filter((c) => c.name === 'drawArraysInstanced').map((c) => c.args[3])).toEqual([2, 2]);
    expect(count(sh, 'blendEquationSeparate')).toBe(1);
    expect(pipeline.shadow.ranInFrame(r.stats.frames - 1)).toBe(true);
  });
});

describe('Punktlicht-Schatten nach Qualitätsstufe (M5-05, §6.3)', () => {
  it('Niedrig nur Sonne (Wände sperren trotzdem), Mittel harte, Hoch und Ultra weiche SDF-Schatten', () => {
    const expected: Record<QualityLevel, string> = { low: 'sun', medium: 'hard', high: 'soft', ultra: 'soft' };
    const base = defaultSettings();
    for (const q of Object.keys(QUALITY_PRESETS) as QualityLevel[]) {
      const settings = lightSettingsFrom({ graphics: { ...base.graphics, ...QUALITY_PRESETS[q], quality: q }, accessibility: base.accessibility });
      expect(settings.shadows, q).toBe(expected[q]);
      const { pipeline } = litRenderer();
      pipeline.configure(settings);
      expect(pipeline.lighting.shadows).toBe(expected[q]);
    }
    const frag = (SHADERS['lighting_point.frag'] ?? '').replace(/\s+/g, ' ');
    // Walls and cliffs block at every level (the gameplay map's rule); decor shadows from "Mittel", soft from "Hoch".
    expect(frag).toContain('vGeom.xy, zl, vBase, vHousing, uShadows == 2, uShadows > 0, uCompare == 1);');
    expect(SHADOW_CODE).toEqual({ sun: 0, hard: 1, soft: 2 });
  });
});

describe('Lichtkarten-Abgleich (M5-28)', () => {
  it('Boden auf einer erhöhten Stufe ist vergleichbar: der Abgleich misst die Höhe über dem Boden seines Masken-Texels', () => {
    // The base and the stations stand on the Grünhain's plateau: its flat top is 16 px per level high in the G-buffer.
    const src = LIGHTMAP_SHADER_SOURCE.replace(/\s+/g, ' ');
    expect(src).toContain('#include "sdf.glsl"');
    expect(src).toContain('float floorZ = uHasMask == 1 ? sdfGroundHeight(uMask, world) : 0.0;');
    // Exactly at that ground (within half a step of the 8-bit height): a sprite's foot or a cliff face over it is not.
    expect(src).toContain('bool ground = abs(gbufferHeight(g1) - floorZ) <= DH_LM_GROUND && gbufferNormal(g1).z >= DH_LM_FLAT_NZ && !unsure;');
    expect(LIGHTMAP_COMPARISON.groundPx).toBeLessThan(GBUFFER_HEIGHT_RANGE_PX / 255);
    // The pass binds the occluder mask of the frame (the lighting pass hands out its occluder pass) and runs.
    const errors: unknown[] = [];
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: (e: unknown) => errors.push(e) }, paletteHex: PALETTE_HEX });
    const pipeline = findLightPipeline(r.passes) ?? installLightPipeline(r.passes);
    expect(pipeline.lighting.occluders).toBe(pipeline.occluder);
    const pass = new LightmapDebugPass(() => pipeline.lighting);
    pass.setFeed({ fill: (_x0, _y0, _step, w, h, _ambient, out) => out.fill(0.5, 0, w * h) });
    r.passes.add(pass, LIGHTMAP_PASS_ORDER);
    r.setDebugView(LIGHTMAP_SOURCES_VIEW);
    const lit = (): RenderScene => {
      const s = scene(false);
      const l = s.light.reset();
      l.x = 0;
      l.y = 40;
      l.height = 12;
      l.radius = 64;
      l.r = 1;
      l.g = 0.8;
      l.b = 0.5;
      l.intensity = 1;
      s.lights.push(l);
      return s;
    };
    const calls = spy(fake, [pass]);
    for (let i = 0; i < 3; i++) r.render(lit(), 960, 540, 'sharp');
    expect(pass.drew).toBe(true);
    // Shown, the view asks the next frame's light pass for the comparison's bookkeeping; hidden, nobody pays for it.
    expect(pipeline.lighting.compareNext).toBe(true);
    r.setDebugView('off');
    r.render(lit(), 960, 540, 'sharp');
    r.render(lit(), 960, 540, 'sharp');
    expect(pipeline.lighting.compareNext).toBe(false);
    expect(pipeline.occluder.ranInFrame(r.stats.frames - 1)).toBe(true);
    expect(count(calls.get(pass.name), 'drawArrays')).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});

describe('Robustheit', () => {
  it('Pass-Zeitmesser messen nur, solange jemand ihre Zeiten liest (F3, lightTimings) – sonst keine Arbeit im Frame', () => {
    const { r, pipeline } = litRenderer();
    const draw = (): void => r.render(scene(true), 960, 540, 'sharp');
    for (let i = 0; i < 3; i++) draw();
    expect(pipeline.timings().cpuMs).toBe(0);
    // Asked: the next frames are measured (CPU time of the preparation; the fake context has no timer queries).
    const before = pipeline.timers.map((t) => t.timer.cpuMs);
    for (let i = 0; i < 3; i++) draw();
    const after = pipeline.timers.map((t) => t.timer.cpuMs);
    expect(after.some((v, i) => v !== before[i])).toBe(true);
    // Not asked for a window of frames: the timers stop.
    for (let i = 0; i < TIMING_WINDOW_FRAMES + 1; i++) draw();
    const idle = pipeline.timers.map((t) => t.timer.cpuMs);
    for (let i = 0; i < 3; i++) draw();
    expect(pipeline.timers.map((t) => t.timer.cpuMs)).toEqual(idle);
  });

  it('Pass-Zeitmesser: nach einem Kontextverlust aktiviert er die Timer-Erweiterung neu, bevor er wieder misst', () => {
    // A stand-in context with the timer query extension: its enums are valid only while the extension is enabled on
    // the current context (a restored context starts without it).
    let generation = 0;
    let enabledIn = -1;
    let lost = false;
    const invalid: string[] = [];
    const ext = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
    const gl = {
      isContextLost: () => lost,
      getExtension: (name: string) => {
        if (name !== 'EXT_disjoint_timer_query_webgl2') return null;
        enabledIn = generation;
        return ext;
      },
      createQuery: () => ({}),
      // While lost, calls are ignored (the browser only warns "context lost"); after the restore the enum is invalid
      // until the extension is enabled on the new context.
      beginQuery: (target: number) => {
        if (!lost && enabledIn !== generation) invalid.push(`beginQuery ${target}`);
      },
      endQuery: (target: number) => {
        if (!lost && enabledIn !== generation) invalid.push(`endQuery ${target}`);
      },
      getQueryParameter: () => false,
      getParameter: () => false,
      QUERY_RESULT_AVAILABLE: 1,
      QUERY_RESULT: 2,
    } as unknown as WebGL2RenderingContext;
    const resources = { restoreCount: 0 };
    const timer = new PassTimer();
    timer.init(gl, resources as unknown as GpuResourceRegistry);
    timer.begin(gl);
    timer.end(gl);
    // Lost: no queries; restored: the registry counts it, the next frame measures again on the new context.
    lost = true;
    generation++;
    timer.begin(gl);
    timer.end(gl);
    lost = false;
    resources.restoreCount = 1;
    for (let i = 0; i < 3; i++) {
      timer.begin(gl);
      timer.end(gl);
    }
    expect(invalid).toEqual([]);
    expect(enabledIn).toBe(generation);
    expect(timer.cpuMs).toBeGreaterThanOrEqual(0);
  });

  it('nach einem Kontextverlust baut der Strang Ziele, Puffer und Programme neu und läuft weiter', () => {
    const { fake, r, pipeline } = litRenderer();
    r.render(scene(true), 960, 540, 'sharp');
    fake.lose();
    r.contextLost();
    fake.restore();
    r.contextRestored();
    const calls = spy(fake, [pipeline.occluder, pipeline.shadow]);
    r.render(scene(true), 960, 540, 'sharp');
    expect(count(calls.get('occluder'), 'drawArrays')).toBe(1 + jumpFloodSteps(SDF.firstStepPx).length + 1);
    expect(count(calls.get('shadow'), 'drawArraysInstanced')).toBe(2);
    expect(pipeline.occluder.distanceTexture()?.handle).not.toBeNull();
    expect(pipeline.shadow.texture()?.handle).not.toBeNull();
  });

  it('ohne Float-Ziele (RGBA8-Kodierung) laufen alle Pässe', () => {
    const { r, pipeline } = litRenderer(false);
    r.render(scene(true), 960, 540, 'sharp');
    const f = r.stats.frames - 1;
    expect([pipeline.occluder.ranInFrame(f), pipeline.shadow.ranInFrame(f), pipeline.lighting.ranInFrame(f)]).toEqual([true, true, true]);
    // The distance field decodes from its 16-bit RG8 encoding (hdr.glsl) – the same range either way.
    const sdf = (SHADERS['sdf.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(sdf).toContain('return decodeScalar(texelFetch(field, t, 0), DH_SDF_MAX_DISTANCE);');
  });
});
