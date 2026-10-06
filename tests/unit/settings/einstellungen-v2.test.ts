/**
 * M7-55 Einstellungen Version 2 und FPS-Limit (MASTERPROMPT §29; docs/SPIEL.md §25 „Einstellungen“): VSync ist im Browser
 * nicht schaltbar – `graphics.vsync` verlässt das Format (Migration 1 → 2), `graphics.fpsLimit` 0 koppelt an die
 * Bildwiederholrate, jede andere Stufe begrenzt darunter (`limitedAnimationFrameClock`); die Werte bleiben nach einem Neuladen.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_LIMIT_TOLERANCE_MS, limitedAnimationFrameClock } from '../../../src/engine/frameLimit';
import { FixedStepLoop, type AnimationFrameHost } from '../../../src/engine/loop';
import { createSettingsStore, defaultSettings, FPS_LIMITS, graphicsSchema, parseStoredSettings, SETTINGS_MIGRATIONS, SETTINGS_STORAGE_KEY, SETTINGS_VERSION, type SettingsStorage } from '../../../src/engine/settings';

class MemoryStorage implements SettingsStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/** A display with a fixed refresh rate: `tick()` advances its clock by one refresh and runs the pending animation frame. */
class FakeDisplay implements AnimationFrameHost {
  t = 0;
  private next = 1;
  private readonly callbacks = new Map<number, (time: number) => void>();
  constructor(readonly hz: number) {}
  readonly performance = { now: (): number => this.t };
  requestAnimationFrame(cb: (time: number) => void): number {
    const id = this.next++;
    this.callbacks.set(id, cb);
    return id;
  }
  cancelAnimationFrame(handle: number): void {
    this.callbacks.delete(handle);
  }
  /** One refresh, with `jitter` ms of lateness for this frame. */
  tick(jitter = 0): void {
    this.t += 1000 / this.hz;
    const due = [...this.callbacks];
    this.callbacks.clear();
    const saved = this.t;
    this.t += jitter;
    for (const [, cb] of due) cb(this.t);
    this.t = saved;
  }
}

describe('Einstellungen Version 2', () => {
  it('VSync ist kein Schlüssel mehr; 0 bleibt die Voreinstellung des FPS-Limits', () => {
    expect(SETTINGS_VERSION).toBe(2);
    expect('vsync' in defaultSettings().graphics).toBe(false);
    expect(Object.keys(graphicsSchema.shape)).not.toContain('vsync');
    expect(defaultSettings().graphics.fpsLimit).toBe(0);
    expect(FPS_LIMITS[0]).toBe(0);
  });

  it('Migration 1 → 2: gespeichertes vsync fällt weg, alles andere bleibt, nichts wird als ungültig gemeldet', () => {
    const v1 = { v: 1, settings: { ...defaultSettings(), graphics: { ...defaultSettings().graphics, vsync: false, fpsLimit: 60, crt: true }, language: 'en' } };
    // The migration itself drops the key (the schema would strip it silently anyway – the format must not carry it on).
    const migration = SETTINGS_MIGRATIONS.find((m) => m.from === 1);
    if (migration === undefined) throw new Error('Migration 1 → 2 fehlt');
    const migrated = migration.migrate(structuredClone(v1.settings) as unknown as Record<string, unknown>) as { graphics: Record<string, unknown>; language: unknown };
    expect('vsync' in migrated.graphics).toBe(false);
    expect(migrated.graphics.fpsLimit).toBe(60);
    expect(migrated.graphics.crt).toBe(true);
    expect(migrated.language).toBe('en');
    const r = parseStoredSettings(JSON.stringify(v1), defaultSettings());
    expect(r.storedVersion).toBe(1);
    expect(r.issues).toEqual([]);
    expect(r.settings.graphics.fpsLimit).toBe(60);
    expect(r.settings.graphics.crt).toBe(true);
    expect(r.settings.language).toBe('en');
    expect('vsync' in r.settings.graphics).toBe(false);
    // A store loads it, writes version 2 on the next change and keeps the values.
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(v1));
    const store = createSettingsStore(storage);
    store.update({ audio: { music: 0.25 } });
    const written = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? 'null') as { v: number; settings: { graphics: Record<string, unknown>; audio: { music: number } } };
    expect(written.v).toBe(2);
    expect(written.settings.graphics.fpsLimit).toBe(60);
    expect('vsync' in written.settings.graphics).toBe(false);
    expect(createSettingsStore(storage).get().audio.music).toBe(0.25);
  });
});

describe('FPS-Limit (An Bildwiederholrate koppeln oder begrenzen)', () => {
  function run(hz: number, limit: number, refreshes: number, jitter: (i: number) => number = () => 0): { frames: number; skipped: number } {
    const display = new FakeDisplay(hz);
    let fps = limit;
    const clock = limitedAnimationFrameClock(display, () => fps);
    const loop = new FixedStepLoop({ ...clock, update: () => undefined, render: () => undefined });
    loop.start();
    for (let i = 0; i < refreshes; i++) display.tick(jitter(i));
    loop.stop();
    fps = 0;
    return { frames: clock.stats.delivered, skipped: clock.stats.animationFrames - clock.stats.delivered };
  }

  it('0: jedes Bild der Anzeige; 30 auf 60 Hz: jedes zweite; 60 auf 144 Hz: ≈ 60 je Sekunde; über der Bildrate: jedes', () => {
    expect(run(60, 0, 120).frames).toBe(120);
    expect(run(60, 30, 120).frames).toBe(60);
    const f144 = run(144, 60, 144).frames;
    expect(f144).toBeGreaterThanOrEqual(58);
    expect(f144).toBeLessThanOrEqual(62);
    expect(run(60, 144, 120).frames).toBe(120);
  });

  it('Zittern der Anzeige verschiebt die Phase nicht (kein Drift), ein Stillstand beginnt neu', () => {
    const jittered = run(60, 30, 600, (i) => ((i * 7) % 5) * (FRAME_LIMIT_TOLERANCE_MS / 4) - FRAME_LIMIT_TOLERANCE_MS / 2);
    expect(jittered.frames).toBeGreaterThanOrEqual(299);
    expect(jittered.frames).toBeLessThanOrEqual(301);
  });

  it('übersprungene Bilder laufen die Simulation nicht: sie holt im nächsten Bild auf (Spielzeit unverändert)', () => {
    const display = new FakeDisplay(60);
    let ticks = 0;
    const clock = limitedAnimationFrameClock(display, () => 30);
    const loop = new FixedStepLoop({ ...clock, update: () => ticks++, render: () => undefined });
    loop.start();
    for (let i = 0; i < 600; i++) display.tick();
    loop.stop();
    // Ten seconds of display time: 600 ticks at 60 Hz whether every frame runs or every second one.
    expect(Math.abs(ticks - 600)).toBeLessThanOrEqual(2);
    expect(clock.stats.delivered).toBe(300);
  });
});
