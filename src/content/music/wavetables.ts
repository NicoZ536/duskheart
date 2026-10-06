/**
 * Wavetables of the music and the SFX (collection `wavetables`, docs/SPIEL.md §24 "neue Quelle wavetable (Tabellen im
 * Content)"): one cycle each, a power of two long, peak 1 – the "samples" of the 16-bit sound: a soft flute, a vowel "ah"
 * for the choir pad, drawbar organ, a lute's bright pluck, a mellow horn, a glassy bell, a reed for the accordion of the
 * base theme. Written as sums of harmonics (`harmonics`), rounded to four decimals.
 */
import { harmonics } from './compose';
import type { WavetableInput } from './schema';

export const WAVETABLES: readonly WavetableInput[] = [
  // Flute: almost a sine, a breath of the second and third harmonic.
  { id: 'floete', werte: harmonics(64, [1, 0.12, 0.06, 0.02]) },
  // Choir "ah": a formant around the 3rd–5th harmonic over a soft fundamental.
  { id: 'chor', werte: harmonics(64, [0.7, 0.45, 0.6, 0.55, 0.35, 0.15, 0.08, 0.05], [0, 0.1, 0.25, 0.4, 0.05, 0.3, 0.2, 0.1]) },
  // Drawbar organ: 16', 8', 5 1/3', 4', 2 2/3', 2'.
  { id: 'orgel', werte: harmonics(64, [1, 0.8, 0.55, 0.45, 0, 0.3, 0, 0.2]) },
  // Lute: bright, the second and third harmonic strong, the rest falling off.
  { id: 'laute', werte: harmonics(64, [0.8, 0.7, 0.55, 0.3, 0.22, 0.12, 0.08, 0.05, 0.03], [0, 0.05, 0.12, 0.2, 0.3, 0.1, 0.4, 0.25, 0.15]) },
  // Horn: rich, mellow, the odd harmonics a little stronger.
  { id: 'horn', werte: harmonics(64, [1, 0.55, 0.5, 0.3, 0.28, 0.16, 0.12, 0.07, 0.05, 0.03]) },
  // Glass: fundamental with an inharmonic shimmer folded into the cycle (the 3rd and 7th).
  { id: 'glas', werte: harmonics(32, [1, 0, 0.35, 0, 0, 0, 0.18]) },
  // Reed (accordion): square-like, odd harmonics, a little of the even ones.
  { id: 'zunge', werte: harmonics(64, [1, 0.15, 0.45, 0.1, 0.3, 0.08, 0.2, 0.05, 0.12]) },
];
