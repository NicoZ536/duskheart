/**
 * M3-33 SFX playback: voices on the mixer buses, variation against repetition (another take each time,
 * pitch and volume spread), voice limits and lock-out, positioned sounds (range, pan, layers, following
 * the listener, occlusion), loops per slot, subtitles, buffers from the worker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioMixer, busGains } from '../../../src/audio/mixer';
import { MAX_VOICES, SfxPlayer, type SfxPlayerOptions } from '../../../src/audio/sfxPlayer';
import { renderTakes } from '../../../src/audio/dsp/render';
import { SFX_PRESETS, SFX_SAMPLE_RATE, dauerton, rauschen, schlag, sfxPresetSchema, ton, type SfxPreset, type SfxPresetInput } from '../../../src/content/sfx/index';
import { defaultSettings } from '../../../src/engine/settings';
import { TILE_PX } from '../../../src/world/model/coords';
import { type FakeBuffer, FakeContext, type FakeGain, type FakePanner, type FakeSource, chainOf } from './fakeAudio';

function preset(input: Partial<SfxPresetInput> & { id: string }): SfxPreset {
  return sfxPresetSchema.parse({ bus: 'effekte', lautstaerke: 0.5, schichten: [{ quelle: ton('sinus', 440), huelle: schlag(0.005, 0.1) }], ...input });
}

const STEP = preset({ id: 'sfx_test_schritt', varianten: 4, stimmen: 2, sperrzeit: 0.05, streuung: { tonhoehe: 100, lautstaerke: 3 }, reichweite: 10 });
const UI = preset({ id: 'sfx_test_klick', bus: 'ui', sperrzeit: 0 });
const WARN = preset({ id: 'sfx_test_warnung', untertitel: { de: 'Achtung', en: 'Beware' } });
const LOOP_A = preset({ id: 'sfx_test_feuer', bus: 'umgebung', schleife: { dauer: 1 }, schichten: [{ quelle: rauschen('rosa'), huelle: dauerton() }] });
const LOOP_B = preset({ id: 'sfx_test_atmen', schleife: { dauer: 1 }, schichten: [{ quelle: rauschen('braun'), huelle: dauerton() }] });
const ALL = [STEP, UI, WARN, LOOP_A, LOOP_B];

function setup(options: SfxPlayerOptions = {}): { ctx: FakeContext; mixer: AudioMixer; player: SfxPlayer } {
  const ctx = new FakeContext();
  const mixer = new AudioMixer(ctx, busGains(defaultSettings().audio));
  return { ctx, mixer, player: new SfxPlayer(ctx, mixer, ALL, { seed: 7, ...options }) };
}

afterEach(() => vi.restoreAllMocks());

describe('SFX-Wiedergabe', () => {
  it('spielt ein Preset auf seinem Bus; ohne Position ohne Panner', () => {
    const { ctx, mixer, player } = setup();
    expect(player.play({ id: 'sfx_test_klick' })).toBe(true);
    const src = ctx.sources[0] as FakeSource;
    expect(src.startedAt).toBe(0);
    expect(src.loop).toBe(false);
    expect((src.buffer as FakeBuffer).sampleRate).toBe(SFX_SAMPLE_RATE);
    const gain = src.outputs[0] as FakeGain;
    expect(gain.outputs[0]).toBe(mixer.bus.ui);
    expect(ctx.panners).toHaveLength(0);
    expect(player.activeVoices).toBe(1);
  });

  it('unbekannte Ids spielen nicht und melden sich einmal als Fehler', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { player } = setup();
    expect(player.play({ id: 'sfx_gibt_esnicht' })).toBe(false);
    expect(player.play({ id: 'sfx_gibt_esnicht' })).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('Varianten gegen Wiederholung: nie zweimal dieselbe Take hintereinander, Tonhöhe und Pegel streuen', () => {
    const { ctx, player } = setup();
    const buffers = player.prepare('sfx_test_schritt');
    expect(buffers).toHaveLength(4);
    let lastBuffer: unknown = null;
    const rates = new Set<number>();
    for (let i = 0; i < 40; i++) {
      ctx.currentTime += 0.1;
      expect(player.play({ id: 'sfx_test_schritt' })).toBe(true);
      const src = ctx.sources.at(-1) as FakeSource;
      expect(src.buffer).not.toBe(lastBuffer);
      lastBuffer = src.buffer;
      const rate = src.playbackRate.value;
      expect(rate).toBeGreaterThanOrEqual(2 ** (-100 / 1200) - 1e-9);
      expect(rate).toBeLessThanOrEqual(2 ** (100 / 1200) + 1e-9);
      rates.add(rate);
      const g = (src.outputs[0] as FakeGain).gain.value;
      expect(g).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(10 ** (-3 / 20) - 1e-9);
    }
    expect(rates.size).toBeGreaterThan(30);
    const used = new Set(ctx.sources.map((s) => s.buffer));
    expect(used.size).toBe(4);
  });

  it('Sperrzeit und Stimmenzahl: gleicher Tick spielt einmal, die älteste Stimme weicht', () => {
    const { ctx, player } = setup();
    expect(player.play({ id: 'sfx_test_schritt' })).toBe(true);
    expect(player.play({ id: 'sfx_test_schritt' })).toBe(false);
    ctx.currentTime = 0.06;
    expect(player.play({ id: 'sfx_test_schritt' })).toBe(true);
    ctx.currentTime = 0.12;
    expect(player.play({ id: 'sfx_test_schritt' })).toBe(true);
    const [first, second, third] = ctx.sources as [FakeSource, FakeSource, FakeSource];
    expect(first.stoppedAt).not.toBeNull();
    expect(second.stoppedAt).toBeNull();
    expect(third.stoppedAt).toBeNull();
    expect(player.activeVoices).toBe(2);
  });

  it(`höchstens ${MAX_VOICES} Stimmen insgesamt, die ältesten weichen`, () => {
    const ctx = new FakeContext();
    const many = ['sfx_test_viel_a', 'sfx_test_viel_b', 'sfx_test_viel_c'].map((id) => preset({ id, stimmen: 16, sperrzeit: 0 }));
    const player = new SfxPlayer(ctx, new AudioMixer(ctx, busGains(defaultSettings().audio)), many, { seed: 1 });
    for (const p of many) for (let k = 0; k < 16; k++) expect(player.play({ id: p.id })).toBe(true);
    expect(ctx.sources).toHaveLength(48);
    expect(player.activeVoices).toBe(MAX_VOICES);
    // The first 16 (all of preset a) were faded out, the newest keep sounding.
    expect(ctx.sources.slice(0, 16).every((s) => s.stoppedAt !== null)).toBe(true);
    expect(ctx.sources.slice(16).every((s) => s.stoppedAt === null)).toBe(true);
  });

  it('positionierte Klänge: außer Reichweite nicht gestartet, Panorama nach Seite, andere Ebene stumm', () => {
    const { ctx, mixer, player } = setup();
    player.setListener(1000, 1000, 0);
    expect(player.play({ id: 'sfx_test_schritt', x: 1000 + 11 * TILE_PX, y: 1000 })).toBe(false);
    ctx.currentTime = 1;
    expect(player.play({ id: 'sfx_test_schritt', x: 1000, y: 1000, layer: -1 })).toBe(false);
    ctx.currentTime = 2;
    expect(player.play({ id: 'sfx_test_schritt', x: 1000 - 4 * TILE_PX, y: 1000 })).toBe(true);
    const src = ctx.sources.at(-1) as FakeSource;
    expect(chainOf(src)).toEqual(['source', 'gain', 'panner', 'gain', 'compressor', 'compressor', 'gain', 'destination']);
    const panner = ctx.panners.at(-1) as FakePanner;
    expect(panner.pan.value).toBeLessThan(0);
    expect(panner.outputs[0]).toBe(mixer.bus.effekte);
  });

  it('positionierte Stimmen folgen dem Hörer; Verdeckung schließt den Tiefpass', () => {
    const occlusion = vi.fn(() => 1);
    const { ctx, player } = setup({ occlusion });
    player.setListener(0, 0, 0);
    player.play({ id: 'sfx_test_klick', x: 2 * TILE_PX, y: 0 });
    const filter = ctx.filters[0]!;
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBeLessThan(1000);
    const panner = ctx.panners[0]!;
    const before = panner.pan.value;
    expect(before).toBeGreaterThan(0);
    player.setListener(4 * TILE_PX, 0, 0);
    player.update();
    expect(panner.pan.value).toBeLessThan(0);
    expect(occlusion).toHaveBeenCalled();
  });

  it('Schleifen je Platz: gleiche Id bewegt nur, andere blendet über, null blendet aus', () => {
    const { ctx, player } = setup();
    player.setLoop('feuer', { id: 'sfx_test_feuer', x: 10, y: 10 });
    expect(ctx.sources).toHaveLength(1);
    const first = ctx.sources[0]!;
    expect(first.loop).toBe(true);
    expect(first.offset).toBeGreaterThanOrEqual(0);
    expect(first.offset).toBeLessThan(1);
    player.setLoop('feuer', { id: 'sfx_test_feuer', x: 30, y: 10 });
    expect(ctx.sources).toHaveLength(1);
    player.setLoop('feuer', { id: 'sfx_test_atmen' });
    expect(ctx.sources).toHaveLength(2);
    expect(first.stoppedAt).not.toBeNull();
    const second = ctx.sources[1]!;
    player.setLoop('feuer', null);
    expect(second.stoppedAt).not.toBeNull();
    first.end();
    second.end();
    expect(player.activeVoices).toBe(0);
    expect(first.disconnected).toBe(true);
  });

  it('Untertitel wichtiger Klänge gehen an den Rückruf', () => {
    const onSubtitle = vi.fn();
    const { player } = setup({ onSubtitle });
    player.play({ id: 'sfx_test_klick' });
    player.play({ id: 'sfx_test_warnung' });
    expect(onSubtitle).toHaveBeenCalledTimes(1);
    expect(onSubtitle.mock.calls[0]?.[0]).toEqual({ de: 'Achtung', en: 'Beware' });
  });

  it('übernimmt Takes aus dem Worker und rendert Fehlendes selbst', () => {
    const { ctx, player } = setup();
    const takes = renderTakes(STEP);
    player.provide('sfx_test_schritt', takes);
    expect(player.isPrepared('sfx_test_schritt')).toBe(true);
    expect((ctx.buffers[0] as FakeBuffer).data).toEqual(takes[0]);
    expect(ctx.buffers).toHaveLength(4);
    player.provide('sfx_test_schritt', takes);
    expect(ctx.buffers).toHaveLength(4);
    expect(player.warmUp(100)).toBe(0);
    expect(ctx.buffers.length).toBe(4 + 1 + 1 + 1 + 1);
  });

  it('spielt jedes Preset des Spiels', () => {
    const ctx = new FakeContext();
    const player = new SfxPlayer(ctx, new AudioMixer(ctx, busGains(defaultSettings().audio)), SFX_PRESETS, { seed: 3 });
    // The synthesis of every take is tested in render.test.ts; here short stand-in takes keep it quick.
    for (const p of SFX_PRESETS) player.provide(p.id, Array.from({ length: p.varianten }, () => new Float32Array(8)));
    for (const p of SFX_PRESETS) {
      if (p.schleife === undefined) expect(player.play({ id: p.id }), p.id).toBe(true);
      else player.setLoop(p.id, { id: p.id });
    }
    expect(ctx.sources).toHaveLength(SFX_PRESETS.length);
  });
});
