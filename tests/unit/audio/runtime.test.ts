/**
 * M3-33 audio runtime: the autoplay unlock (no context before the first gesture), rendering in the SFX
 * worker, simulation events → voices, the listener following the session's focus, bus volumes following
 * the settings, subtitles only while enabled, suspension while the page is hidden, clean disposal.
 */
import { describe, expect, it } from 'vitest';
import { attachAudio, type AudioSession, type SfxWorkerLike } from '../../../src/audio/runtime';
import type { SfxRenderRequest, SfxRenderResult } from '../../../src/audio/sfxWorkerProtocol';
import { renderTakes } from '../../../src/audio/dsp/render';
import { SFX_BUSES, SFX_PRESETS } from '../../../src/content/sfx/index';
import { createSettingsStore } from '../../../src/engine/settings';
import type { SessionFocus } from '../../../src/game/session';
import type { SimEventMap } from '../../../src/game/sim';
import { FakeContext, type FakeGain, type FakeSource } from './fakeAudio';

class FakeSession implements AudioSession {
  readonly handlers = new Map<string, Array<(payload: never) => void>>();
  focus: SessionFocus = { x: 100, y: 200, layer: 0 };
  onEvent<K extends keyof SimEventMap>(type: K, handler: (payload: SimEventMap[K]) => void): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as (payload: never) => void);
    this.handlers.set(type, list);
    return () => list.splice(list.indexOf(handler as (payload: never) => void), 1);
  }
  emit<K extends keyof SimEventMap>(type: K, payload: Partial<SimEventMap[K]>): void {
    for (const h of this.handlers.get(type) ?? []) (h as (p: unknown) => void)({ tick: 0, ...payload });
  }
  sampleFocus(out: SessionFocus): boolean {
    out.x = this.focus.x;
    out.y = this.focus.y;
    out.layer = this.focus.layer;
    return true;
  }
}

class FakeWorker implements SfxWorkerLike {
  onmessage: ((ev: MessageEvent<SfxRenderResult>) => unknown) | null = null;
  readonly requests: SfxRenderRequest[] = [];
  postMessage(message: SfxRenderRequest): void {
    this.requests.push(message);
  }
  /** Answers one preset like the real worker. */
  answer(id: string): void {
    const p = SFX_PRESETS.find((s) => s.id === id);
    if (p === undefined) throw new Error(id);
    this.onmessage?.(new MessageEvent('message', { data: { id, takes: renderTakes(p) } }));
  }
}

class FakeDocument {
  hidden = false;
  private readonly target = new EventTarget();
  addEventListener(type: 'visibilitychange', listener: () => void): void {
    this.target.addEventListener(type, listener);
  }
  set(hidden: boolean): void {
    this.hidden = hidden;
    this.target.dispatchEvent(new Event('visibilitychange'));
  }
}

function setup() {
  const session = new FakeSession();
  const settings = createSettingsStore(null);
  const gestures = new EventTarget();
  const doc = new FakeDocument();
  const ctx = new FakeContext();
  ctx.state = 'suspended';
  const worker = new FakeWorker();
  let created = 0;
  const audio = attachAudio({
    session,
    settings,
    gestureTarget: gestures,
    visibility: doc,
    createContext: () => {
      created++;
      return ctx;
    },
    createWorker: () => worker,
    seed: 5,
  });
  return { session, settings, gestures, doc, ctx, worker, audio, created: () => created };
}

describe('Audio-Laufzeit', () => {
  it('erzeugt den Kontext erst bei der ersten Geste (Autoplay-Regel) und hört dann auf zu lauschen', () => {
    const { session, gestures, ctx, audio, created } = setup();
    session.emit('playerRolled', { entity: 1, dx: 1, dy: 0 });
    expect(audio.unlocked).toBe(false);
    expect(audio.play({ id: 'sfx_ui_klick' })).toBe(false);
    expect(created()).toBe(0);
    gestures.dispatchEvent(new Event('keydown'));
    expect(audio.unlocked).toBe(true);
    expect(created()).toBe(1);
    expect(ctx.resumes).toBe(1);
    expect(ctx.state).toBe('running');
    gestures.dispatchEvent(new Event('pointerdown'));
    expect(created()).toBe(1);
    expect(ctx.resumes).toBe(1);
  });

  it('lässt alle Presets im Worker rendern, Schritte zuerst, und spielt mit dessen Puffern', () => {
    const { session, gestures, ctx, worker } = setup();
    gestures.dispatchEvent(new Event('pointerdown'));
    expect(worker.requests).toEqual([{ ids: SFX_PRESETS.map((p) => p.id) }]);
    expect(worker.requests[0]?.ids[0]).toMatch(/^sfx_schritt_/);
    worker.answer('sfx_spieler_rolle');
    const buffersFromWorker = ctx.buffers.length;
    expect(buffersFromWorker).toBeGreaterThan(0);
    session.emit('playerRolled', { entity: 1, dx: 1, dy: 0 });
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.buffers).toHaveLength(buffersFromWorker);
    // Not yet delivered: rendered on the spot.
    ctx.currentTime = 1;
    session.emit('playerStep', { entity: 1, terrain: 'gras', water: 'none', noise: 1 });
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.buffers.length).toBeGreaterThan(buffersFromWorker);
  });

  it('ohne Worker rendert es in Leerlauf-Scheiben, bis alles da ist', () => {
    const slices: Array<() => void> = [];
    const ctx = new FakeContext();
    const gestures = new EventTarget();
    attachAudio({ session: new FakeSession(), settings: createSettingsStore(null), gestureTarget: gestures, createContext: () => ctx, createWorker: null, schedule: (fn) => slices.push(fn) });
    gestures.dispatchEvent(new Event('touchend'));
    expect(slices).toHaveLength(1);
    expect(ctx.buffers).toHaveLength(0);
    // Two slices: a couple of presets each, and the next slice is scheduled while presets remain.
    slices.shift()?.();
    const afterOne = ctx.buffers.length;
    expect(afterOne).toBeGreaterThan(0);
    expect(slices).toHaveLength(1);
    slices.shift()?.();
    expect(ctx.buffers.length).toBeGreaterThan(afterOne);
    expect(slices).toHaveLength(1);
  });

  it('Sim-Ereignisse klingen; Welt-Klänge relativ zum Fokus der Sitzung', () => {
    const { session, gestures, ctx, audio } = setup();
    gestures.dispatchEvent(new Event('keydown'));
    session.focus = { x: 1000, y: 1000, layer: 0 };
    audio.frame();
    session.emit('harvestHit', { layer: 0, x: 1100, y: 1000, target: 'baum_eiche', action: 'faellen', material: 'holz', tooHard: false });
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.panners[0]?.pan.value).toBeGreaterThan(0);
    session.emit('harvestHit', { layer: 0, x: 90_000, y: 1000, target: 'baum_eiche', action: 'faellen', material: 'holz', tooHard: false });
    expect(ctx.sources).toHaveLength(1);
    session.emit('fearStageChanged', { entity: 1, stage: 'fluestern', previous: 'unruhig', value: 41 });
    expect((ctx.sources.at(-1) as FakeSource).loop).toBe(true);
  });

  it('Buspegel folgen den Einstellungen; Untertitel nur, wenn eingeschaltet', () => {
    const { session, settings, gestures, ctx, audio } = setup();
    gestures.dispatchEvent(new Event('keydown'));
    const texts: string[] = [];
    audio.onSubtitle((t) => texts.push(t.de));
    session.emit('inventoryFull', { item: 'stein', count: 1 });
    expect(texts).toEqual([]);
    settings.update({ audio: { subtitles: true, sfx: 0.5 } });
    ctx.currentTime = 5;
    session.emit('itemBroken', { item: 'steinaxt' });
    expect(texts).toEqual(['Etwas ist zerbrochen']);
    // Gains in the mixer's creation order: master, then the buses in `SFX_BUSES` order (effekte first).
    expect(SFX_BUSES[0]).toBe('effekte');
    const effekte = ctx.gains[1] as FakeGain;
    expect(effekte.gain.value).toBeCloseTo(0.25);
  });

  it('Pausemenü: Effekte und Umgebung verstummen, Schleifen bleiben, Musik und UI klingen weiter; Clip-Ereignisse der Figur klingen', () => {
    const { session, settings, gestures, ctx, audio } = setup();
    gestures.dispatchEvent(new Event('keydown'));
    session.emit('fearStageChanged', { entity: 1, stage: 'fluestern', previous: 'unruhig', value: 41 });
    const loops = ctx.sources.length;
    const bus = (name: string): FakeGain => ctx.gains[1 + SFX_BUSES.indexOf(name as (typeof SFX_BUSES)[number])] as FakeGain;
    const ui = bus('ui').gain.value;
    const musik = bus('musik').gain.value;
    audio.setPaused(true);
    expect(bus('effekte').gain.value).toBe(0);
    expect(bus('umgebung').gain.value).toBe(0);
    expect(bus('ui').gain.value).toBe(ui);
    expect(bus('musik').gain.value).toBe(musik);
    // Settings changed while paused keep the world silent.
    settings.update({ audio: { sfx: 0.8 } });
    expect(bus('effekte').gain.value).toBe(0);
    expect(ctx.sources).toHaveLength(loops);
    audio.setPaused(false);
    expect(bus('effekte').gain.value).toBeCloseTo(0.64);
    expect(bus('umgebung').gain.value).toBeGreaterThan(0);
    // Body clip events: a second-loop bite sounds, a footstep of the clip does not (the simulation voices it).
    audio.clipEvent('schritt', 3);
    expect(ctx.sources).toHaveLength(loops);
    audio.clipEvent('biss', 1);
    expect(ctx.sources).toHaveLength(loops + 1);
  });

  it('pausiert bei verstecktem Tab und hört nach dispose nichts mehr', () => {
    const { session, gestures, doc, ctx, audio } = setup();
    gestures.dispatchEvent(new Event('keydown'));
    doc.set(true);
    expect(ctx.state).toBe('suspended');
    doc.set(false);
    expect(ctx.state).toBe('running');
    audio.dispose();
    session.emit('playerRolled', { entity: 1, dx: 1, dy: 0 });
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.state).toBe('suspended');
    for (const list of session.handlers.values()) expect(list).toHaveLength(0);
  });
});
