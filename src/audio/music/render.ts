/**
 * The tracker's sequencer (docs/SPIEL.md §24 "Tracker/Sequencer", MASTERPROMPT §27 "eigener Tracker/Sequencer …,
 * SNES-artiges Echo"; M7-03): renders a piece of src/content/music into one stereo Float32 stem per layer at 32 kHz – a
 * pure function of the piece, the arrangement and the wavetables, so Node and the music worker produce the same bits
 * (tests/unit/audio/sequencer.test.ts compares the hashes; the E2E test compares a worker render with Node).
 *
 * - **Timing:** a row lasts `round(32000 × 60 / (bpm × zeilenJeSchlag))` samples (whole samples: every repetition of a
 *   pattern is sample-exact), split into `TICKS_PER_ROW` ticks for the effects.
 * - **Layers:** each channel writes into the stem of its layer (`schichten`); every stem has its own echo, so the stems
 *   add up to the full piece and a muted layer takes its echo along.
 * - **Echo** (SNES DSP): a delay line of `verzoegerungMs`, an 8-tap FIR on its output (the echo's colour), `rueckkopplung`
 *   of the filtered echo back into the line, `pegel` of it into the stem.
 * - **Loop:** an arrangement with `loopAb` < its length loops from pattern `loopAb`. The intro (patterns before it) renders
 *   from silence; the loop body renders after a pre-roll of its own last patterns (`PREROLL_SECONDS`), so the body begins
 *   with the tails and echoes of its own end – the buffer wraps from its last sample into `loopStartSample` without a seam
 *   (tests/unit/audio/musik-loop.test.ts, tests/integration/musik-render.test.ts).
 * - **Once:** `loopAb` = number of patterns plays once (stingers) and keeps the tail until the echo and the releases have
 *   died away (at most `TAIL_MAX_SECONDS`).
 * - **Level:** every piece is scaled so its full mix reaches `MUSIC_LOUDNESS` RMS without its peak passing
 *   `MUSIC_PEAK_CEILING` – the same gain for all stems.
 */
import { MUSIC_LAYERS, type MusicArrangementKind, type MusicLayer, type MusicPiece } from '../../content/music/schema';
import { parsePattern, patternRowSeconds, type ParsedPattern } from '../../content/music/notation';
import { SFX_SAMPLE_RATE } from '../../content/sfx/schema';
import type { RenderedPiece } from './types';
import { TICKS_PER_ROW, TrackerVoice, compileInstrument, type CompiledInstrument, type VoiceTarget } from './synth';

/** Sample rate of the music (the SNES DSP's 32 kHz, the same as the SFX). */
export const MUSIC_SAMPLE_RATE = SFX_SAMPLE_RATE;
/** Seconds of its own end a loop body renders before itself (tails and echoes of the end reach into the start). */
export const PREROLL_SECONDS = 10;
/** Longest tail of a piece played once [s]. */
export const TAIL_MAX_SECONDS = 4;
/** A tail ends when its block peak stays below this. */
const TAIL_SILENCE = 1e-4;
/** RMS of the full mix of a piece, and the highest peak. */
export const MUSIC_LOUDNESS = 0.16;
export const MUSIC_PEAK_CEILING = 0.89;

/** Samples of one row of `piece` at `sampleRate`. */
export function samplesPerRow(piece: Pick<MusicPiece, 'bpm' | 'zeilenJeSchlag'>, sampleRate: number = MUSIC_SAMPLE_RATE): number {
  return Math.round(sampleRate * patternRowSeconds(piece.bpm, piece.zeilenJeSchlag));
}

/** The arrangement of `piece` for `kind`, falling back to `standard`, then to the first. */
export function arrangementOf(piece: MusicPiece, kind: MusicArrangementKind): MusicPiece['arrangements'][number] {
  return piece.arrangements.find((a) => a.art === kind) ?? piece.arrangements.find((a) => a.art === 'standard') ?? (piece.arrangements[0] as MusicPiece['arrangements'][number]);
}

/** Stereo stem being written: planar `[L…, R…]` of `length` frames. */
interface StemOut {
  readonly data: Float32Array;
  readonly length: number;
}

/** Echo state of one stem (stereo). */
class Echo {
  private readonly lineL: Float64Array;
  private readonly lineR: Float64Array;
  private readonly histL = new Float64Array(8);
  private readonly histR = new Float64Array(8);
  private pos = 0;

  constructor(
    delay: number,
    private readonly fir: readonly number[],
    private readonly feedback: number,
    private readonly level: number,
  ) {
    this.lineL = new Float64Array(Math.max(1, delay));
    this.lineR = new Float64Array(Math.max(1, delay));
  }

  reset(): void {
    this.lineL.fill(0);
    this.lineR.fill(0);
    this.histL.fill(0);
    this.histR.fill(0);
    this.pos = 0;
  }

  /** Runs `count` samples: reads the send buffers, adds the echo into the dry buffers. */
  process(dryL: Float64Array, dryR: Float64Array, sendL: Float64Array, sendR: Float64Array, count: number): void {
    const fir = this.fir;
    const f0 = fir[0] as number;
    const f1 = fir[1] as number;
    const f2 = fir[2] as number;
    const f3 = fir[3] as number;
    const f4 = fir[4] as number;
    const f5 = fir[5] as number;
    const f6 = fir[6] as number;
    const f7 = fir[7] as number;
    const hL = this.histL;
    const hR = this.histR;
    const lineL = this.lineL;
    const lineR = this.lineR;
    const n = lineL.length;
    let pos = this.pos;
    for (let i = 0; i < count; i++) {
      // The delayed sample enters the FIR history (newest first).
      for (let k = 7; k > 0; k--) {
        hL[k] = hL[k - 1] as number;
        hR[k] = hR[k - 1] as number;
      }
      hL[0] = lineL[pos] as number;
      hR[0] = lineR[pos] as number;
      const yL = f0 * hL[0] + f1 * (hL[1] as number) + f2 * (hL[2] as number) + f3 * (hL[3] as number) + f4 * (hL[4] as number) + f5 * (hL[5] as number) + f6 * (hL[6] as number) + f7 * (hL[7] as number);
      const yR = f0 * hR[0] + f1 * (hR[1] as number) + f2 * (hR[2] as number) + f3 * (hR[3] as number) + f4 * (hR[4] as number) + f5 * (hR[5] as number) + f6 * (hR[6] as number) + f7 * (hR[7] as number);
      lineL[pos] = (sendL[i] as number) + this.feedback * yL;
      lineR[pos] = (sendR[i] as number) + this.feedback * yR;
      pos++;
      if (pos >= n) pos = 0;
      dryL[i] = (dryL[i] as number) + this.level * yL;
      dryR[i] = (dryR[i] as number) + this.level * yR;
    }
    this.pos = pos;
  }
}

/**
 * Plays patterns of one piece: voices per channel, an echo per stem, block buffers of one tick. `out` per layer receives
 * the samples from `offset` on; without `out` the sequencer only advances its state (the pre-roll).
 */
export class Sequencer {
  readonly sampleRate: number;
  readonly rowSamples: number;
  private readonly instruments: CompiledInstrument[];
  private readonly voices: TrackerVoice[];
  /** Stem index of every channel. */
  private readonly stemOf: Int8Array;
  readonly layers: readonly MusicLayer[];
  private readonly echoes: Echo[];
  private readonly blocks: VoiceTarget[];
  private readonly patterns = new Map<string, ParsedPattern>();

  constructor(
    readonly piece: MusicPiece,
    tables: ReadonlyMap<string, readonly number[]>,
    sampleRate: number = MUSIC_SAMPLE_RATE,
  ) {
    this.sampleRate = sampleRate;
    this.rowSamples = samplesPerRow(piece, sampleRate);
    this.instruments = piece.instrumente.map((i) => compileInstrument(i, tables, sampleRate));
    const channels = piece.patterns[0]?.kanaele ?? 0;
    this.voices = Array.from({ length: channels }, () => new TrackerVoice(sampleRate));
    this.layers = MUSIC_LAYERS.filter((l) => piece.schichten[l].length > 0);
    this.stemOf = new Int8Array(channels);
    this.layers.forEach((layer, stem) => {
      for (const ch of piece.schichten[layer]) this.stemOf[ch] = stem;
    });
    const delay = Math.round((piece.echo.verzoegerungMs / 1000) * sampleRate);
    this.echoes = this.layers.map(() => new Echo(delay, piece.echo.fir, piece.echo.rueckkopplung, piece.echo.pegel));
    const blockLength = Math.ceil(this.rowSamples / TICKS_PER_ROW) + 1;
    this.blocks = this.layers.map(() => ({ dryL: new Float64Array(blockLength), dryR: new Float64Array(blockLength), echoL: new Float64Array(blockLength), echoR: new Float64Array(blockLength) }));
    for (const p of piece.patterns) this.patterns.set(p.id, parsePattern(p));
  }

  /** The parsed pattern `id` (throws for an unknown one). */
  pattern(id: string): ParsedPattern {
    const p = this.patterns.get(id);
    if (p === undefined) throw new Error(`music: piece "${this.piece.id}" has no pattern "${id}"`);
    return p;
  }

  /** Samples of pattern `id`. */
  patternSamples(id: string): number {
    return this.pattern(id).rows * this.rowSamples;
  }

  /** Silence: every voice and echo back to rest. */
  reset(): void {
    for (const v of this.voices) v.reset();
    for (const e of this.echoes) e.reset();
  }

  /** Renders pattern `id`; returns the samples written (or skipped) from `offset`. */
  renderPattern(id: string, out: readonly StemOut[] | null, offset: number): number {
    const p = this.pattern(id);
    const ch = p.channels;
    let written = 0;
    for (let r = 0; r < p.rows; r++) {
      for (let c = 0; c < ch; c++) {
        const i = r * ch + c;
        const inst = p.inst[i] as number;
        (this.voices[c] as TrackerVoice).cell(p.note[i] as number, inst >= 0 ? (this.instruments[inst] ?? null) : null, p.vol[i] as number, p.fx[i] as number, p.param[i] as number);
      }
      for (let t = 0; t < TICKS_PER_ROW; t++) {
        const from = Math.floor((t * this.rowSamples) / TICKS_PER_ROW);
        const to = Math.floor(((t + 1) * this.rowSamples) / TICKS_PER_ROW);
        for (const v of this.voices) v.tick(t);
        this.block(to - from, out, offset + written);
        written += to - from;
      }
    }
    return written;
  }

  /** Lets the voices and echoes ring out for at most `maxSamples`; returns the samples written (stops at silence). */
  renderTail(maxSamples: number, out: readonly StemOut[] | null, offset: number): number {
    const block = Math.ceil(this.rowSamples / TICKS_PER_ROW);
    let written = 0;
    while (written < maxSamples) {
      const n = Math.min(block, maxSamples - written);
      const peak = this.block(n, out, offset + written);
      written += n;
      if (peak < TAIL_SILENCE && !this.voices.some((v) => v.sounding)) break;
    }
    return written;
  }

  /** One block of `n` samples into `out` at `at`; returns its peak. */
  private block(n: number, out: readonly StemOut[] | null, at: number): number {
    for (const b of this.blocks) {
      b.dryL.fill(0, 0, n);
      b.dryR.fill(0, 0, n);
      b.echoL.fill(0, 0, n);
      b.echoR.fill(0, 0, n);
    }
    for (let c = 0; c < this.voices.length; c++) (this.voices[c] as TrackerVoice).render(this.blocks[this.stemOf[c] as number] as VoiceTarget, 0, n);
    let peak = 0;
    for (let s = 0; s < this.blocks.length; s++) {
      const b = this.blocks[s] as VoiceTarget;
      (this.echoes[s] as Echo).process(b.dryL, b.dryR, b.echoL, b.echoR, n);
      const o = out?.[s];
      for (let i = 0; i < n; i++) {
        const l = b.dryL[i] as number;
        const r = b.dryR[i] as number;
        const a = Math.max(Math.abs(l), Math.abs(r));
        if (a > peak) peak = a;
        if (o !== undefined && at + i < o.length) {
          o.data[at + i] = l;
          o.data[o.length + at + i] = r;
        }
      }
    }
    return peak;
  }
}

/** Patterns at the end of `folge` from `loopAb` whose total length reaches `seconds` (in playing order). */
export function prerollPatterns(seq: Sequencer, body: readonly string[], seconds: number): string[] {
  const want = seconds * seq.sampleRate;
  const out: string[] = [];
  let total = 0;
  for (let i = body.length - 1; i >= 0 && total < want; i--) {
    const id = body[i] as string;
    out.unshift(id);
    total += seq.patternSamples(id);
  }
  // A short body repeats itself until the pre-roll is long enough.
  while (total < want && body.length > 0) {
    for (let i = body.length - 1; i >= 0 && total < want; i--) {
      const id = body[i] as string;
      out.unshift(id);
      total += seq.patternSamples(id);
    }
  }
  return out;
}

/** Frames per step of the normalisation (a job step stays short on a main thread). */
const NORMALIZE_STEP_FRAMES = 1 << 18;

/** Options of `renderPiece`. */
export interface RenderPieceOptions {
  readonly sampleRate?: number;
}

type JobPhase = 'intro' | 'preroll' | 'body' | 'tail' | 'measure' | 'scale' | 'done';

/**
 * Rendering arrangement `kind` of `piece` as a job of small steps (see module comment): `step()` renders one pattern (or the
 * tail, or a slice of the level measurement and scaling) – the worker runs it to the end at once, a page without a worker
 * steps it in idle slices. The result does not depend on how the steps were spread.
 */
export class PieceRender {
  private readonly seq: Sequencer;
  private readonly intro: readonly string[];
  private readonly body: readonly string[];
  private readonly preroll: readonly string[];
  private readonly stems: StemOut[];
  readonly lengthSamples: number;
  private readonly introSamples: number;
  private readonly tail: number;
  readonly arrangement: MusicArrangementKind;
  private phase: JobPhase;
  private index = 0;
  private at = 0;
  private frame = 0;
  private sum = 0;
  private peak = 0;
  private gain = 1;

  constructor(
    readonly piece: MusicPiece,
    kind: MusicArrangementKind,
    tables: ReadonlyMap<string, readonly number[]>,
    options: RenderPieceOptions = {},
  ) {
    const seq = new Sequencer(piece, tables, options.sampleRate);
    this.seq = seq;
    const a = arrangementOf(piece, kind);
    this.arrangement = a.art;
    this.intro = a.folge.slice(0, a.loopAb);
    this.body = a.folge.slice(a.loopAb);
    this.preroll = this.body.length > 0 ? prerollPatterns(seq, this.body, PREROLL_SECONDS) : [];
    let introSamples = 0;
    for (const id of this.intro) introSamples += seq.patternSamples(id);
    let length = introSamples;
    for (const id of this.body) length += seq.patternSamples(id);
    let tail = 0;
    if (this.body.length === 0) {
      // Played once: measure the tail with a dry run, then render into a buffer of the exact length.
      for (const id of this.intro) seq.renderPattern(id, null, 0);
      tail = seq.renderTail(Math.round(TAIL_MAX_SECONDS * seq.sampleRate), null, 0);
      length += tail;
      seq.reset();
    }
    this.introSamples = introSamples;
    this.tail = tail;
    this.lengthSamples = length;
    this.stems = seq.layers.map(() => ({ data: new Float32Array(2 * length), length }));
    this.phase = this.intro.length > 0 ? 'intro' : this.body.length > 0 ? 'preroll' : 'tail';
  }

  /** Whether the render is complete. */
  get done(): boolean {
    return this.phase === 'done';
  }

  /** One step; returns whether more remain. */
  step(): boolean {
    const seq = this.seq;
    switch (this.phase) {
      case 'intro':
        this.at += seq.renderPattern(this.intro[this.index] as string, this.stems, this.at);
        if (++this.index >= this.intro.length) this.next(this.body.length > 0 ? 'preroll' : 'tail');
        break;
      case 'preroll':
        if (this.index === 0) seq.reset();
        if (this.index < this.preroll.length) seq.renderPattern(this.preroll[this.index] as string, null, 0);
        if (++this.index >= this.preroll.length) this.next('body');
        break;
      case 'body':
        this.at += seq.renderPattern(this.body[this.index] as string, this.stems, this.at);
        if (++this.index >= this.body.length) this.next('measure');
        break;
      case 'tail':
        seq.renderTail(this.tail, this.stems, this.at);
        this.next('measure');
        break;
      case 'measure':
        this.measure();
        break;
      case 'scale':
        this.scale();
        break;
      case 'done':
        return false;
    }
    return !this.done;
  }

  /** Runs every remaining step. */
  run(): RenderedPiece {
    while (this.step());
    return this.result();
  }

  /** The rendered piece (after the last step). */
  result(): RenderedPiece {
    if (this.phase !== 'done') throw new Error(`music: render of "${this.piece.id}" is not finished`);
    const out: Partial<Record<MusicLayer, Float32Array>> = {};
    this.seq.layers.forEach((layer, i) => {
      out[layer] = (this.stems[i] as StemOut).data;
    });
    const loops = this.body.length > 0;
    return { piece: this.piece.id, arrangement: this.arrangement, sampleRate: this.seq.sampleRate, loopStartSample: loops ? this.introSamples : this.lengthSamples, lengthSamples: this.lengthSamples, channels: 2, stems: out };
  }

  private next(phase: JobPhase): void {
    this.phase = phase;
    this.index = 0;
    this.frame = 0;
  }

  /** Level of the mix (RMS and peak over all stems), a slice per step. */
  private measure(): void {
    const len = this.lengthSamples;
    const end = Math.min(len, this.frame + NORMALIZE_STEP_FRAMES);
    for (let i = this.frame; i < end; i++) {
      let l = 0;
      let r = 0;
      for (const s of this.stems) {
        l += s.data[i] as number;
        r += s.data[len + i] as number;
      }
      this.sum += l * l + r * r;
      const a = Math.max(Math.abs(l), Math.abs(r));
      if (a > this.peak) this.peak = a;
    }
    this.frame = end;
    if (end < len) return;
    // One gain for every stem: the mix at MUSIC_LOUDNESS RMS, its peak at most MUSIC_PEAK_CEILING.
    const rms = len === 0 ? 0 : Math.sqrt(this.sum / (2 * len));
    this.gain = this.peak <= 0 || rms <= 0 ? 1 : Math.min(MUSIC_LOUDNESS / rms, MUSIC_PEAK_CEILING / this.peak);
    this.next('scale');
  }

  private scale(): void {
    const len = this.lengthSamples;
    const end = Math.min(len, this.frame + NORMALIZE_STEP_FRAMES);
    const g = this.gain;
    for (const s of this.stems) {
      for (let i = this.frame; i < end; i++) {
        s.data[i] = (s.data[i] as number) * g;
        s.data[len + i] = (s.data[len + i] as number) * g;
      }
    }
    this.frame = end;
    if (end >= len) this.next('done');
  }
}

/**
 * Renders arrangement `kind` of `piece` (see module comment). `tables`: the wavetables by id. The stems are planar stereo
 * (`[L…, R…]`, `channels` 2).
 */
export function renderPiece(piece: MusicPiece, kind: MusicArrangementKind, tables: ReadonlyMap<string, readonly number[]>, options: RenderPieceOptions = {}): RenderedPiece {
  return new PieceRender(piece, kind, tables, options).run();
}

/**
 * Renders the patterns `ids` of `piece` one after the other from silence, without normalisation (tests: the timing of a
 * pattern, the seam around a loop point, the hash of a short excerpt).
 */
export function renderPatterns(piece: MusicPiece, ids: readonly string[], tables: ReadonlyMap<string, readonly number[]>, options: RenderPieceOptions = {}): RenderedPiece {
  const seq = new Sequencer(piece, tables, options.sampleRate);
  let length = 0;
  for (const id of ids) length += seq.patternSamples(id);
  const stems: StemOut[] = seq.layers.map(() => ({ data: new Float32Array(2 * length), length }));
  let at = 0;
  for (const id of ids) at += seq.renderPattern(id, stems, at);
  const out: Partial<Record<MusicLayer, Float32Array>> = {};
  seq.layers.forEach((layer, i) => {
    out[layer] = (stems[i] as StemOut).data;
  });
  return { piece: piece.id, arrangement: 'standard', sampleRate: seq.sampleRate, loopStartSample: length, lengthSamples: length, channels: 2, stems: out };
}

/** FNV-1a over the bits of every stem (in layer order) – the identity of a render (Node vs worker). */
export function renderHash(r: Pick<RenderedPiece, 'stems'>): string {
  let h = 0x811c9dc5;
  for (const layer of MUSIC_LAYERS) {
    const s = r.stems[layer];
    if (s === undefined) continue;
    const bytes = new Uint8Array(s.buffer, s.byteOffset, s.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i] as number;
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
