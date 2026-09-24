/**
 * SFX synthesis (MASTERPROMPT §27 "sfxr-artig + FM + Rauschen + Filter + Hüllkurven + Layering"):
 * renders a preset of src/content/sfx into a mono `Float32Array`, sample by sample, in plain
 * TypeScript. The browser copies the result into an `AudioBuffer` (src/audio/sfxPlayer.ts); Node runs
 * the very same code, so every preset is unit-testable (no NaN, peak ≤ 1, length) and the output is
 * bit-identical everywhere – no OfflineAudioContext needed (see src/audio/README.md).
 *
 * Per layer and pass: source (band-limited oscillators with PolyBLEP, two-operator FM, white/pink/brown
 * noise, pitched sample-and-hold noise, sparse crackle impulses) → optional resonant biquad with cutoff
 * sweep → ADSR envelope → optional bit reduction → level; passes of a `wiederholung` are shifted in
 * time, level and pitch. The mix is DC-blocked, faded at the edges (one-shots) or crossfaded into a
 * seamless loop (`schleife`), and normalised to the preset's `lautstaerke` by short-term loudness
 * (peak ≤ `PEAK_CEILING`).
 *
 * Takes (`variant`) differ in their noise seeds and, from take 1 on, in a jitter of all frequencies by
 * up to `streuung.klang`; take 0 is the recipe exactly as written.
 */
import { SFX_SAMPLE_RATE, sfxEnvelopeSeconds, sfxPresetSeconds, type SfxEnvelope, type SfxLayer, type SfxPreset } from '../../content/sfx/schema';
import { Rng, hashCombine, hashString } from '../../engine/rng';
import { createBiquad, processBiquad, setBiquad, type Biquad } from './biquad';

/** Samples between two coefficient updates of a sweeping filter. */
const FILTER_UPDATE_SAMPLES = 16;
/** Loudness match of pink and brown noise to white noise (equal RMS; Paul Kellet's pink filter, leaky integrator). */
const PINK_GAIN = 0.335;
const BROWN_GAIN = 10;
/** Leak of the brown noise integrator. */
const BROWN_LEAK = 1.02;
const BROWN_STEP = 0.02;
/** A crackle impulse has decayed by 60 dB after its `laenge`. */
const CRACKLE_DECAY_DB = 60;
/** Weakest crackle impulse relative to the strongest. */
const CRACKLE_MIN_AMP = 0.35;
/** DC blocker corner [Hz]. */
const DC_BLOCK_HZ = 20;
/** Fade-in and fade-out of one-shots [s] against clicks at the buffer edges. */
const EDGE_FADE_IN_SECONDS = 0.001;
const EDGE_FADE_OUT_SECONDS = 0.004;
/** Crossfade of a loop's seam [s] (at most a quarter of the loop). */
const LOOP_CROSSFADE_SECONDS = 0.12;
/** Below this peak a buffer counts as silent (not normalised). */
const SILENCE = 1e-9;
/** Short-term loudness (weighted RMS) of a preset with `lautstaerke` 1. */
export const LOUDNESS_AT_FULL = 0.35;
/** No rendered sample exceeds this magnitude (headroom for the playback variation and the mixer). */
export const PEAK_CEILING = 0.98;
/** Window of the short-term loudness [s] and its weighting high-pass [Hz, Q]. */
const LOUDNESS_WINDOW_SECONDS = 0.02;
const LOUDNESS_HIGHPASS_HZ = 120;
const LOUDNESS_HIGHPASS_Q = 0.7;

export interface RenderOptions {
  /** Output rate [Hz]; default `SFX_SAMPLE_RATE`. */
  readonly sampleRate?: number;
  /** Take 0 … `varianten − 1`. */
  readonly variant?: number;
}

/** Number of samples `renderSfx` returns for `preset` at `sampleRate`. */
export function sfxSampleCount(preset: SfxPreset, sampleRate: number = SFX_SAMPLE_RATE): number {
  return Math.max(1, Math.round(sfxPresetSeconds(preset) * sampleRate));
}

/** Renders one take of `preset` (see module comment). */
export function renderSfx(preset: SfxPreset, options: RenderOptions = {}): Float32Array<ArrayBuffer> {
  const sampleRate = options.sampleRate ?? SFX_SAMPLE_RATE;
  const variant = options.variant ?? 0;
  const length = sfxSampleCount(preset, sampleRate);
  const loop = preset.schleife;
  const crossfade = loop === undefined ? 0 : Math.round(Math.min(LOOP_CROSSFADE_SECONDS, loop.dauer / 4) * sampleRate);
  const raw = new Float32Array(length + crossfade);
  const seed = hashCombine(hashString(preset.id), variant);
  const jitterRng = new Rng(seed);
  preset.schichten.forEach((layer, index) => {
    const jitter = variant === 0 ? 1 : 1 + preset.streuung.klang * jitterRng.float(-1, 1);
    renderLayer(raw, layer, sampleRate, jitter, new Rng(hashCombine(seed, index + 1)));
  });
  blockDc(raw, sampleRate);
  let out: Float32Array<ArrayBuffer>;
  if (loop === undefined) {
    out = raw;
    fadeEdges(out, sampleRate);
  } else out = crossfadeLoop(raw, length, crossfade);
  normalize(out, preset.lautstaerke, sampleRate);
  return out;
}

/** Every take of `preset` (`varianten` buffers) at `sampleRate`. */
export function renderTakes(preset: SfxPreset, sampleRate: number = SFX_SAMPLE_RATE): Float32Array<ArrayBuffer>[] {
  const takes: Float32Array<ArrayBuffer>[] = [];
  for (let v = 0; v < preset.varianten; v++) takes.push(renderSfx(preset, { sampleRate, variant: v }));
  return takes;
}

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

function renderLayer(out: Float32Array, layer: SfxLayer, sampleRate: number, jitter: number, rng: Rng): void {
  const rep = layer.wiederholung;
  const passes = rep?.anzahl ?? 1;
  for (let p = 0; p < passes; p++) {
    const start = layer.start + (rep === undefined ? 0 : p * rep.abstand);
    const gain = layer.pegel * (rep === undefined ? 1 : rep.abfall ** p);
    const pitch = jitter * (rep === undefined ? 1 : rep.tonhoehe ** p);
    if (gain > 0) renderPass(out, layer, sampleRate, start, gain, pitch, rng);
  }
}

/** Value of `a → b` at `u` ∈ [0, 1] on the layer's glide curve. */
function glide(a: number, b: number, u: number, exponential: boolean): number {
  if (a === b) return a;
  return exponential ? a * (b / a) ** u : a + (b - a) * u;
}

/** Envelope level at `t` seconds into the pass. */
export function envelopeAt(e: SfxEnvelope, t: number): number {
  if (t < 0) return 0;
  if (t < e.anschlag) return t / e.anschlag;
  let r = t - e.anschlag;
  if (r < e.abfall) return e.halten + (1 - e.halten) * (1 - r / e.abfall) ** e.kurve;
  r -= e.abfall;
  if (r < e.haltezeit) return e.halten;
  r -= e.haltezeit;
  if (r < e.ausklang) return e.halten * (1 - r / e.ausklang) ** e.kurve;
  return 0;
}

/** PolyBLEP residual for a discontinuity at phase 0 (band-limits the edges of square and saw). */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

interface NoiseState {
  b0: number;
  b1: number;
  b2: number;
  brown: number;
  hold: number;
  crackle: number;
}

function renderPass(out: Float32Array, layer: SfxLayer, sampleRate: number, startSeconds: number, gain: number, pitch: number, rng: Rng): void {
  const env = layer.huelle;
  const seconds = sfxEnvelopeSeconds(env);
  const first = Math.round(startSeconds * sampleRate);
  const count = Math.min(Math.round(seconds * sampleRate), out.length - first);
  if (count <= 0) return;
  const src = layer.quelle;
  const exponential = layer.gleiten === 'exponentiell';
  const vib = layer.vibrato;
  const jump = layer.sprung;
  const flt = layer.filter;
  const biquad: Biquad | null = flt === undefined ? null : createBiquad();
  const sweeping = flt !== undefined && (flt.frequenzEnde !== undefined || pitch !== 1);
  const quant = layer.koernung === undefined ? 0 : 2 ** (layer.koernung - 1);
  const noise: NoiseState = { b0: 0, b1: 0, b2: 0, brown: 0, hold: rng.float(-1, 1), crackle: 0 };
  const crackleDecay = src.art === 'knistern' ? 10 ** (-CRACKLE_DECAY_DB / 20 / (src.laenge * sampleRate)) : 0;
  let phase = 0;
  let modPhase = 0;
  const invRate = 1 / sampleRate;
  for (let i = 0; i < count; i++) {
    const t = i * invRate;
    const u = t / seconds;
    // Pitch of the moment: glide, jump, vibrato (sources without pitch ignore it).
    let pitchNow = pitch;
    if (jump !== undefined && t >= jump.nach) pitchNow *= jump.faktor;
    if (vib !== undefined) pitchNow *= 2 ** ((vib.tiefe / 1200) * Math.sin(2 * Math.PI * vib.rate * t));
    let s: number;
    switch (src.art) {
      case 'welle': {
        const f = glide(src.frequenz, src.frequenzEnde ?? src.frequenz, u, exponential) * pitchNow;
        const dt = Math.min(f * invRate, 0.5);
        switch (src.form) {
          case 'sinus':
            s = Math.sin(2 * Math.PI * phase);
            break;
          case 'dreieck':
            s = 1 - 4 * Math.abs(phase - 0.5);
            break;
          case 'saege':
            s = 2 * phase - 1 - polyBlep(phase, dt);
            break;
          case 'rechteck': {
            const duty = src.tastgrad ?? 0.5;
            s = (phase < duty ? 1 : -1) + polyBlep(phase, dt) - polyBlep((phase + 1 - duty) % 1, dt);
            break;
          }
        }
        phase += dt;
        if (phase >= 1) phase -= 1;
        break;
      }
      case 'fm': {
        const f = glide(src.frequenz, src.frequenzEnde ?? src.frequenz, u, exponential) * pitchNow;
        const index = src.indexEnde === undefined ? src.index : src.index + (src.indexEnde - src.index) * u;
        s = Math.sin(2 * Math.PI * phase + index * Math.sin(2 * Math.PI * modPhase));
        phase += f * invRate;
        if (phase >= 1) phase -= Math.floor(phase);
        modPhase += f * src.verhaeltnis * invRate;
        if (modPhase >= 1) modPhase -= Math.floor(modPhase);
        break;
      }
      case 'rauschen': {
        const w = rng.float(-1, 1);
        switch (src.farbe) {
          case 'weiss':
            s = w;
            break;
          case 'rosa':
            noise.b0 = 0.99765 * noise.b0 + w * 0.099046;
            noise.b1 = 0.963 * noise.b1 + w * 0.2965164;
            noise.b2 = 0.57 * noise.b2 + w * 1.0526913;
            s = (noise.b0 + noise.b1 + noise.b2 + w * 0.1848) * PINK_GAIN;
            break;
          case 'braun':
            noise.brown = (noise.brown + BROWN_STEP * w) / BROWN_LEAK;
            s = noise.brown * BROWN_GAIN;
            break;
        }
        break;
      }
      case 'digital': {
        const f = glide(src.frequenz, src.frequenzEnde ?? src.frequenz, u, exponential) * pitchNow;
        phase += f * invRate;
        if (phase >= 1) {
          phase -= Math.floor(phase);
          noise.hold = rng.float(-1, 1);
        }
        s = noise.hold;
        break;
      }
      case 'knistern': {
        const density = glide(src.dichte, src.dichteEnde ?? src.dichte, u, exponential);
        if (rng.next() < density * invRate) noise.crackle = Math.max(noise.crackle, CRACKLE_MIN_AMP + (1 - CRACKLE_MIN_AMP) * rng.next());
        s = noise.crackle * rng.float(-1, 1);
        noise.crackle *= crackleDecay;
        break;
      }
    }
    if (biquad !== null && flt !== undefined) {
      if (i === 0 || (sweeping && i % FILTER_UPDATE_SAMPLES === 0)) {
        const fc = glide(flt.frequenz, flt.frequenzEnde ?? flt.frequenz, u, exponential) * pitch;
        setBiquad(biquad, flt.art, fc, flt.resonanz, sampleRate);
      }
      s = processBiquad(biquad, s);
    }
    let v = s * envelopeAt(env, t);
    if (quant > 0) v = Math.round(v * quant) / quant;
    out[first + i]! += v * gain;
  }
}

// ---------------------------------------------------------------------------------------------
// Mix
// ---------------------------------------------------------------------------------------------

function blockDc(buf: Float32Array, sampleRate: number): void {
  const r = 1 - (2 * Math.PI * DC_BLOCK_HZ) / sampleRate;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const y = x - x1 + r * y1;
    x1 = x;
    y1 = y;
    buf[i] = y;
  }
}

function fadeEdges(buf: Float32Array, sampleRate: number): void {
  const fadeIn = Math.min(buf.length, Math.round(EDGE_FADE_IN_SECONDS * sampleRate));
  for (let i = 0; i < fadeIn; i++) buf[i]! *= i / fadeIn;
  const fadeOut = Math.min(buf.length, Math.round(EDGE_FADE_OUT_SECONDS * sampleRate));
  for (let i = 0; i < fadeOut; i++) buf[buf.length - 1 - i]! *= i / fadeOut;
}

/**
 * Folds the `crossfade` samples after `length` onto the start with an equal-power crossfade: the last
 * sample of the result continues straight into its first, so the loop has no seam.
 */
function crossfadeLoop(raw: Float32Array, length: number, crossfade: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  out.set(raw.subarray(0, length));
  for (let i = 0; i < crossfade && i < length; i++) {
    const a = (Math.PI / 2) * (i / crossfade);
    out[i] = raw[i]! * Math.sin(a) + raw[length + i]! * Math.cos(a);
  }
  return out;
}

/**
 * Loudness of `buf` as the ear hears a short sound: the highest RMS over `LOUDNESS_WINDOW_SECONDS`
 * windows after a high-pass at `LOUDNESS_HIGHPASS_HZ` (low thuds carry energy the ear barely weighs –
 * a rough K-weighting, as loudness meters do).
 */
export function shortTermLoudness(buf: Float32Array, sampleRate: number): number {
  const hp = createBiquad();
  setBiquad(hp, 'hochpass', LOUDNESS_HIGHPASS_HZ, LOUDNESS_HIGHPASS_Q, sampleRate);
  const window = Math.max(1, Math.round(LOUDNESS_WINDOW_SECONDS * sampleRate));
  const squares = new Float64Array(buf.length + 1);
  for (let i = 0; i < buf.length; i++) {
    const y = processBiquad(hp, buf[i]!);
    squares[i + 1] = squares[i]! + y * y;
  }
  if (buf.length <= window) return Math.sqrt(squares[buf.length]! / Math.max(1, buf.length));
  let best = 0;
  for (let end = window; end <= buf.length; end++) best = Math.max(best, squares[end]! - squares[end - window]!);
  return Math.sqrt(best / window);
}

/**
 * Scales `buf` so its short-term loudness is `lautstaerke × LOUDNESS_AT_FULL` – presets are mixed by
 * loudness, not by peak, so a clicky step and a boomy thud of the same `lautstaerke` sound equally loud –
 * without letting the peak pass `PEAK_CEILING`.
 */
function normalize(buf: Float32Array, lautstaerke: number, sampleRate: number): void {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]!));
  const loudness = shortTermLoudness(buf, sampleRate);
  if (peak < SILENCE || loudness < SILENCE) return;
  const k = Math.min((lautstaerke * LOUDNESS_AT_FULL) / loudness, PEAK_CEILING / peak);
  for (let i = 0; i < buf.length; i++) buf[i]! *= k;
}
