/**
 * Resonant biquad filters (RBJ "Audio EQ Cookbook") for the SFX synthesis: low-pass, high-pass and
 * band-pass (constant 0 dB peak). Coefficients live in a small mutable record so a cutoff sweep can
 * recompute them in place without allocating; the state is transposed direct form II.
 */
import type { SfxFilterType } from '../../content/sfx/schema';

/** Lowest cutoff [Hz]. */
const MIN_CUTOFF_HZ = 20;
/** Highest cutoff as a fraction of the sample rate (below Nyquist, where the formulas break down). */
const MAX_CUTOFF_FRACTION = 0.45;

/** Normalised coefficients (a0 = 1) plus the filter's two state values. */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  z1: number;
  z2: number;
}

/** A pass-through biquad with cleared state. */
export function createBiquad(): Biquad {
  return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 };
}

/** Sets the coefficients of `f` for `type` at `cutoffHz` with quality `q`; the state is kept (smooth sweeps). */
export function setBiquad(f: Biquad, type: SfxFilterType, cutoffHz: number, q: number, sampleRate: number): void {
  const fc = Math.min(Math.max(cutoffHz, MIN_CUTOFF_HZ), sampleRate * MAX_CUTOFF_FRACTION);
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  let b0: number;
  let b1: number;
  let b2: number;
  switch (type) {
    case 'tiefpass':
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = b0;
      break;
    case 'hochpass':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = b0;
      break;
    case 'bandpass':
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      break;
  }
  f.b0 = b0 / a0;
  f.b1 = b1 / a0;
  f.b2 = b2 / a0;
  f.a1 = (-2 * cos) / a0;
  f.a2 = (1 - alpha) / a0;
}

/** Filters one sample. */
export function processBiquad(f: Biquad, x: number): number {
  const y = f.b0 * x + f.z1;
  f.z1 = f.b1 * x - f.a1 * y + f.z2;
  f.z2 = f.b2 * x - f.a2 * y;
  return y;
}

/**
 * Magnitude response of the current coefficients at `hz` (for tests and tooling): |H(e^jw)|.
 */
export function biquadGainAt(f: Pick<Biquad, 'b0' | 'b1' | 'b2' | 'a1' | 'a2'>, hz: number, sampleRate: number): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = f.b0 + f.b1 * c1 + f.b2 * c2;
  const ni = -(f.b1 * s1 + f.b2 * s2);
  const dr = 1 + f.a1 * c1 + f.a2 * c2;
  const di = -(f.a1 * s1 + f.a2 * s2);
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}
