/**
 * M5-26: dynamische Halbierung des Lichtpuffers bei Frame-Einbrüchen (§6.3) – Einbruch-Erkennung (gleitendes Mittel der
 * Bildabstände über der Schwelle, einzelne Hänger zählen nicht, Pausen sind keine Einbrüche) und Hysterese (zurück erst
 * nach gesunder Zeit unter der niedrigeren Schwelle; ein Rückfall kurz nach dem Zurückschalten verdoppelt die Wartezeit),
 * die Modi des Reglers (automatisch nur mit der Einstellung, fest auf Debug-Seiten), und der Lichtpass im halbierten
 * Puffer auf dem Fake-GL-Kontext (halbe Zielgröße, ein Vollbild-Draw zum Hochrechnen, Abgleich-Frames in voller Größe).
 */
import { describe, expect, it } from 'vitest';
import { createSettingsStore, defaultSettings } from '../../../src/engine/settings';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { LIGHT_UPSAMPLE_SHADER } from '../../../src/render/passes/lightingPass';
import { LightBufferGovernor } from '../../../src/render/quality/lightBuffer';
import { QualityController, type QualityControllerTargets } from '../../../src/render/quality/controller';
import { startRenderQuality } from '../../../src/render/quality/boot';
import { HALF_LIGHT_BUFFER_DIVISOR, LIGHT_BUFFER_GOVERNOR as P, TARGET_FRAME_MS } from '../../../src/render/quality/params';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl, type GlCall } from './fakeGl';

const T = TARGET_FRAME_MS;

/** Feeds `n` intervals of `ms`; returns the number of frames after which the buffer was first halved (−1: never). */
function feed(g: LightBufferGovernor, ms: number, n: number): number {
  let first = -1;
  for (let i = 0; i < n; i++) if (g.frame(ms) && first < 0) first = i + 1;
  return first;
}

/** Healthy frames at the target rate for `ms` milliseconds. */
function healthy(g: LightBufferGovernor, ms: number): void {
  for (let t = 0; t < ms; t += T) g.frame(T);
}

describe('Einbruch-Erkennung', () => {
  it('flüssige 60 FPS halbieren nie, auch nicht über Minuten', () => {
    const g = new LightBufferGovernor();
    expect(feed(g, T, 60 * 60 * 5)).toBe(-1);
    expect(g.verdict().averageMs).toBeCloseTo(T, 6);
  });

  it('ein anhaltender Einbruch (jeder zweite Vsync verpasst) halbiert nach der Frist, nicht vorher', () => {
    const g = new LightBufferGovernor();
    healthy(g, 1000);
    let first = -1;
    for (let i = 0; i < 200 && first < 0; i++) if (g.frame(i % 2 === 0 ? T : 2 * T)) first = i + 1;
    expect(first).toBeGreaterThanOrEqual(P.dropFrames);
    expect(first).toBeLessThan(P.dropFrames * 3);
    expect(g.halved).toBe(true);
    expect(g.verdict().halvings).toBe(1);
  });

  it('einzelne Hänger (Speicherbereinigung, gestreamter Chunk) halbieren nicht', () => {
    const g = new LightBufferGovernor();
    healthy(g, 1000);
    for (let k = 0; k < 20; k++) {
      g.frame(120);
      healthy(g, 500);
    }
    expect(g.halved).toBe(false);
  });

  it('Pausen (verborgener Tab, angehaltene Schleife) sind keine Einbrüche und setzen das Mittel zurück', () => {
    const g = new LightBufferGovernor();
    for (let k = 0; k < 100; k++) g.frame(P.pauseMs + 1);
    expect(g.halved).toBe(false);
    expect(g.verdict().overFrames).toBe(0);
    // A pause in the middle of a drop restarts the count.
    feed(g, 3 * T, P.dropFrames - 1);
    g.frame(5000);
    expect(feed(g, 3 * T, P.dropFrames - 1)).toBe(-1);
    expect(g.frame(Number.NaN)).toBe(false);
  });

  it('ein FPS-Limit unter 60 senkt die Messlatte', () => {
    const g = new LightBufferGovernor();
    g.setTarget(1000 / 30);
    expect(feed(g, 1000 / 30, 600)).toBe(-1);
    g.setTarget(0);
    expect(g.verdict().targetMs).toBeCloseTo(1000 / 30);
  });
});

describe('Hysterese', () => {
  /** A governor that has just halved. */
  function halvedGovernor(): LightBufferGovernor {
    const g = new LightBufferGovernor();
    feed(g, 3 * T, P.dropFrames * 2);
    expect(g.halved).toBe(true);
    return g;
  }

  it('zurück zum vollen Puffer erst nach gesunder Zeit unter der unteren Schwelle', () => {
    const g = halvedGovernor();
    // Between the thresholds (1.1 … 1.25 × target): neither a drop nor healthy – it stays halved.
    for (let i = 0; i < 2000; i++) g.frame(T * ((P.healthyFactor + P.dropFactor) / 2));
    expect(g.halved).toBe(true);
    // Healthy frames: back after `restoreAfterMs` (plus the frames the average needs to fall).
    healthy(g, P.restoreAfterMs - 500);
    expect(g.halved).toBe(true);
    healthy(g, 2000);
    expect(g.halved).toBe(false);
  });

  it('ein Rückfall kurz nach dem Zurückschalten verdoppelt die Wartezeit (kein Hin und Her), bis zur Obergrenze', () => {
    const g = halvedGovernor();
    let wait: number = P.restoreAfterMs;
    for (let attempt = 0; attempt < 8; attempt++) {
      healthy(g, wait + 2000);
      expect(g.halved).toBe(false);
      // The full buffer is too slow again at once: halved within the retry window.
      feed(g, 3 * T, P.dropFrames * 2);
      expect(g.halved).toBe(true);
      wait = Math.min(P.maxRestoreAfterMs, wait * 2);
      expect(g.verdict().restoreAfterMs).toBe(wait);
    }
    expect(g.verdict().restoreAfterMs).toBe(P.maxRestoreAfterMs);
  });

  it('hält der volle Puffer über das Fenster hinaus, gilt wieder die kurze Wartezeit', () => {
    const g = halvedGovernor();
    healthy(g, P.restoreAfterMs + 2000);
    feed(g, 3 * T, P.dropFrames * 2);
    expect(g.verdict().restoreAfterMs).toBe(P.restoreAfterMs * 2);
    healthy(g, P.restoreAfterMs * 2 + 2000);
    expect(g.halved).toBe(false);
    healthy(g, P.retryWindowMs + 1000);
    feed(g, 3 * T, P.dropFrames * 2);
    expect(g.halved).toBe(true);
    expect(g.verdict().restoreAfterMs).toBe(P.restoreAfterMs);
  });
});

describe('Modi des Reglers', () => {
  function controller(adaptive = true): { q: QualityController; pass: { halfResolution: boolean } } {
    const pass = { halfResolution: false };
    const t: QualityControllerTargets = {
      lighting: { configure: () => undefined, lighting: pass },
      particles: { configure: () => undefined },
      water: { configure: () => undefined },
      atmosphere: { configure: () => undefined },
      surface: { configure: () => undefined },
    };
    const s = defaultSettings();
    return { q: new QualityController(t, { graphics: { ...s.graphics, adaptiveLightBuffer: adaptive }, accessibility: s.accessibility }), pass };
  }

  /** Presents `n` frames `ms` apart. */
  function present(q: QualityController, ms: number, n: number, from = 0): number {
    let now = from;
    for (let i = 0; i < n; i++) q.frame((now += ms));
    return now;
  }

  it('automatisch: halbiert bei Einbruch, mit ausgeschalteter Einstellung nie', () => {
    const on = controller(true);
    present(on.q, 3 * T, P.dropFrames * 2);
    expect(on.pass.halfResolution).toBe(true);
    expect(on.q.state().lightBuffer).toMatchObject({ mode: 'auto', adaptive: true, halved: true });
    const off = controller(false);
    present(off.q, 3 * T, P.dropFrames * 2);
    expect(off.pass.halfResolution).toBe(false);
    // The governor still sees the drop (the F3 overlay shows it), it just may not act.
    expect(off.q.state().lightBuffer.governor.halved).toBe(true);
  });

  it('fest: Debug-Seiten bleiben voll, halb ist erzwingbar', () => {
    const { q, pass } = controller();
    q.setLightBufferMode('full');
    present(q, 3 * T, P.dropFrames * 2);
    expect(pass.halfResolution).toBe(false);
    q.setLightBufferMode('half');
    expect(pass.halfResolution).toBe(true);
    q.setLightBufferMode('auto');
    // Back to automatic: the governor starts fresh.
    expect(pass.halfResolution).toBe(false);
  });
});

describe('Lichtpass im halbierten Puffer (Fake-GL)', () => {
  function litScene(): RenderScene {
    const s = new RenderScene();
    s.beginFrame(1);
    const l = s.light.reset();
    l.x = 0;
    l.y = 0;
    l.height = 12;
    l.radius = 64;
    l.r = 1;
    l.g = 0.7;
    l.b = 0.4;
    l.intensity = 1;
    s.lights.push(l);
    return s;
  }

  it('zeichnet die Lichter in ein Ziel halber Größe und rechnet es in einem Vollbild-Draw hoch', () => {
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    const pass = r.lighting.lighting;
    const run = pass.execute.bind(pass);
    let calls: GlCall[] = [];
    pass.execute = (ctx) => {
      const from = fake.calls.length;
      run(ctx);
      calls = fake.calls.slice(from);
    };
    const viewports = (): number[][] => calls.filter((c) => c.name === 'viewport').map((c) => c.args as number[]);
    r.render(litScene(), 960, 540, 'sharp');
    const full = viewports();
    expect(full).toHaveLength(1);
    expect(pass.halvedInLastFrame).toBe(false);
    expect(calls.filter((c) => c.name === 'drawArrays')).toHaveLength(0);

    pass.halfResolution = true;
    r.render(litScene(), 960, 540, 'sharp');
    expect(pass.halvedInLastFrame).toBe(true);
    const [half, back] = viewports();
    const [, , w, h] = full[0] as number[];
    expect(half).toEqual([0, 0, Math.ceil((w as number) / HALF_LIGHT_BUFFER_DIVISOR), Math.ceil((h as number) / HALF_LIGHT_BUFFER_DIVISOR)]);
    expect(back).toEqual(full[0]);
    // The lights in one instanced draw into the half target, the upsampling in one fullscreen draw.
    expect(calls.filter((c) => c.name === 'drawArraysInstanced')).toHaveLength(1);
    expect(calls.filter((c) => c.name === 'drawArrays')).toHaveLength(1);
    const divisor = calls.filter((c) => c.name === 'uniform1i' && c.args[1] === HALF_LIGHT_BUFFER_DIVISOR);
    expect(divisor.length).toBeGreaterThanOrEqual(2);

    // A frame the light map debugger compares runs at full resolution.
    pass.compareNext = true;
    r.render(litScene(), 960, 540, 'sharp');
    expect(pass.halvedInLastFrame).toBe(false);
  });

  it('die Programme: jedes Fragment beleuchtet das erste Pixel seines Blocks, das Hochrechnen folgt der G-Buffer-Höhe', () => {
    const point = (SHADERS['lighting_point.frag'] ?? '').replace(/\s+/g, ' ');
    expect(point).toContain('ivec2 p = ivec2(gl_FragCoord.xy) * uDivisor;');
    expect(point).toContain('vec2 screen = uOrigin + vec2(float(p.x) + 0.5, uTargetSize.y - float(p.y) - 0.5);');
    const up = (SHADERS[LIGHT_UPSAMPLE_SHADER] ?? '').replace(/\s+/g, ' ');
    expect(up).toContain('float dz = abs(heightAt(c * uDivisor) - z);');
    expect(up).toContain('oDiffuse = texelFetch(uHalfDiffuse, best, 0);');
    expect(up).toContain('oSpecular = texelFetch(uHalfSpecular, best, 0);');
  });
});

describe('Seite: Einstellung und Regler', () => {
  it('die Einstellung „Adaptiver Lichtpuffer“ steht standardmäßig an', () => {
    expect(createSettingsStore(null, { autoSave: false }).get().graphics.adaptiveLightBuffer).toBe(true);
  });
});

describe('Lichtpuffer auf der Seite (startRenderQuality)', () => {
  it('das Spiel passt ihn an; Debug-Seiten halten ihn voll, außer die URL sagt es anders', () => {
    const cases: ReadonlyArray<readonly [string, boolean, string]> = [
      ['', false, 'auto'],
      ['?lightBuffer=half', false, 'auto'],
      ['?debug=1', true, 'full'],
      ['?debug=1&lightBuffer=auto', true, 'auto'],
      ['?debug=1&lightBuffer=half', true, 'half'],
      ['?debug=1&lightBuffer=quatsch', true, 'full'],
    ];
    for (const [search, debug, mode] of cases) {
      const pass = { halfResolution: false };
      const store = createSettingsStore(null, { autoSave: false });
      store.update({ graphics: { autoDetected: true } });
      const q = new QualityController(
        {
          lighting: { configure: () => undefined, lighting: pass },
          particles: { configure: () => undefined },
          water: { configure: () => undefined },
          atmosphere: { configure: () => undefined },
          surface: { configure: () => undefined },
        },
        store.get(),
      );
      startRenderQuality({ settings: store, quality: q, search, debug, now: () => 0 });
      expect(q.lightBufferMode, search).toBe(mode);
      expect(pass.halfResolution, search).toBe(mode === 'half');
    }
  });
});
