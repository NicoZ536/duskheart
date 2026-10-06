/**
 * The voices of the tracker (docs/SPIEL.md §24, MASTERPROMPT §27 "Instrumente aus Rechteck, Dreieck, Rauschen, FM,
 * Wavetable"): one `TrackerVoice` per channel renders its instrument sample by sample into the block buffers of the
 * sequencer (src/audio/music/render.ts) – plain TypeScript, the same code in Node and in the music worker, so a render is
 * bit-identical everywhere (no OfflineAudioContext, ADR draft "eigener Synth im Worker").
 *
 * - **Waves:** band-limited square (PolyBLEP, pulse width) and saw, a naive triangle (its harmonics fall fast enough),
 *   pitched noise from a 15-bit LFSR clocked by the note (the 8/16-bit noise channel, reset at every note: a pattern
 *   sounds the same wherever it stands), two-operator FM whose index follows the envelope (bright attack, soft tail), and
 *   one cycle of a content wavetable (linearly interpolated).
 * - **Envelope:** ADSR with a linear attack and exponential decay and release (plucks and bells ring out naturally).
 * - **Pitch:** per tracker tick (six per row) from the note, portamento, arpeggio, vibrato (effect and the instrument's
 *   delayed vibrato) and the instrument's pitch envelope (kick drums, toms).
 * - **Declick:** a new note starts its oscillator at phase 0 – needed for a sample-exact loop –, while the old note keeps
 *   sounding in a ghost voice that fades it out linearly over `DECLICK_SAMPLES` (no jump, no kink in the waveform).
 * - **Optional:** a resonant filter per voice, a detuned second oscillator (`chorus`).
 */
import type { TrackerInstrument } from '../../content/music/schema';
import { NOTE_A4 } from '../../content/music/notation';
import { createBiquad, processBiquad, setBiquad, type Biquad } from '../dsp/biquad';

/** Tracker ticks per row (effects update per tick, like the classic trackers' speed 6). */
export const TICKS_PER_ROW = 6;
/** Samples over which a cut note fades out in its ghost voice (3 ms at 32 kHz). */
export const DECLICK_SAMPLES = 96;
/** Noise clock per Hz of the note: C-4 clocks the LFSR at 8,4 kHz. */
const NOISE_CLOCK_PER_HZ = 32;
/** Highest LFSR clock [fraction of the sample rate]. */
const NOISE_CLOCK_MAX = 1;
/** Level below which an envelope counts as finished. */
const ENVELOPE_FLOOR = 1e-4;
/** A decay or release reaches this fraction of its start at its time (−60 dB). */
const ENVELOPE_TARGET = 0.001;
/** Share of the FM index that stays at zero envelope (the rest follows the envelope). */
const FM_INDEX_BASE = 0.35;
/** 1 / 2π: radians of the FM index in cycles. */
const INV_TWO_PI = 1 / (2 * Math.PI);
/** Size of the sine table (FM, vibrato). */
const SINE_SIZE = 2048;
/** Vibrato effect depth per unit of y [semitones] and speed per unit of x [cycles per tick]. */
const VIBRATO_DEPTH_SEMITONES = 1 / 8;
const VIBRATO_SPEED_CYCLES = 1 / 64;
/** Portamento speed per unit of xx [semitones per tick]. */
const PORTAMENTO_SEMITONES = 1 / 16;

const W_SQUARE = 0;
const W_TRIANGLE = 1;
const W_SAW = 2;
const W_NOISE = 3;
const W_FM = 4;
const W_TABLE = 5;
const WAVE_CODES: Readonly<Record<TrackerInstrument['welle'], number>> = { rechteck: W_SQUARE, dreieck: W_TRIANGLE, saege: W_SAW, rauschen: W_NOISE, fm: W_FM, wavetable: W_TABLE };

const ST_OFF = 0;
const ST_ATTACK = 1;
const ST_DECAY = 2;
const ST_SUSTAIN = 3;
const ST_RELEASE = 4;

/** One period of a sine, sampled (FM carrier and modulator, vibrato). */
const SINE = (() => {
  const t = new Float64Array(SINE_SIZE + 1);
  for (let i = 0; i <= SINE_SIZE; i++) t[i] = Math.sin((2 * Math.PI * i) / SINE_SIZE);
  return t;
})();

/** Sine of `phase` cycles (any real phase), from the table with linear interpolation. */
export function tableSine(phase: number): number {
  const p = phase - Math.floor(phase);
  const x = p * SINE_SIZE;
  const i = x | 0;
  const f = x - i;
  const a = SINE[i] as number;
  return a + ((SINE[i + 1] as number) - a) * f;
}

/** Frequency of a (fractional) note number [Hz]. */
function freqOf(note: number): number {
  return 440 * 2 ** ((note - NOTE_A4) / 12);
}

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

/** An instrument prepared for rendering at one sample rate. */
export interface CompiledInstrument {
  readonly wave: number;
  readonly duty: number;
  readonly fmRatio: number;
  readonly fmIndex: number;
  readonly table: Float64Array | null;
  readonly attackStep: number;
  readonly decayCoef: number;
  readonly sustain: number;
  readonly releaseCoef: number;
  readonly level: number;
  readonly gainL: number;
  readonly gainR: number;
  readonly echo: number;
  readonly pitchEnvSemis: number;
  readonly pitchEnvSeconds: number;
  readonly filterType: 'tiefpass' | 'hochpass' | 'bandpass' | null;
  readonly filterHz: number;
  readonly filterQ: number;
  readonly autoVibSemis: number;
  readonly autoVibRate: number;
  readonly autoVibDelay: number;
  readonly chorusRatio: number;
}

/** Coefficient of an exponential fall to `ENVELOPE_TARGET` in `seconds`. */
function fallCoef(seconds: number, sampleRate: number): number {
  const n = Math.max(1, seconds * sampleRate);
  return Math.exp(Math.log(ENVELOPE_TARGET) / n);
}

/** Prepares `inst` for `sampleRate`; `tables` holds the wavetables by id. */
export function compileInstrument(inst: TrackerInstrument, tables: ReadonlyMap<string, readonly number[]>, sampleRate: number): CompiledInstrument {
  const [a, d, s, r] = inst.huellkurve;
  let table: Float64Array | null = null;
  if (inst.welle === 'wavetable') {
    const values = inst.tabelle === undefined ? undefined : tables.get(inst.tabelle);
    if (values === undefined) throw new Error(`music: unknown wavetable "${inst.tabelle ?? ''}" of instrument "${inst.id}"`);
    table = new Float64Array(values.length + 1);
    table.set(values);
    table[values.length] = values[0] as number;
  }
  const angle = ((inst.pan + 1) * Math.PI) / 4;
  return {
    wave: WAVE_CODES[inst.welle],
    duty: inst.tastgrad ?? 0.5,
    fmRatio: inst.fm?.verhaeltnis ?? 1,
    fmIndex: inst.fm?.index ?? 0,
    table,
    attackStep: 1 / Math.max(1, a * sampleRate),
    decayCoef: fallCoef(d, sampleRate),
    sustain: s,
    releaseCoef: fallCoef(r, sampleRate),
    level: inst.pegel,
    gainL: Math.cos(angle),
    gainR: Math.sin(angle),
    echo: inst.echoSend,
    pitchEnvSemis: inst.tonhoehenHuelle?.halbtoene ?? 0,
    pitchEnvSeconds: inst.tonhoehenHuelle?.sekunden ?? 1,
    filterType: inst.filter?.art ?? null,
    filterHz: inst.filter?.frequenz ?? 0,
    filterQ: inst.filter?.resonanz ?? 0.707,
    autoVibSemis: (inst.vibrato?.tiefe ?? 0) / 100,
    autoVibRate: inst.vibrato?.rate ?? 0,
    autoVibDelay: inst.vibrato?.verzoegerung ?? 0,
    chorusRatio: inst.chorus === undefined ? 0 : 2 ** (inst.chorus.cents / 1200),
  };
}

/** Where a voice writes one block: dry and echo-send buffers of its layer's stem (stereo). */
export interface VoiceTarget {
  dryL: Float64Array;
  dryR: Float64Array;
  echoL: Float64Array;
  echoR: Float64Array;
}

/** One channel of the tracker. */
export class TrackerVoice {
  private inst: CompiledInstrument | null = null;
  /** Current note (fractional during a slide) and the slide's target. */
  private note = 0;
  private target = 0;
  private portaSpeed = 0;
  private volume = 1;
  private echoSend = 0;
  private stage = ST_OFF;
  private env = 0;
  private phase = 0;
  private phase2 = 0;
  private modPhase = 0;
  private lfsr = 1;
  private noiseAcc = 0;
  private noiseOut = 1;
  private sinceOn = 0;
  private arpX = 0;
  private arpY = 0;
  private vibSpeed = 0;
  private vibDepth = 0;
  private vibPhase = 0;
  /** Phase increments of the current tick. */
  private dt = 0;
  private dt2 = 0;
  private readonly filter: Biquad = createBiquad();
  private filtered = false;
  /** Ghost mode: samples of the fade left (the voice is the fading copy of a cut note). */
  private fadeLeft = 0;
  /** The fading copy of the last cut note (created on the first cut). */
  private ghost: TrackerVoice | null = null;

  constructor(private readonly sampleRate: number) {}

  /** Back to silence (a new render pass). */
  reset(): void {
    this.inst = null;
    this.note = 0;
    this.target = 0;
    this.portaSpeed = 0;
    this.volume = 1;
    this.echoSend = 0;
    this.stage = ST_OFF;
    this.env = 0;
    this.phase = 0;
    this.phase2 = 0;
    this.modPhase = 0;
    this.lfsr = 1;
    this.noiseAcc = 0;
    this.noiseOut = 1;
    this.sinceOn = 0;
    this.arpX = 0;
    this.arpY = 0;
    this.vibSpeed = 0;
    this.vibDepth = 0;
    this.vibPhase = 0;
    this.dt = 0;
    this.dt2 = 0;
    this.filtered = false;
    this.filter.z1 = 0;
    this.filter.z2 = 0;
    this.fadeLeft = 0;
    this.ghost?.reset();
  }

  /** Whether the voice makes sound (or fades a cut note). */
  get sounding(): boolean {
    return this.stage !== ST_OFF || (this.ghost !== null && this.ghost.fadeLeft > 0);
  }

  /** Becomes the fading copy of `v`'s sounding note. */
  private copyFrom(v: TrackerVoice): void {
    this.inst = v.inst;
    this.note = v.note;
    this.volume = v.volume;
    this.echoSend = v.echoSend;
    this.stage = v.stage;
    this.env = v.env;
    this.phase = v.phase;
    this.phase2 = v.phase2;
    this.modPhase = v.modPhase;
    this.lfsr = v.lfsr;
    this.noiseAcc = v.noiseAcc;
    this.noiseOut = v.noiseOut;
    this.sinceOn = v.sinceOn;
    this.dt = v.dt;
    this.dt2 = v.dt2;
    this.filtered = v.filtered;
    const f = this.filter;
    const g = v.filter;
    f.b0 = g.b0;
    f.b1 = g.b1;
    f.b2 = g.b2;
    f.a1 = g.a1;
    f.a2 = g.a2;
    f.z1 = g.z1;
    f.z2 = g.z2;
    this.fadeLeft = DECLICK_SAMPLES;
  }

  /**
   * Applies one cell at the start of a row: `note` (≥ 0 a note, −2 off, −1 nothing), instrument (always given with a
   * note), volume 0–64 or −1, effect code and parameter.
   */
  cell(note: number, inst: CompiledInstrument | null, vol: number, fx: number, param: number): void {
    this.arpX = 0;
    this.arpY = 0;
    this.vibSpeed = 0;
    this.vibDepth = 0;
    this.portaSpeed = 0;
    if (note >= 0 && inst !== null) {
      if (fx === 2 && this.stage !== ST_OFF && this.stage !== ST_RELEASE) {
        // Portamento: glide from the sounding note, no new attack.
        this.target = note;
        this.portaSpeed = param * PORTAMENTO_SEMITONES;
      } else this.noteOn(note, inst);
      this.volume = vol >= 0 ? vol / 64 : 1;
    } else if (note === -2) {
      if (this.stage !== ST_OFF) this.stage = ST_RELEASE;
      if (vol >= 0) this.volume = vol / 64;
    } else if (vol >= 0) this.volume = vol / 64;
    switch (fx) {
      case 1:
        this.arpX = param >> 4;
        this.arpY = param & 15;
        break;
      case 3:
        this.vibSpeed = (param >> 4) * VIBRATO_SPEED_CYCLES;
        this.vibDepth = (param & 15) * VIBRATO_DEPTH_SEMITONES;
        break;
      case 4:
        this.echoSend = param / 64;
        break;
      default:
        break;
    }
  }

  private noteOn(note: number, inst: CompiledInstrument): void {
    // The sounding note fades out in the ghost while the new one starts at phase 0.
    if (this.stage !== ST_OFF && this.inst !== null) {
      this.ghost ??= new TrackerVoice(this.sampleRate);
      this.ghost.copyFrom(this);
    }
    this.inst = inst;
    this.note = note;
    this.target = note;
    this.echoSend = inst.echo;
    this.stage = ST_ATTACK;
    this.env = 0;
    this.phase = 0;
    this.phase2 = 0;
    this.modPhase = 0;
    this.lfsr = 1;
    this.noiseAcc = 0;
    this.noiseOut = 1;
    this.sinceOn = 0;
    this.vibPhase = 0;
    this.filtered = inst.filterType !== null;
    if (inst.filterType !== null) {
      this.filter.z1 = 0;
      this.filter.z2 = 0;
      setBiquad(this.filter, inst.filterType, inst.filterHz, inst.filterQ, this.sampleRate);
    }
  }

  /** Pitch of tick `tickInRow` of the row: slide, arpeggio, vibrato, pitch envelope → the phase increments. */
  tick(tickInRow: number): void {
    const inst = this.inst;
    if (inst === null) return;
    if (this.portaSpeed > 0 && this.note !== this.target) {
      if (this.note < this.target) this.note = Math.min(this.target, this.note + this.portaSpeed);
      else this.note = Math.max(this.target, this.note - this.portaSpeed);
    }
    let n = this.note;
    const step = tickInRow % 3;
    if (step === 1) n += this.arpX;
    else if (step === 2) n += this.arpY;
    if (this.vibDepth > 0) {
      n += this.vibDepth * tableSine(this.vibPhase);
      this.vibPhase += this.vibSpeed;
    }
    const t = this.sinceOn / this.sampleRate;
    if (inst.autoVibSemis > 0 && t > inst.autoVibDelay) n += inst.autoVibSemis * tableSine((t - inst.autoVibDelay) * inst.autoVibRate);
    if (inst.pitchEnvSemis !== 0 && t < inst.pitchEnvSeconds) {
      const u = 1 - t / inst.pitchEnvSeconds;
      n += inst.pitchEnvSemis * u * u;
    }
    const f = freqOf(n);
    if (inst.wave === W_NOISE) this.dt = Math.min(NOISE_CLOCK_MAX, (f * NOISE_CLOCK_PER_HZ) / this.sampleRate);
    else this.dt = Math.min(0.5, f / this.sampleRate);
    this.dt2 = this.dt * inst.chorusRatio;
  }

  /** Renders `count` samples into `out` from index `from` (adds dry and echo send of the voice and of its ghost). */
  render(out: VoiceTarget, from: number, count: number): void {
    const ghost = this.ghost;
    if (ghost !== null && ghost.fadeLeft > 0) ghost.render(out, from, Math.min(count, ghost.fadeLeft));
    const inst = this.inst;
    if (inst === null || this.stage === ST_OFF) return;
    const gain = inst.level * this.volume;
    const gL = gain * inst.gainL;
    const gR = gain * inst.gainR;
    const eL = gL * this.echoSend;
    const eR = gR * this.echoSend;
    const wave = inst.wave;
    const dt = this.dt;
    const dt2 = this.dt2;
    const chorus = dt2 > 0;
    const dryL = out.dryL;
    const dryR = out.dryR;
    const echoL = out.echoL;
    const echoR = out.echoR;
    const fading = this.fadeLeft > 0;
    let fade = this.fadeLeft;
    let stage = this.stage;
    let env = this.env;
    let phase = this.phase;
    let phase2 = this.phase2;
    for (let k = 0; k < count; k++) {
      // Envelope.
      if (stage === ST_ATTACK) {
        env += inst.attackStep;
        if (env >= 1) {
          env = 1;
          stage = ST_DECAY;
        }
      } else if (stage === ST_DECAY) {
        env = inst.sustain + (env - inst.sustain) * inst.decayCoef;
        if (env - inst.sustain < ENVELOPE_FLOOR) {
          env = inst.sustain;
          stage = inst.sustain > 0 ? ST_SUSTAIN : ST_OFF;
        }
      } else if (stage === ST_RELEASE) {
        env *= inst.releaseCoef;
        if (env < ENVELOPE_FLOOR) {
          env = 0;
          stage = ST_OFF;
        }
      } else if (stage === ST_OFF) break;
      // Oscillator.
      let s: number;
      switch (wave) {
        case W_SQUARE: {
          const duty = inst.duty;
          s = (phase < duty ? 1 : -1) + polyBlep(phase, dt) - polyBlep(phase >= duty ? phase - duty : phase - duty + 1, dt);
          if (chorus) s = 0.5 * (s + (phase2 < duty ? 1 : -1) + polyBlep(phase2, dt2) - polyBlep(phase2 >= duty ? phase2 - duty : phase2 - duty + 1, dt2));
          break;
        }
        case W_TRIANGLE:
          s = 1 - 4 * Math.abs(phase - 0.5);
          if (chorus) s = 0.5 * (s + 1 - 4 * Math.abs(phase2 - 0.5));
          break;
        case W_SAW:
          s = 2 * phase - 1 - polyBlep(phase, dt);
          if (chorus) s = 0.5 * (s + 2 * phase2 - 1 - polyBlep(phase2, dt2));
          break;
        case W_NOISE:
          this.noiseAcc += dt;
          while (this.noiseAcc >= 1) {
            this.noiseAcc -= 1;
            const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;
            this.lfsr = (this.lfsr >> 1) | (bit << 14);
            this.noiseOut = (this.lfsr & 1) === 0 ? 1 : -1;
          }
          s = this.noiseOut;
          break;
        case W_FM: {
          const index = inst.fmIndex * (FM_INDEX_BASE + (1 - FM_INDEX_BASE) * env);
          s = tableSine(phase + index * tableSine(this.modPhase) * INV_TWO_PI);
          let m = this.modPhase + dt * inst.fmRatio;
          if (m >= 1) m -= Math.floor(m);
          this.modPhase = m;
          break;
        }
        default: {
          const table = inst.table as Float64Array;
          const len = table.length - 1;
          let x = phase * len;
          let i = x | 0;
          let v = (table[i] as number) + ((table[i + 1] as number) - (table[i] as number)) * (x - i);
          if (chorus) {
            x = phase2 * len;
            i = x | 0;
            v = 0.5 * (v + (table[i] as number) + ((table[i + 1] as number) - (table[i] as number)) * (x - i));
          }
          s = v;
          break;
        }
      }
      if (wave !== W_NOISE) {
        phase += dt;
        if (phase >= 1) phase -= 1;
        if (chorus) {
          phase2 += dt2;
          if (phase2 >= 1) phase2 -= 1;
        }
      }
      s *= env;
      if (this.filtered) s = processBiquad(this.filter, s);
      // A ghost: the cut note fades out linearly.
      if (fading) s *= fade / DECLICK_SAMPLES;
      const i = from + k;
      dryL[i] = (dryL[i] as number) + s * gL;
      dryR[i] = (dryR[i] as number) + s * gR;
      echoL[i] = (echoL[i] as number) + s * eL;
      echoR[i] = (echoR[i] as number) + s * eR;
      if (fading && --fade <= 0) {
        stage = ST_OFF;
        break;
      }
    }
    this.stage = stage;
    this.env = env;
    this.phase = phase;
    this.phase2 = phase2;
    if (fading) this.fadeLeft = Math.max(0, fade);
    this.sinceOn += count;
  }
}
