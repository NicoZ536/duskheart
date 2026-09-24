/**
 * M3-33: the SFX synthesis in Node (the same code the browser runs, so presets are unit-testable). Every
 * take of every preset renders to finite samples with the right length, a peak ≤ 1 and the loudness its
 * `lautstaerke` asks for; renders are deterministic; takes differ; loops close without a seam; the
 * building blocks (envelope, filters, noise colours) behave as specified.
 */
import { describe, expect, it } from 'vitest';
import { LOUDNESS_AT_FULL, PEAK_CEILING, envelopeAt, renderSfx, renderTakes, sfxSampleCount, shortTermLoudness } from '../../../src/audio/dsp/render';
import { biquadGainAt, createBiquad, processBiquad, setBiquad } from '../../../src/audio/dsp/biquad';
import { SFX_GROUPS, SFX_SAMPLE_RATE, rauschen, schlag, sfxPresetSchema, tiefpass, ton, type SfxPreset, type SfxPresetInput } from '../../../src/content/sfx/index';

/** Mean |x[i] − x[i−1]| of a buffer (how much a sample typically moves). */
function meanStep(s: Float32Array): number {
  let sum = 0;
  for (let i = 1; i < s.length; i++) sum += Math.abs(s[i]! - s[i - 1]!);
  return sum / Math.max(1, s.length - 1);
}

function preset(input: SfxPresetInput): SfxPreset {
  return sfxPresetSchema.parse(input);
}

describe.each(Object.entries(SFX_GROUPS))('SFX-Synthese: Gruppe %s', (_group, presets) => {
  it.each(presets.map((p) => [p.id, p] as const))('%s: endlich, Spitze ≤ 1, Länge, Lautheit, kein Gleichanteil', (_id, p) => {
    const takes = renderTakes(p);
    expect(takes).toHaveLength(p.varianten);
    for (const s of takes) {
      expect(s.length).toBe(sfxSampleCount(p));
      let peak = 0;
      let sum = 0;
      let nonFinite = 0;
      for (let i = 0; i < s.length; i++) {
        const v = s[i]!;
        if (!Number.isFinite(v)) nonFinite++;
        peak = Math.max(peak, Math.abs(v));
        sum += v;
      }
      expect(nonFinite).toBe(0);
      expect(peak).toBeLessThanOrEqual(PEAK_CEILING + 1e-6);
      // Loud as asked, unless the peak ceiling holds it back – never silent.
      const loudness = shortTermLoudness(s, SFX_SAMPLE_RATE);
      const target = p.lautstaerke * LOUDNESS_AT_FULL;
      if (peak < PEAK_CEILING - 1e-3) expect(loudness).toBeCloseTo(target, 3);
      else expect(loudness).toBeGreaterThan(target * 0.25);
      expect(Math.abs(sum / s.length)).toBeLessThan(0.01);
      if (p.schleife === undefined) {
        // One-shots start and end at silence (edge fades): no click.
        expect(s[0]).toBe(0);
        expect(Math.abs(s[s.length - 1]!)).toBeLessThan(1e-3);
      } else {
        // The loop closes: the jump from the last sample to the first is an ordinary step.
        const seam = Math.abs(s[0]! - s[s.length - 1]!);
        expect(seam).toBeLessThan(Math.max(8 * meanStep(s), 0.02));
      }
    }
    if (p.varianten > 1) {
      const [a, b] = takes;
      expect(a).not.toEqual(b);
    }
  });
});

describe('SFX-Synthese: Grundlagen', () => {
  const beep = preset({ id: 'sfx_test_piep', bus: 'ui', lautstaerke: 0.5, varianten: 3, streuung: { klang: 0.1 }, schichten: [{ quelle: ton('rechteck', 440, 660), huelle: schlag(0.005, 0.2) }, { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.05), filter: tiefpass(2000) }] });

  it('ist deterministisch: gleiche Take, gleiche Samples', () => {
    expect(renderSfx(beep, { variant: 1 })).toEqual(renderSfx(beep, { variant: 1 }));
    expect(renderSfx(beep, { variant: 0 })).not.toEqual(renderSfx(beep, { variant: 2 }));
  });

  it('rendert in jeder Abtastrate die richtige Länge', () => {
    expect(renderSfx(beep, { sampleRate: 48000 }).length).toBe(Math.round(0.205 * 48000));
    expect(renderSfx(beep).length).toBe(Math.round(0.205 * SFX_SAMPLE_RATE));
  });

  it('Hüllkurve: Anstieg, Abfall auf den Haltepegel, Halten, Ausklang', () => {
    const e = { anschlag: 0.1, abfall: 0.2, halten: 0.5, haltezeit: 0.3, ausklang: 0.4, kurve: 1 };
    expect(envelopeAt(e, 0)).toBe(0);
    expect(envelopeAt(e, 0.05)).toBeCloseTo(0.5);
    expect(envelopeAt(e, 0.1)).toBeCloseTo(1);
    expect(envelopeAt(e, 0.2)).toBeCloseTo(0.75);
    expect(envelopeAt(e, 0.45)).toBeCloseTo(0.5);
    expect(envelopeAt(e, 0.8)).toBeCloseTo(0.25);
    expect(envelopeAt(e, 1.0)).toBeCloseTo(0, 9);
    expect(envelopeAt(e, 1.01)).toBe(0);
    expect(envelopeAt({ ...e, kurve: 3 }, 0.2)).toBeCloseTo(0.5 + 0.5 * 0.125);
  });

  it('Filter: Tiefpass dämpft Höhen, Hochpass Tiefen, Bandpass beide Seiten', () => {
    const f = createBiquad();
    setBiquad(f, 'tiefpass', 1000, 0.707, SFX_SAMPLE_RATE);
    expect(biquadGainAt(f, 100, SFX_SAMPLE_RATE)).toBeCloseTo(1, 1);
    expect(biquadGainAt(f, 1000, SFX_SAMPLE_RATE)).toBeCloseTo(Math.SQRT1_2, 1);
    expect(biquadGainAt(f, 8000, SFX_SAMPLE_RATE)).toBeLessThan(0.05);
    setBiquad(f, 'hochpass', 1000, 0.707, SFX_SAMPLE_RATE);
    expect(biquadGainAt(f, 100, SFX_SAMPLE_RATE)).toBeLessThan(0.02);
    expect(biquadGainAt(f, 8000, SFX_SAMPLE_RATE)).toBeCloseTo(1, 1);
    setBiquad(f, 'bandpass', 1000, 4, SFX_SAMPLE_RATE);
    expect(biquadGainAt(f, 1000, SFX_SAMPLE_RATE)).toBeCloseTo(1, 2);
    expect(biquadGainAt(f, 250, SFX_SAMPLE_RATE)).toBeLessThan(0.1);
    expect(biquadGainAt(f, 4000, SFX_SAMPLE_RATE)).toBeLessThan(0.1);
    // Processing matches the response: a 100 Hz sine passes a 1 kHz low-pass unchanged in level.
    setBiquad(f, 'tiefpass', 1000, 0.707, SFX_SAMPLE_RATE);
    let peak = 0;
    for (let i = 0; i < SFX_SAMPLE_RATE; i++) {
      const y = processBiquad(f, Math.sin((2 * Math.PI * 100 * i) / SFX_SAMPLE_RATE));
      if (i > SFX_SAMPLE_RATE / 2) peak = Math.max(peak, Math.abs(y));
    }
    expect(peak).toBeCloseTo(1, 1);
  });

  it('Rauschfarben: rosa und braun tragen mehr Tiefen als weiß', () => {
    const lowShare = (farbe: 'weiss' | 'rosa' | 'braun'): number => {
      const s = renderSfx(preset({ id: 'sfx_test_rauschen', bus: 'effekte', lautstaerke: 0.5, schichten: [{ quelle: rauschen(farbe), huelle: { anschlag: 0.01, abfall: 0, halten: 1, haltezeit: 1, ausklang: 0.01, kurve: 1 } }] }));
      const f = createBiquad();
      setBiquad(f, 'tiefpass', 500, 0.707, SFX_SAMPLE_RATE);
      let low = 0;
      let all = 0;
      for (const v of s) {
        const y = processBiquad(f, v);
        low += y * y;
        all += v * v;
      }
      return low / all;
    };
    const white = lowShare('weiss');
    const pink = lowShare('rosa');
    const brown = lowShare('braun');
    expect(white).toBeLessThan(0.1);
    expect(pink).toBeGreaterThan(white * 2);
    expect(brown).toBeGreaterThan(pink);
  });

  it('Wiederholung verschiebt Pegel und Tonhöhe je Durchgang', () => {
    const p = preset({ id: 'sfx_test_arpeggio', bus: 'ui', lautstaerke: 0.5, schichten: [{ quelle: ton('sinus', 400), huelle: schlag(0.001, 0.1, 1), wiederholung: { anzahl: 3, abstand: 0.2, abfall: 0.5, tonhoehe: 2 } }] });
    const s = renderSfx(p);
    const peakIn = (from: number, to: number): number => {
      let m = 0;
      for (let i = Math.round(from * SFX_SAMPLE_RATE); i < Math.round(to * SFX_SAMPLE_RATE); i++) m = Math.max(m, Math.abs(s[i]!));
      return m;
    };
    const crossings = (from: number, to: number): number => {
      let n = 0;
      for (let i = Math.round(from * SFX_SAMPLE_RATE) + 1; i < Math.round(to * SFX_SAMPLE_RATE); i++) if (s[i - 1]! < 0 !== s[i]! < 0) n++;
      return n;
    };
    expect(peakIn(0.2, 0.3) / peakIn(0, 0.1)).toBeCloseTo(0.5, 1);
    expect(peakIn(0.4, 0.5) / peakIn(0, 0.1)).toBeCloseTo(0.25, 1);
    expect(crossings(0.2, 0.25) / crossings(0, 0.05)).toBeCloseTo(2, 0);
  });
});
