/**
 * M5-26: Auto-Voreinstellung per Kurz-Benchmark beim Erststart (§6.3). Der Benchmark misst von der niedrigsten Stufe
 * aufwärts (Aufwärm-Frames verworfen, Median entscheidet) und wählt die höchste Stufe im Budget; die Seite bindet ihn an
 * die Einstellungen: nur beim ersten Start, nie in Screenshot-Szenarien, nie gegen die Wahl des Spielers; sein Ergebnis
 * wird mit `autoDetected` gespeichert.
 */
import { describe, expect, it } from 'vitest';
import { createSettingsStore, QUALITY_PRESETS, qualityPatch, SETTINGS_STORAGE_KEY, type QualityLevel, type SettingsStorage } from '../../../src/engine/settings';
import { AutoPresetBenchmark, medianOf } from '../../../src/render/quality/autoPreset';
import { OWN_CHOICE, startRenderQuality } from '../../../src/render/quality/boot';
import { QualityController, type QualityControllerTargets } from '../../../src/render/quality/controller';
import { AUTO_PRESET } from '../../../src/render/quality/params';
import { GpuFrameWait, type FenceContext, type PollScheduler } from '../../../src/render/quality/gpuWait';

const PER_LEVEL = AUTO_PRESET.warmupFrames + AUTO_PRESET.sampleFrames;

/** Feeds `bench` frame times from `cost(level)` until it is done; returns the levels it rendered, frame by frame. */
function run(bench: AutoPresetBenchmark, cost: (level: QualityLevel, frame: number) => number): QualityLevel[] {
  const rendered: QualityLevel[] = [];
  for (let i = 0; i < 100 && !bench.done; i++) {
    rendered.push(bench.level);
    bench.sample(cost(bench.level, i));
  }
  return rendered;
}

/** Targets that record what the controller configures. */
function targets(): QualityControllerTargets & { levels: number[] } {
  const levels: number[] = [];
  return {
    levels,
    lighting: { configure: (s) => levels.push(s.maxLights), lighting: { halfResolution: false } },
    particles: { configure: () => undefined },
    water: { configure: () => undefined },
    atmosphere: { configure: () => undefined },
    surface: { configure: () => undefined },
  };
}

function memoryStorage(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('Kurz-Benchmark (Auswahl)', () => {
  it('Median über die gemessenen Frames', () => {
    expect(medianOf(new Float64Array([5, 1, 3]), 3)).toBe(3);
    expect(medianOf(new Float64Array([4, 1, 3, 2]), 4)).toBe(2.5);
    expect(medianOf(new Float64Array([9, 1, 2, 7]), 3)).toBe(2);
    expect(medianOf(new Float64Array(1), 0)).toBeNaN();
  });

  it('ein schnelles Gerät misst alle Stufen von unten nach oben und bekommt Ultra', () => {
    const bench = new AutoPresetBenchmark();
    const rendered = run(bench, () => 3);
    expect(bench.result).toMatchObject({ level: 'ultra', overBudget: null });
    expect(bench.result?.medians.map((m) => m.level)).toEqual(['low', 'medium', 'high', 'ultra']);
    expect(rendered).toEqual(['low', 'medium', 'high', 'ultra'].flatMap((l) => Array<string>(PER_LEVEL).fill(l)));
  });

  it('die erste Stufe über dem Budget beendet den Lauf: ihre Vorgängerin gilt', () => {
    const cost: Record<QualityLevel, number> = { low: 3, medium: 5, high: AUTO_PRESET.budgetMs + 1, ultra: 1 };
    const bench = new AutoPresetBenchmark();
    run(bench, (l) => cost[l]);
    expect(bench.result).toMatchObject({ level: 'medium', overBudget: 'high' });
    // Ultra is never tried once "Hoch" is over the budget.
    expect(bench.result?.medians.map((m) => m.level)).toEqual(['low', 'medium', 'high']);
  });

  it('ein langsames Gerät (Software-Rasterer) bekommt Niedrig nach einer einzigen gemessenen Stufe', () => {
    const bench = new AutoPresetBenchmark();
    const rendered = run(bench, () => 400);
    expect(bench.result).toMatchObject({ level: 'low', overBudget: 'low' });
    expect(rendered).toHaveLength(PER_LEVEL);
  });

  it('Aufwärm-Frames zählen nicht, ein Ausreißer im Messfenster entscheidet nicht', () => {
    const bench = new AutoPresetBenchmark();
    // Every level: slow first frames (programs compiled), then fast frames with one hitch.
    run(bench, (_l, i) => {
      const k = i % PER_LEVEL;
      if (k < AUTO_PRESET.warmupFrames) return 500;
      return k === AUTO_PRESET.warmupFrames + 1 ? 300 : 4;
    });
    expect(bench.result?.level).toBe('ultra');
    expect(bench.result?.medians.every((m) => m.ms === 4)).toBe(true);
  });

  it('ungültige Zeiten werden übergangen', () => {
    const bench = new AutoPresetBenchmark();
    expect(bench.sample(Number.NaN)).toBe(false);
    expect(bench.sample(-1)).toBe(false);
    expect(bench.sample(Number.POSITIVE_INFINITY)).toBe(false);
    expect(bench.measured).toBe(0);
  });
});

describe('Kurz-Benchmark im Regler', () => {
  it('wartet auf die fertige Szene, misst Stufe für Stufe in eben dieser Stufe, meldet das Ergebnis', () => {
    const t = targets();
    const q = new QualityController(t, createSettingsStore(null, { autoSave: false }).get());
    const results: QualityLevel[] = [];
    q.startBenchmark((r) => results.push(r.level), 0);
    expect(q.benchmarkPhase).toBe('wartet');
    q.benchmarkTick(100, false);
    expect(q.benchmarkMeasuring).toBe(false);
    q.benchmarkTick(200, true);
    expect(q.benchmarkMeasuring).toBe(true);
    expect(q.state()).toMatchObject({ level: 'low', source: 'benchmark' });
    expect(t.levels.at(-1)).toBe(QUALITY_PRESETS.low.maxLights);
    // "Mittel" still fits, "Hoch" does not.
    for (let i = 0; i < 3 * PER_LEVEL && q.benchmarkMeasuring; i++) q.benchmarkSample(q.state().level === 'high' ? 50 : 2);
    expect(results).toEqual(['medium']);
    expect(q.benchmarkPhase).toBe('fertig');
    expect(q.state().benchmark.result?.level).toBe('medium');
    // Back to the settings' level until the page stores the result.
    expect(q.state().source).toBe('einstellungen');
  });

  it('bricht ab, wenn die Szene nicht fertig wird', () => {
    const q = new QualityController(targets(), createSettingsStore(null, { autoSave: false }).get());
    let called = false;
    q.startBenchmark(() => (called = true), 0);
    q.benchmarkTick(AUTO_PRESET.readyTimeoutMs + 1, false);
    expect(q.state().benchmark).toMatchObject({ phase: 'abgebrochen', reason: 'szene-nicht-bereit' });
    expect(called).toBe(false);
  });

  it('misst nie mit halbiertem Lichtpuffer', () => {
    const t = targets();
    const q = new QualityController(t, createSettingsStore(null, { autoSave: false }).get());
    q.setLightBufferMode('half');
    expect(t.lighting.lighting.halfResolution).toBe(true);
    q.startBenchmark(() => undefined, 0);
    q.benchmarkTick(0, true);
    expect(t.lighting.lighting.halfResolution).toBe(false);
    q.cancelBenchmark('test');
    expect(t.lighting.lighting.halfResolution).toBe(true);
  });
});

describe('Erststart auf der Seite (startRenderQuality)', () => {
  function boot(storage: SettingsStorage, search = '', debug = false): { store: ReturnType<typeof createSettingsStore>; q: QualityController } {
    const store = createSettingsStore(storage);
    const q = new QualityController(targets(), store.get());
    startRenderQuality({ settings: store, quality: q, search, debug, now: () => 0 });
    return { store, q };
  }

  /** Measures until done: `high` and above over the budget. */
  function finish(q: QualityController): void {
    q.benchmarkTick(0, true);
    for (let i = 0; i < 4 * PER_LEVEL && q.benchmarkMeasuring; i++) q.benchmarkSample(q.state().level === 'high' || q.state().level === 'ultra' ? 40 : 2);
  }

  it('der erste Start misst, setzt die Stufe samt Voreinstellung und speichert sie mit autoDetected', () => {
    const storage = memoryStorage();
    const { store, q } = boot(storage);
    expect(q.benchmarkPhase).toBe('wartet');
    finish(q);
    expect(store.get().graphics).toMatchObject({ quality: 'medium', autoDetected: true, ...QUALITY_PRESETS.medium });
    const stored = JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY) ?? '{}') as { settings: { graphics: { quality: string; autoDetected: boolean } } };
    expect(stored.settings.graphics).toMatchObject({ quality: 'medium', autoDetected: true });
    expect(q.state()).toMatchObject({ level: 'medium', source: 'einstellungen' });
    // The next start keeps it and does not measure again.
    const again = boot(storage);
    expect(again.q.benchmarkPhase).toBe('aus');
    expect(again.store.get().graphics.quality).toBe('medium');
  });

  it('Screenshot-Szenarien messen nie (deterministische Bilder)', () => {
    const { q } = boot(memoryStorage(), '?debug=1&scenario=qualitaet-hoch', true);
    expect(q.benchmarkPhase).toBe('aus');
  });

  it('eine Stufe in der URL einer Debug-Seite gilt als Wahl: gespeichert, kein Benchmark', () => {
    const { store, q } = boot(memoryStorage(), '?debug=1&quality=low', true);
    expect(q.benchmarkPhase).toBe('aus');
    expect(store.get().graphics).toMatchObject({ quality: 'low', autoDetected: true, ...QUALITY_PRESETS.low });
    expect(q.state().level).toBe('low');
    // Without debug mode the parameter means nothing.
    const plain = boot(memoryStorage(), '?quality=low', false);
    expect(plain.q.benchmarkPhase).toBe('wartet');
  });

  it('wählt der Spieler vorher eine Stufe, gilt seine Wahl: der Benchmark stoppt, der Erststart ist erledigt', () => {
    const storage = memoryStorage();
    const { store, q } = boot(storage);
    q.benchmarkTick(0, true);
    q.benchmarkSample(2);
    store.update(qualityPatch('ultra'));
    expect(q.state().benchmark).toMatchObject({ phase: 'abgebrochen', reason: OWN_CHOICE });
    expect(store.get().graphics).toMatchObject({ quality: 'ultra', autoDetected: true });
    expect(q.state()).toMatchObject({ level: 'ultra', source: 'einstellungen' });
    expect(boot(storage).q.benchmarkPhase).toBe('aus');
  });
});

describe('Frame-Zeit bis die GPU fertig ist (Fence statt Rücklesen)', () => {
  /** A context whose fence signals `gpuMs` after the frame started; a scheduler driven by hand on a fake clock. */
  function rig(gpuMs: number) {
    let now = 0;
    let lost = false;
    const deleted: unknown[] = [];
    const fence = {};
    const gl: FenceContext = {
      SYNC_GPU_COMMANDS_COMPLETE: 1,
      SYNC_STATUS: 2,
      SIGNALED: 3,
      fenceSync: () => fence as WebGLSync,
      flush: () => undefined,
      isContextLost: () => lost,
      getSyncParameter: () => (now >= gpuMs ? 3 : 4),
      deleteSync: (s: WebGLSync | null) => void deleted.push(s),
    } as unknown as FenceContext;
    const queue: Array<{ run: () => void; at: number; soon: boolean }> = [];
    const scheduler: PollScheduler = {
      soon: (run) => void queue.push({ run, at: now, soon: true }),
      later: (run, ms) => void queue.push({ run, at: now + ms, soon: false }),
    };
    /** Runs the queue; each task advances the clock by `taskMs` (or to its timeout). */
    const drain = (taskMs: number): { soon: number; later: number } => {
      const counts = { soon: 0, later: 0 };
      for (let i = 0; i < 10_000 && queue.length > 0; i++) {
        const t = queue.shift();
        if (t === undefined) break;
        now = Math.max(now + taskMs, t.at);
        counts[t.soon ? 'soon' : 'later']++;
        t.run();
      }
      return counts;
    };
    const wait = new GpuFrameWait(gl, scheduler, () => now);
    return { wait, drain, deleted, setLost: (v: boolean) => (lost = v) };
  }

  it('misst von Frame-Beginn bis zum Signal des Fence, ohne readPixels', () => {
    const { wait, drain, deleted } = rig(6);
    const got: number[] = [];
    expect(wait.measure(0, (ms) => got.push(ms))).toBe(true);
    expect(wait.busy).toBe(true);
    // Only one frame at a time.
    expect(wait.measure(0, (ms) => got.push(ms))).toBe(false);
    drain(0.5);
    expect(got).toHaveLength(1);
    expect(got[0]).toBeGreaterThanOrEqual(6);
    expect(got[0]).toBeLessThan(6.6);
    expect(wait.busy).toBe(false);
    expect(deleted).toHaveLength(1);
  });

  it('fragt nahe am Budget ohne Pause, darüber gemächlich, und gibt nach der Frist auf', () => {
    const slow = rig(600);
    const got: number[] = [];
    slow.wait.measure(0, (ms) => got.push(ms));
    const counts = slow.drain(0.5);
    expect(got[0]).toBeGreaterThanOrEqual(600);
    expect(counts.soon).toBeLessThanOrEqual(Math.ceil(AUTO_PRESET.spinMs / 0.5) + 2);
    expect(counts.later).toBeGreaterThan(0);
    const never = rig(Number.POSITIVE_INFINITY);
    const late: number[] = [];
    never.wait.measure(0, (ms) => late.push(ms));
    never.drain(0.5);
    expect(late).toEqual([AUTO_PRESET.gpuTimeoutMs]);
  });

  it('nach einem Kontextverlust kein Messwert', () => {
    const { wait, drain, setLost } = rig(6);
    const got: number[] = [];
    wait.measure(0, (ms) => got.push(ms));
    setLost(true);
    drain(0.5);
    expect(got).toEqual([]);
    expect(wait.busy).toBe(false);
    wait.measure(0, (ms) => got.push(ms));
    wait.cancel();
    expect(wait.busy).toBe(false);
  });
});
