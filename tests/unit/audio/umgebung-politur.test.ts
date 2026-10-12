/**
 * M7-61 Klangbett des ersten Bioms (MASTERPROMPT §27 "Biom-Klangbetten (Vögel tags, Grillen nachts, Wind …)"):
 *
 * - Grünhain bei Tag: Laub und Singvögel, dazwischen trommelt ab und zu ein Specht (etwa jeder siebte Ruf); nachts antworten
 *   Eule und Frösche einander über den Grillen.
 * - Salzküste bei Tag: Brandung mit einer leichten Seebrise darunter („hell und luftig“, docs/ART.md §5); nachts ruft der
 *   Brachvogel über dem Strand.
 * - Die neuen Rufe klingen wie gemeint: der Specht als schnelle Folge von Schlägen, der Frosch als zwei bis drei tiefe
 *   Quaker, der Brachvogel als steigender Pfiff.
 */
import { describe, expect, it } from 'vitest';
import { AMBIENCE_BEDS, AmbienceDirector, bedFor, type AmbienceSink } from '../../../src/audio/ambience/director';
import { createAmbienceState, type AmbienceState } from '../../../src/audio/ambience/probe';
import { renderSfx } from '../../../src/audio/dsp/render';
import type { SfxCue } from '../../../src/audio/sfxPlayer';
import { SFX_PRESETS, type SfxPreset } from '../../../src/content/sfx/index';

const RATE = 22050;

function preset(id: string): SfxPreset {
  const p = SFX_PRESETS.find((x) => x.id === id);
  if (p === undefined) throw new Error(`Preset ${id} fehlt`);
  return p;
}

function state(patch: Partial<AmbienceState>): AmbienceState {
  return Object.assign(createAmbienceState(), { active: true, biome: 'gruenhain', season: 'sommer' }, patch);
}

class Sink implements AmbienceSink {
  readonly loops = new Map<string, SfxCue>();
  readonly played: SfxCue[] = [];
  setLoop(slot: string, cue: SfxCue | null): void {
    if (cue === null) this.loops.delete(slot);
    else this.loops.set(slot, { ...cue });
  }
  play(cue: SfxCue): boolean {
    this.played.push({ ...cue });
    return true;
  }
}

function run(s: AmbienceState, seconds: number, seed = 7): Sink {
  const d = new AmbienceDirector(seed);
  const sink = new Sink();
  for (let t = 0; t < seconds; t += 1 / 30) d.update(s, { x: 4000, y: 4000, layer: 0 }, { now: t }, sink);
  return sink;
}

/** Envelope onsets: times where the 5-ms RMS rises above `threshold` × peak after having been below half of it. */
function onsets(samples: Float32Array, threshold = 0.4): number[] {
  const win = Math.round(RATE * 0.005);
  const rms: number[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let e = 0;
    for (let k = i; k < i + win; k++) e += (samples[k] as number) ** 2;
    rms.push(Math.sqrt(e / win));
  }
  const peak = Math.max(...rms);
  const out: number[] = [];
  let armed = true;
  rms.forEach((v, i) => {
    if (armed && v > threshold * peak) {
      out.push((i * win) / RATE);
      armed = false;
    } else if (v < (threshold / 2) * peak) armed = true;
  });
  return out;
}

/** Zero crossings per second in [from, to) seconds (a pitch estimate for a pure tone). */
function crossingRate(samples: Float32Array, from: number, to: number): number {
  let n = 0;
  const a = Math.round(from * RATE);
  const b = Math.min(samples.length, Math.round(to * RATE));
  for (let i = a + 1; i < b; i++) if (((samples[i - 1] as number) < 0) !== ((samples[i] as number) < 0)) n++;
  return n / (2 * (to - from));
}

describe('M7-61: Klangbett Grünhain und Salzküste', () => {
  it('Grünhain: am Tag Singvögel und etwa jeder siebte Ruf ein Specht, nachts Eule und Frösche über den Grillen', () => {
    const day = AMBIENCE_BEDS.gruenhain?.tag;
    expect(day?.rufe.filter((r) => r === 'sfx_umgebung_vogel_specht')).toHaveLength(1);
    expect(day?.rufe).toHaveLength(7);
    const night = bedFor(state({ night: true }));
    expect(night.betten.map((b) => b.id)).toEqual(['sfx_umgebung_grillen']);
    expect([...night.rufe].sort()).toEqual(['sfx_umgebung_eule', 'sfx_umgebung_frosch']);
    // Ten minutes of a summer night: both callers come, frogs about as often as the owl.
    const calls = run(state({ night: true }), 600).played;
    const frogs = calls.filter((c) => c.id === 'sfx_umgebung_frosch').length;
    const owls = calls.filter((c) => c.id === 'sfx_umgebung_eule').length;
    expect(frogs).toBeGreaterThan(5);
    expect(owls).toBeGreaterThan(5);
    // Ten minutes of a summer day: the woodpecker drums now and then, the songbirds carry the day.
    const dayCalls = run(state({}), 600).played;
    const woodpecker = dayCalls.filter((c) => c.id === 'sfx_umgebung_vogel_specht').length;
    expect(woodpecker).toBeGreaterThan(3);
    expect(woodpecker).toBeLessThan(dayCalls.length / 4);
  });

  it('Salzküste: Brandung mit Seebrise am Tag, nachts der Brachvogel; im Regen schweigt er', () => {
    const daySink = run(state({ biome: 'salzkueste' }), 2);
    expect([...daySink.loops.values()].map((c) => c.id).sort()).toEqual(['sfx_umgebung_brandung', 'sfx_umgebung_wind']);
    const breeze = [...daySink.loops.values()].find((c) => c.id === 'sfx_umgebung_wind');
    expect(breeze?.volume).toBeLessThan(0.5);
    const night = run(state({ biome: 'salzkueste', night: true }), 600);
    expect([...night.loops.values()].map((c) => c.id)).toEqual(['sfx_umgebung_brandung']);
    expect(night.played.length).toBeGreaterThan(5);
    expect(night.played.every((c) => c.id === 'sfx_umgebung_brachvogel')).toBe(true);
    expect(run(state({ biome: 'salzkueste', night: true, weather: 'regen', rain: true, precipitation: 0.65 }), 300).played).toEqual([]);
  });

  it('die neuen Rufe: Specht als Trommelwirbel, Frosch als zwei bis drei Quaker, Brachvogel als steigender Pfiff', () => {
    for (const id of ['sfx_umgebung_vogel_specht', 'sfx_umgebung_frosch', 'sfx_umgebung_brachvogel']) {
      const p = preset(id);
      expect(p.bus, id).toBe('umgebung');
      expect(p.schleife, id).toBeUndefined();
    }
    const drum = renderSfx(preset('sfx_umgebung_vogel_specht'), { sampleRate: RATE });
    const knocks = onsets(drum, 0.3);
    expect(knocks.length).toBeGreaterThanOrEqual(10);
    // A roll, not a beat: the knocks follow each other within a tenth of a second.
    for (let i = 1; i < knocks.length; i++) expect((knocks[i] as number) - (knocks[i - 1] as number)).toBeLessThan(0.1);
    const croak = renderSfx(preset('sfx_umgebung_frosch'), { sampleRate: RATE });
    const croaks = onsets(croak, 0.35);
    expect(croaks.length).toBeGreaterThanOrEqual(2);
    expect(croaks.length).toBeLessThanOrEqual(3);
    const curlew = renderSfx(preset('sfx_umgebung_brachvogel'), { sampleRate: RATE });
    // Each "cour-lee" rises: the end of the first call (0,22–0,30 s) lies higher than its start (0,02–0,10 s), and the second
    // call repeats it a little higher.
    expect(crossingRate(curlew, 0.22, 0.3)).toBeGreaterThan(crossingRate(curlew, 0.02, 0.1) * 1.15);
    expect(crossingRate(curlew, 0.78, 0.86)).toBeGreaterThan(crossingRate(curlew, 0.58, 0.66) * 1.15);
  });
});
