/**
 * M6-81: Die Render-Bench misst jedes Fenster erst nach einem verworfenen Frame (tools/bench/render.ts `benchCalls`).
 * `benchRender` startet die Uhr des eingefrorenen Szenarios mit jedem Aufruf neu: der erste Frame eines Fensters springt um
 * die Länge des Fensters davor zurück, und die GPU-Partikel starten neu – ihr Vorlauf von fünf Sekunden in einem Frame
 * (`partikel-20000`: 8–15 ms Render-Vorbereitung, 40 statt 31 Draw-Calls), Arbeit, die kein eingeschwungener Frame hat.
 * Der verworfene Frame nimmt den Sprung; gemessen wird der eingeschwungene Frame-Pfad (§30).
 */
import { describe, expect, it } from 'vitest';
import { benchCalls, RENDER_SCENARIOS } from '../../../tools/bench/render';
import { RESET_GAP_S } from '../../../src/render/particles/system';

/** Presentation step of `benchRender` (src/debug/boot.tsx `BENCH_FRAME_SECONDS`: 60 Hz). */
const BENCH_FRAME_SECONDS = 1 / 60;

describe('Aufrufe der Render-Bench', () => {
  it('erst das Aufwärmen, dann vor jedem gemessenen Fenster ein verworfener Frame', () => {
    for (const s of RENDER_SCENARIOS) {
      const calls = benchCalls(s.frames);
      expect(calls[0], s.name).toEqual({ frames: 120, measured: false });
      const windows = calls.slice(1);
      expect(windows, s.name).toHaveLength(6);
      windows.forEach((c, i) => expect(c, `${s.name} Aufruf ${i + 1}`).toEqual(i % 2 === 0 ? { frames: 1, measured: false } : { frames: s.frames, measured: true }));
    }
  });

  it('ohne den verworfenen Frame begänne jedes Fenster mit einem Neustart der Partikel', () => {
    // The clock steps back by a window's length at the start of the next call – more than the particle system takes
    // without starting over (a jump back always starts it over; so does a gap beyond RESET_GAP_S).
    for (const s of RENDER_SCENARIOS) expect(s.frames * BENCH_FRAME_SECONDS, s.name).toBeGreaterThan(RESET_GAP_S);
  });
});
