/**
 * M7-78 (MASTERPROMPT §30 „keine Allokationen in Hot-Loops“; docs/SPIEL.md §24 „Umgebung“): the ambience works only when
 * something is due. The probe counts the reads that changed what the loops play (`AmbienceState.revision`); the director lays
 * its loops out after such a change – at most every `UPDATE_SECONDS` – and names the next moment it has work without a new
 * read (`nextDue`: a pending layout, the next call, far lightning or thunder). A loop the sink held back until its takes
 * arrived (`ArrivedAmbienceSink.deferred`) is laid out again (`relayout`). The audio frame (src/audio/runtime.ts) runs the
 * director only on a new revision or at `nextDue`.
 */
import { describe, expect, it } from 'vitest';
import { AmbienceDirector, UPDATE_SECONDS, type AmbienceSink } from '../../../src/audio/ambience/director';
import { AmbienceProbe, createAmbienceState, type AmbienceState } from '../../../src/audio/ambience/probe';
import { arrivedAmbienceSink } from '../../../src/audio/runtime';
import { AudioMixer, busGains } from '../../../src/audio/mixer';
import { defaultSettings } from '../../../src/engine/settings';
import { SfxPlayer, type SfxCue } from '../../../src/audio/sfxPlayer';
import { SFX_PRESETS } from '../../../src/content/sfx/index';
import { FakeContext } from './fakeAudio';

/** Counts what the director sends. */
class CountingSink implements AmbienceSink {
  loopsSet = 0;
  readonly loops = new Map<string, string>();
  setLoop(slot: string, cue: SfxCue | null): void {
    this.loopsSet++;
    if (cue === null) this.loops.delete(slot);
    else this.loops.set(slot, cue.id);
  }
  play(): boolean {
    return true;
  }
}

const LISTENER = { x: 5000, y: 7000, layer: 0 };

/** A state as the probe keeps it: revision > 0. */
function kept(revision: number, patch: Partial<AmbienceState> = {}): AmbienceState {
  return Object.assign(createAmbienceState(), { active: true, biome: 'salzkueste', season: 'sommer', revision }, patch);
}

describe('Umgebung nur, wenn etwas fällig ist (M7-78)', () => {
  it('Loops nach einer Änderung (Revision), höchstens alle UPDATE_SECONDS; ohne Änderung kein setLoop', () => {
    const d = new AmbienceDirector(7);
    const sink = new CountingSink();
    const clock = { now: 0 };
    const s = kept(1);
    d.update(s, LISTENER, clock, sink);
    expect(sink.loops.get('umgebung_bett_0')).toBe('sfx_umgebung_brandung');
    const first = sink.loopsSet;
    // The same revision for ten seconds of frames: no loop set again.
    for (let i = 0; i < 600; i++) {
      clock.now += 1 / 60;
      d.update(s, LISTENER, clock, sink);
    }
    expect(sink.loopsSet).toBe(first);
    // A new revision (rain): laid out at once – the last layout lies more than UPDATE_SECONDS back.
    s.revision = 2;
    s.rain = true;
    s.precipitation = 0.65;
    d.update(s, LISTENER, clock, sink);
    expect(sink.loops.get('wetter_regen')).toBe('sfx_umgebung_regen');
    const second = sink.loopsSet;
    // Another change right after: pending until the next UPDATE_SECONDS mark, which `nextDue` names.
    clock.now += 1 / 60;
    s.revision = 3;
    s.precipitation = 0.3;
    d.update(s, LISTENER, clock, sink);
    expect(sink.loopsSet).toBe(second);
    expect(d.nextDue).toBeCloseTo(clock.now - 1 / 60 + UPDATE_SECONDS, 9);
    clock.now = d.nextDue;
    d.update(s, LISTENER, clock, sink);
    expect(sink.loopsSet).toBeGreaterThan(second);
  });

  it('ein von Hand gefüllter Zustand (Revision 0) legt wie bisher alle UPDATE_SECONDS aus', () => {
    const d = new AmbienceDirector(7);
    const sink = new CountingSink();
    const clock = { now: 0 };
    const s = kept(0);
    d.update(s, LISTENER, clock, sink);
    const first = sink.loopsSet;
    clock.now = UPDATE_SECONDS + 0.001;
    d.update(s, LISTENER, clock, sink);
    expect(sink.loopsSet).toBeGreaterThan(first);
  });

  it('nextDue nennt den nächsten Ruf; inaktiv ist nichts fällig; relayout legt ohne Änderung neu aus', () => {
    const d = new AmbienceDirector(11);
    const sink = new CountingSink();
    const clock = { now: 0 };
    // Grünhain by day: birds call every 3–9 s.
    const s = kept(1, { biome: 'gruenhain' });
    d.update(s, LISTENER, clock, sink);
    expect(d.nextDue).toBeGreaterThanOrEqual(3);
    expect(d.nextDue).toBeLessThanOrEqual(9);
    const laid = sink.loopsSet;
    d.relayout();
    expect(d.appliedRevision).toBe(-1);
    clock.now = 1;
    d.update(s, LISTENER, clock, sink);
    expect(sink.loopsSet).toBeGreaterThan(laid);
    d.update(kept(2, { active: false }), LISTENER, clock, sink);
    expect(d.nextDue).toBe(Number.POSITIVE_INFINITY);
    expect(sink.loops.size).toBe(0);
  });

  it('die Sonde zählt nur Lesungen, die ändern, was die Loops spielen', () => {
    const probe = new AmbienceProbe();
    const out = createAmbienceState();
    probe.read(undefined, out, false);
    expect(out.revision).toBe(0);
    probe.read(undefined, out, false);
    expect(out.revision).toBe(0);
  });

  it('der Sink markiert einen zurückgehaltenen Loop (deferred); ohne Worker nie', () => {
    const ctx = new FakeContext();
    const player = new SfxPlayer(ctx, new AudioMixer(ctx, busGains(defaultSettings().audio)), SFX_PRESETS);
    let workerRenders = true;
    const sink = arrivedAmbienceSink(
      () => player,
      () => workerRenders,
    );
    sink.setLoop('umgebung_bett_0', { id: 'sfx_umgebung_brandung', volume: 1 });
    expect(sink.deferred).toBe(true);
    sink.deferred = false;
    workerRenders = false;
    sink.setLoop('umgebung_bett_0', { id: 'sfx_umgebung_brandung', volume: 1 });
    expect(sink.deferred).toBe(false);
  });
});
