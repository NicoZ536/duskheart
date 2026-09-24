/**
 * M3-33 Web-Audio-Graph (§27 "Master → Busse Musik, Effekte, Umgebung, UI; Kompressor/Limiter"): the
 * routing of every bus through compressor and limiter to the master fader, and the bus levels from the
 * audio settings (src/engine/settings.ts).
 */
import { describe, expect, it } from 'vitest';
import { AudioMixer, COMPRESSOR, LIMITER, busGains, sliderGain } from '../../../src/audio/mixer';
import { SFX_BUSES } from '../../../src/content/sfx/index';
import { defaultSettings } from '../../../src/engine/settings';
import { type FakeCompressor, FakeContext, type FakeGain, chainOf } from './fakeAudio';

describe('Mischpult', () => {
  it('führt jeden Bus über Kompressor und Limiter zum Master und zum Ausgang', () => {
    const ctx = new FakeContext();
    const mixer = new AudioMixer(ctx, busGains(defaultSettings().audio));
    for (const bus of SFX_BUSES) {
      expect(chainOf(mixer.bus[bus] as FakeGain)).toEqual(['gain', 'compressor', 'compressor', 'gain', 'destination']);
    }
    expect((mixer.compressor as FakeCompressor).outputs[0]).toBe(mixer.limiter);
    expect((mixer.limiter as FakeCompressor).outputs[0]).toBe(mixer.master);
    expect(mixer.compressor.ratio.value).toBe(COMPRESSOR.ratio);
    expect(mixer.compressor.threshold.value).toBe(COMPRESSOR.threshold);
    expect(mixer.limiter.ratio.value).toBe(LIMITER.ratio);
    expect(mixer.limiter.threshold.value).toBe(LIMITER.threshold);
    expect(mixer.limiter.attack.value).toBeLessThanOrEqual(0.001);
  });

  it('Buspegel folgen den Audio-Einstellungen (Musik, Effekte, Umgebung, UI, Master)', () => {
    const audio = { master: 0.5, music: 0.2, sfx: 1, ambience: 0, ui: 0.6 };
    const levels = busGains(audio);
    expect(levels.master).toBeCloseTo(0.25);
    expect(levels.bus).toEqual({ musik: sliderGain(0.2), effekte: 1, umgebung: 0, ui: sliderGain(0.6) });
    const ctx = new FakeContext();
    const mixer = new AudioMixer(ctx, levels);
    expect(mixer.master.gain.value).toBeCloseTo(0.25);
    expect(mixer.bus.umgebung.gain.value).toBe(0);
    ctx.currentTime = 3;
    mixer.apply(busGains({ ...audio, ambience: 1, master: 1 }));
    const amb = mixer.bus.umgebung.gain as FakeGain['gain'];
    expect(amb.calls.at(-1)).toEqual({ kind: 'target', value: 1, time: 3 });
    expect(mixer.master.gain.value).toBe(1);
  });

  it('Regler wirken quadratisch zwischen 0 und 1', () => {
    expect(sliderGain(0)).toBe(0);
    expect(sliderGain(1)).toBe(1);
    expect(sliderGain(0.5)).toBeCloseTo(0.25);
    expect(sliderGain(2)).toBe(1);
    expect(sliderGain(-1)).toBe(0);
  });
});
