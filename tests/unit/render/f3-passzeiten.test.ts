/**
 * M5-30: GPU-Zeiten je Pass per Timer-Query (EXT_disjoint_timer_query_webgl2) im F3-Overlay. Der Pass-Profiler misst nur,
 * solange jemand die Zeiten liest, klammert jeden Pass des Renderers (dazu Sprite-Upload und Präsentation), lässt die
 * selbst gemessenen Pässe des Licht-Strangs in Ruhe (nie zwei Timer-Queries zugleich) und berichtet deren Zeiten in
 * seiner Tabelle; ohne Erweiterung bleibt die GPU-Spalte leer („n. v.“), ein Software-Rasterer wird erkannt. Dazu die
 * Texte der Render-Tafel in DE und EN.
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../../src/engine/settings';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { createI18n } from '../../../src/i18n';
import { budgetTitle, formatStat } from '../../../src/debug/overlay';
import { giText, gpuNote, lightBufferText, qualityText } from '../../../src/debug/renderPanel';
import type { RenderPanelInfo } from '../../../src/debug/qualityDebug';
import { createDebugStats, isOverBudget, snapshotDebugStats, updateDebugStats } from '../../../src/debug/stats';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { QualityController } from '../../../src/render/quality/controller';
import { PASS_PROFILER } from '../../../src/render/quality/params';
import { PRESENT_TIMING, SPRITES_TIMING, type PassTimings } from '../../../src/render/quality/profiler';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl } from './fakeGl';

/** GPU time every query reports [ns] (2 ms). */
const QUERY_NS = 2e6;
const LIGHT_PASSES = ['occluder', 'shadow', 'lighting', 'composite'];

interface TimerGl {
  readonly gl: WebGL2RenderingContext;
  /** Queries begun so far. */
  begun: number;
  /** Queries begun while another was active (WebGL allows one at a time). */
  nested: number;
}

/** The fake context with the timer query extension and a renderer name (`renderer` null: no extension). */
function timerGl(renderer: string | null): TimerGl {
  const fake = createFakeGl();
  const ext = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
  const info = { UNMASKED_RENDERER_WEBGL: 0x9246 };
  const out: TimerGl = { gl: fake.gl, begun: 0, nested: 0 };
  let active = false;
  const base = fake.gl as unknown as Record<string, unknown>;
  const overrides: Record<string, unknown> = {
    getExtension: (name: string) => (renderer === null ? null : name === 'EXT_disjoint_timer_query_webgl2' ? ext : name === 'WEBGL_debug_renderer_info' ? info : null),
    getParameter: (p: number) => (p === info.UNMASKED_RENDERER_WEBGL ? renderer : p === ext.GPU_DISJOINT_EXT ? false : 0),
    createQuery: () => ({}),
    beginQuery: () => {
      if (active) out.nested++;
      active = true;
      out.begun++;
    },
    endQuery: () => {
      active = false;
    },
    getQueryParameter: (_q: unknown, p: number) => (p === base.QUERY_RESULT_AVAILABLE ? true : QUERY_NS),
  };
  (out as { gl: WebGL2RenderingContext }).gl = new Proxy(base, { get: (t, k) => (typeof k === 'string' && k in overrides ? overrides[k] : t[k as string]) }) as unknown as WebGL2RenderingContext;
  return out;
}

function renderer(gl: WebGL2RenderingContext): Renderer {
  return new Renderer(gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
}

function scene(): RenderScene {
  const s = new RenderScene();
  s.beginFrame(1);
  const l = s.light.reset();
  l.radius = 48;
  l.height = 12;
  l.intensity = 1;
  l.r = 1;
  l.g = 0.8;
  l.b = 0.5;
  s.lights.push(l);
  return s;
}

/** The table as the page asks for it (`RenderRuntime.passTimings`). */
function table(r: Renderer): PassTimings {
  return r.profiler.timings(
    r.passes
      .ordered()
      .filter((p) => p.enabled)
      .map((p) => p.name),
  );
}

describe('Pass-Zeiten per Timer-Query (M5-30)', () => {
  it('misst nur, solange jemand die Zeiten liest – sonst keine Timer-Query im Frame', () => {
    const t = timerGl('ANGLE (Intel, Mesa Intel(R) Xe Graphics)');
    const r = renderer(t.gl);
    for (let i = 0; i < 3; i++) r.render(scene(), 960, 540, 'sharp');
    expect(t.begun).toBe(0);
    table(r);
    r.render(scene(), 960, 540, 'sharp');
    expect(t.begun).toBeGreaterThan(0);
    for (let i = 0; i < PASS_PROFILER.windowFrames + 1; i++) r.render(scene(), 960, 540, 'sharp');
    const idle = t.begun;
    for (let i = 0; i < 3; i++) r.render(scene(), 960, 540, 'sharp');
    expect(t.begun).toBe(idle);
  });

  it('jeder gelaufene Pass mit GPU- und CPU-Zeit, in Reihenfolge, Sprite-Upload vorn, Präsentation hinten; nie zwei Queries zugleich', () => {
    const t = timerGl('ANGLE (Apple, ANGLE Metal Renderer: Apple M2)');
    const r = renderer(t.gl);
    table(r);
    for (let i = 0; i < 8; i++) r.render(scene(), 960, 540, 'sharp');
    const tab = table(r);
    const names = tab.passes.map((p) => p.name);
    expect(names[0]).toBe(SPRITES_TIMING);
    expect(names.at(-1)).toBe(PRESENT_TIMING);
    const enabled = r.passes
      .ordered()
      .filter((p) => p.enabled)
      .map((p) => p.name);
    // Every pass that ran is in the table, in the order it ran (the light strand's four from their own timers).
    expect(names.slice(1, -1)).toEqual(enabled);
    for (const n of LIGHT_PASSES) expect(names).toContain(n);
    for (const p of tab.passes) {
      expect(p.gpuMs, p.name).not.toBeNull();
      expect(p.gpuMs ?? 0, p.name).toBeGreaterThan(0);
      expect(p.cpuMs, p.name).toBeGreaterThanOrEqual(0);
    }
    expect(tab.gpuMs).toBeCloseTo(tab.passes.reduce((s, p) => s + (p.gpuMs ?? 0), 0), 6);
    expect(tab).toMatchObject({ gpuTimers: true, softwareRenderer: false, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2)' });
    // The light strand's passes are timed by their own timers, never bracketed a second time.
    expect(t.nested).toBe(0);
    for (const n of LIGHT_PASSES) expect(r.profiler.timedNames()).not.toContain(n);
  });

  it('SwiftShader hat Timer-Queries, misst aber CPU-Rasterung: als Software-Rasterer erkannt', () => {
    const t = timerGl('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)');
    const r = renderer(t.gl);
    expect(table(r)).toMatchObject({ gpuTimers: true, softwareRenderer: true });
  });

  it('ohne Erweiterung (Firefox, Safari): nur CPU-Zeiten, die GPU-Spalte bleibt leer', () => {
    const r = renderer(createFakeGl().gl);
    table(r);
    for (let i = 0; i < 4; i++) r.render(scene(), 960, 540, 'sharp');
    const tab = table(r);
    expect(tab.gpuTimers).toBe(false);
    expect(tab.gpuMs).toBeNull();
    expect(tab.passes.length).toBeGreaterThan(LIGHT_PASSES.length);
    expect(tab.passes.every((p) => p.gpuMs === null)).toBe(true);
  });
});

describe('F3: Render-Tafel und GPU-Zeile', () => {
  function info(over: Partial<{ halved: boolean; mode: 'auto' | 'full' | 'half'; level: 'low' | 'ultra'; preset: boolean; software: boolean; timers: boolean }> = {}): RenderPanelInfo {
    const pass = { halfResolution: over.halved ?? false };
    const q = new QualityController(
      {
        lighting: { configure: () => undefined, lighting: pass },
        particles: { configure: () => undefined },
        water: { configure: () => undefined },
        atmosphere: { configure: () => undefined },
        surface: { configure: () => undefined },
      },
      defaultSettings(),
    );
    if (over.level !== undefined) q.setOverride(over.level);
    q.setLightBufferMode(over.mode ?? 'auto');
    pass.halfResolution = over.halved ?? false;
    const state = q.state();
    return {
      quality: { ...state, preset: over.preset ?? state.preset },
      passes: { passes: [{ name: 'lighting', gpuMs: 1.5, cpuMs: 0.25 }], gpuMs: 1.5, cpuMs: 0.25, gpuTimers: over.timers ?? true, softwareRenderer: over.software ?? false, renderer: 'SwiftShader' },
    };
  }

  it('Stufe mit Herkunft, angepasst markiert; Lichtpuffer voll/halbiert und automatisch/fest; GI-Platz', () => {
    const de = createI18n('de', { strict: true }).t;
    const en = createI18n('en', { strict: true }).t;
    expect(qualityText(info(), de)).toBe('Hoch (Einstellungen)');
    expect(qualityText(info({ level: 'low' }), de)).toBe('Niedrig (Szenario)');
    expect(qualityText(info({ preset: false }), en)).toBe('High, adjusted (settings)');
    expect(lightBufferText(info(), de)).toBe('voll · automatisch');
    expect(lightBufferText(info({ mode: 'half', halved: true }), de)).toBe('halbiert · fest');
    expect(lightBufferText(info({ mode: 'full' }), en)).toBe('full · fixed');
    expect(giText(info(), de)).toBe('aus');
    // Ultra asks for GI, the renderer has none: the row says it is off, factually (review M5 Minor 13).
    expect(giText(info({ level: 'ultra' }), de)).toBe('aus (Stufe Ultra, Radiance Cascades nicht aktiv)');
    expect(giText(info({ level: 'ultra' }), en)).toBe('off (quality Ultra, radiance cascades not active)');
  });

  it('die Herkunft der GPU-Spalte: Timer-Query, Software-Rasterer oder keine', () => {
    const de = createI18n('de', { strict: true }).t;
    expect(gpuNote(info(), de)).toMatch(/Timer-Query/);
    expect(gpuNote(info({ software: true }), de)).toMatch(/Software-Rasterer \(SwiftShader\)/);
    expect(gpuNote(info({ timers: false }), de)).toMatch(/n\. v\./);
  });

  it('GPU (alle Pässe) mit dem §30-Budget von 10 ms', () => {
    const stats = createDebugStats();
    updateDebugStats(stats, { gpuMs: 4.25 });
    expect(snapshotDebugStats(stats).gpuMs).toBe(4.25);
    expect(isOverBudget('gpuMs', 10)).toBe(false);
    expect(isOverBudget('gpuMs', 10.5)).toBe(true);
    expect(isOverBudget('gpuMs', null)).toBe(false);
    // Under a software rasteriser the GPU column is CPU rasterisation: not judged against the GPU budget (review M5
    // Minor 12) – the other budgets still are.
    expect(isOverBudget('gpuMs', 250, true)).toBe(false);
    expect(isOverBudget('renderMs', 3.5, true)).toBe(true);
    const de = createI18n('de', { strict: true });
    expect(budgetTitle('gpuMs', 'de', de.t, 'SwiftShader')).toBe('Budget ≤ 10,00 ms gilt für die GPU der Zielhardware – unter dem Software-Rasterer (SwiftShader) sind es CPU-Rasterzeiten, nicht bewertet.');
    expect(budgetTitle('gpuMs', 'de', de.t)).toBe('Budget: ≤ 10,00 ms');
    expect(formatStat('gpuMs', 4.25, 'de', de.t)).toBe('4,25 ms');
    expect(formatStat('gpuMs', null, 'de', de.t)).toBe('n. v.');
    expect(de.t('debug.overlay.gpuMs')).toBe('GPU (alle Pässe)');
  });
});
