/**
 * M3-33 audio runtime: the autoplay unlock (no context before the first gesture), rendering in the SFX
 * worker, simulation events → voices, the listener following the session's focus (from the unlock on), bus volumes following
 * the settings, subtitles only while enabled, suspension while the page is hidden, clean disposal; the ambience plays only
 * what the worker delivered while it renders (its beds are seconds of sound – never rendered on the frame that needs them).
 */
import { describe, expect, it } from 'vitest';
import { arrivedAmbienceSink, attachAudio, type AudioSession, type SfxWorkerLike } from '../../../src/audio/runtime';
import { AudioMixer, busGains } from '../../../src/audio/mixer';
import { SfxPlayer } from '../../../src/audio/sfxPlayer';
import type { SfxRenderRequest, SfxRenderResult } from '../../../src/audio/sfxWorkerProtocol';
import { renderTakes, sfxSampleCount } from '../../../src/audio/dsp/render';
import { SFX_BUSES, SFX_PRESETS } from '../../../src/content/sfx/index';
import { createSettingsStore, defaultSettings } from '../../../src/engine/settings';
import type { SessionFocus } from '../../../src/game/session';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import { lightWorld } from '../game/licht-testwelt';
import { OFFSET, meadow } from '../game/spieler-testwelt';
import { FakeContext, type FakeGain, type FakeSource } from './fakeAudio';

class FakeSession implements AudioSession {
  readonly handlers = new Map<string, Array<(payload: never) => void>>();
  focus: SessionFocus = { x: 100, y: 200, layer: 0 };
  sim?: Simulation;
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

  it('der Hörer steht ab der entsperrenden Geste am Fokus: ein Ereignis vor dem nächsten Frame klingt beim Spieler', () => {
    const { session, gestures, ctx } = setup();
    // Far from the world's origin: a listener left at (0, 0) would hear nothing of it (out of range).
    session.focus = { x: 40_000, y: 60_000, layer: 0 };
    gestures.dispatchEvent(new Event('keydown'));
    session.emit('harvestHit', { layer: 0, x: 40_100, y: 60_000, target: 'baum_eiche', action: 'faellen', material: 'holz', tooHard: false });
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.panners[0]?.pan.value).toBeGreaterThan(0);
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

  it('Welt-Schleifen folgen dem Zustand der Simulation: ein brennendes Lagerfeuer knistert ab dem ersten Bild, ohne Ereignis', () => {
    const w = lightWorld(meadow(24, 24));
    w.spawn(10, 10);
    w.give('lagerfeuer', 1);
    w.give('holz', 10);
    const fire = w.place('lagerfeuer', 11, 10);
    w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('holz') }]);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    const { session, gestures, ctx, audio } = setup();
    session.sim = w.sim;
    session.focus = { ...w.pos(), layer: 0 };
    gestures.dispatchEvent(new Event('keydown'));
    audio.frame();
    const loop = ctx.sources.find((src) => src.loop);
    expect(loop).toBeDefined();
    expect(ctx.panners.length).toBeGreaterThan(0);
    // Doused: the next frame after the event lets the crackle fade out.
    w.step(1, [{ type: 'light.douse', light: fire }]);
    session.emit('lightExtinguished', { light: fire, kind: 'lagerfeuer', reason: 'schalter', layer: 0, x: 0, y: 0 });
    audio.frame();
    expect(loop?.stoppedAt).not.toBeNull();
  });

  it('Brennstoff klingt nach der Art des Lichts, gelesen an der Simulation der Sitzung: Harz in der Lampe, Holz auf dem Feuer', () => {
    const w = lightWorld(meadow(24, 24));
    w.spawn(10, 10);
    const lamp = w.light.placeFurniture(w.sim, 'harzlampe', 0, OFFSET + 11, OFFSET + 10);
    expect(lamp).not.toBeNull();
    const { session, gestures, ctx, audio } = setup();
    session.sim = w.sim;
    session.focus = { ...w.pos(), layer: 0 };
    gestures.dispatchEvent(new Event('keydown'));
    audio.frame();
    const samples = (id: string): number => {
      const p = SFX_PRESETS.find((q) => q.id === id);
      if (p === undefined) throw new Error(id);
      return sfxSampleCount(p);
    };
    expect(samples('sfx_item_holz')).not.toBe(samples('sfx_feuer_nachlegen'));
    const at = { x: w.pos().x, y: w.pos().y, layer: 0 };
    session.emit('fireFueled', { light: lamp ?? 0, item: 'harz', count: 1, fuelSeconds: 21600, ...at });
    expect((ctx.sources.at(-1) as FakeSource).buffer?.length).toBe(samples('sfx_item_holz'));
    // A light the simulation does not know (or a camp fire): a log onto the embers.
    session.emit('fireFueled', { light: 9999, item: 'holz', count: 2, fuelSeconds: 90, ...at });
    expect((ctx.sources.at(-1) as FakeSource).buffer?.length).toBe(samples('sfx_feuer_nachlegen'));
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

describe('Umgebung beim Rendern im Worker', () => {
  const BED = 'sfx_umgebung_laub';
  const CALL = 'sfx_umgebung_vogel_amsel';
  const samplesOf = (id: string): number => sfxSampleCount(SFX_PRESETS.find((p) => p.id === id) as (typeof SFX_PRESETS)[number]);
  function player(): { ctx: FakeContext; player: SfxPlayer } {
    const ctx = new FakeContext();
    return { ctx, player: new SfxPlayer(ctx, new AudioMixer(ctx, busGains(defaultSettings().audio)), SFX_PRESETS, { seed: 2 }) };
  }

  it('ein Bett wartet auf die Puffer des Workers und startet mit ihnen; ein Ruf davor fällt aus; nichts wird im Frame gerendert', () => {
    const { ctx, player: p } = player();
    const sink = arrivedAmbienceSink(
      () => p,
      () => true,
    );
    sink.setLoop('bett_0', { id: BED, volume: 1 });
    expect(sink.play({ id: CALL, volume: 1 })).toBe(false);
    expect(ctx.buffers).toHaveLength(0);
    expect(ctx.sources).toHaveLength(0);
    expect(p.isPrepared(BED)).toBe(false);
    // The worker delivers the bed: the director's next update starts it from the delivered takes (no render of its own).
    const takes = renderTakes(SFX_PRESETS.find((s) => s.id === BED) as (typeof SFX_PRESETS)[number]);
    p.provide(BED, takes);
    const delivered = ctx.buffers.length;
    expect(delivered).toBe(takes.length);
    sink.setLoop('bett_0', { id: BED, volume: 1 });
    expect(ctx.buffers).toHaveLength(delivered);
    const bed = ctx.sources.at(-1) as FakeSource;
    expect(bed.loop).toBe(true);
    expect(bed.buffer?.length).toBe(samplesOf(BED));
    // A stop always reaches the player.
    sink.setLoop('bett_0', null);
    expect(bed.stoppedAt).not.toBeNull();
  });

  it('ohne Worker (Leerlauf-Scheiben) und ohne Spieler: alles wie bisher', () => {
    const { ctx, player: p } = player();
    const idle = arrivedAmbienceSink(
      () => p,
      () => false,
    );
    idle.setLoop('bett_0', { id: BED, volume: 1 });
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]?.buffer?.length).toBe(samplesOf(BED));
    const none = arrivedAmbienceSink(
      () => null,
      () => true,
    );
    none.setLoop('bett_0', { id: BED, volume: 1 });
    expect(none.play({ id: CALL, volume: 1 })).toBe(false);
  });
});
