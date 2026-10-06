/**
 * Where the music comes from in the browser (M7-03; docs/SPIEL.md §24 "im Browser im Worker (`music.worker.ts`,
 * Transferable)"): `MusicBank` asks the music worker for an arrangement, receives its stems (transferred, no copy) and
 * moves them into Web Audio buffers in slices of `UPLOAD_FRAMES_PER_FRAME` per rendered frame – a two-minute piece never
 * blocks the main thread (E2E tests/e2e/musik.spec.ts: no long task over 16 ms while the title music starts). Without a
 * worker the same render job runs in small steps on the main thread (`FALLBACK_STEPS_PER_FRAME`).
 *
 * The bank keeps buffers up to `MUSIC_BUFFER_BUDGET_BYTES` (the least recently used arrangements that do not play give way:
 * a piece of 100 s in three stereo stems at 32 kHz holds 77 MB of float samples; a stinger 1–4 MB). The playing deck, the
 * one fading out, the player's song and the stingers are always kept (`frame(keep)`).
 */
import { MUSIC_LAYERS, type MusicArrangementKind, type MusicLayer } from '../../content/music/schema';
import type { AudioBufferLike, AudioContextLike } from '../webAudio';
import { createMusicLibrary, type MusicLibrary } from './library';
import type { MusicRenderRequest, MusicRenderResult } from './protocol';
import { PieceRender } from './render';
import type { RenderedPiece } from './types';

/** Frames copied into Web Audio buffers per rendered frame (all stems together). */
export const UPLOAD_FRAMES_PER_FRAME = 1 << 17;
/** Render steps per frame without a worker (one pattern each). */
export const FALLBACK_STEPS_PER_FRAME = 1;
/** Sample memory the bank may hold beyond what plays [bytes] (two full pieces and the short ones). */
export const MUSIC_BUFFER_BUDGET_BYTES = 192 * 1024 * 1024;
/** Bytes of one float sample. */
const SAMPLE_BYTES = 4;

/** An arrangement ready to play. */
export interface LoadedPiece {
  /** The bank key (`musicKey`). */
  readonly key: string;
  readonly piece: string;
  readonly arrangement: MusicArrangementKind;
  readonly buffers: Readonly<Partial<Record<MusicLayer, AudioBufferLike>>>;
  /** Loop start and end [s]; `loops` false: played once. */
  readonly loopStart: number;
  readonly loopEnd: number;
  readonly loops: boolean;
  readonly duration: number;
}

/** The part of a `Worker` the bank uses. */
export interface MusicWorkerLike {
  onmessage: ((ev: MessageEvent<MusicRenderResult>) => unknown) | null;
  postMessage(message: MusicRenderRequest): void;
}

interface Entry {
  readonly key: string;
  readonly piece: string;
  readonly arrangement: MusicArrangementKind;
  /** Requested and not yet rendered. */
  rendered: RenderedPiece | null;
  /** Upload progress: buffers created, frames copied. */
  buffers: Partial<Record<MusicLayer, AudioBufferLike>> | null;
  uploaded: number;
  loaded: LoadedPiece | null;
  lastUse: number;
  /** A render job on the main thread (no worker). */
  job: PieceRender | null;
  failed: boolean;
  /** Sample memory of the rendered stems or buffers [bytes] (0 until rendered). */
  bytes: number;
}

function keyOf(piece: string, arrangement: MusicArrangementKind): string {
  return `${piece}/${arrangement}`;
}

export interface MusicBankOptions {
  /** Starts the music worker; `null`: render on the main thread in small steps. */
  readonly createWorker: (() => MusicWorkerLike) | null;
  /** The pieces for the main-thread fallback (default: the game's content). */
  readonly library?: MusicLibrary;
  /** Sample memory beyond what plays (default `MUSIC_BUFFER_BUDGET_BYTES`). */
  readonly budgetBytes?: number;
}

export class MusicBank {
  /** Entries by piece and arrangement (no key string built per lookup). */
  private readonly entries = new Map<string, Map<MusicArrangementKind, Entry>>();
  /** The entries in request order (indexed loops: no iterator per frame). */
  private readonly list: Entry[] = [];
  private readonly byRequest = new Map<number, Entry>();
  private worker: MusicWorkerLike | null = null;
  private nextRequest = 1;
  private clock = 0;
  private library: MusicLibrary | null;
  private readonly budget: number;

  constructor(
    private readonly ctx: AudioContextLike,
    options: MusicBankOptions,
  ) {
    this.library = options.library ?? null;
    this.budget = options.budgetBytes ?? MUSIC_BUFFER_BUDGET_BYTES;
    if (options.createWorker !== null) {
      try {
        this.worker = options.createWorker();
        this.worker.onmessage = (ev) => this.received(ev.data);
      } catch {
        this.worker = null;
      }
    }
  }

  /** The arrangement if it is loaded (marks it used); otherwise asks for it and returns null. */
  get(piece: string, arrangement: MusicArrangementKind): LoadedPiece | null {
    let e = this.find(piece, arrangement);
    if (e === undefined) {
      e = { key: keyOf(piece, arrangement), piece, arrangement, rendered: null, buffers: null, uploaded: 0, loaded: null, lastUse: 0, job: null, failed: false, bytes: 0 };
      let byArrangement = this.entries.get(piece);
      if (byArrangement === undefined) {
        byArrangement = new Map();
        this.entries.set(piece, byArrangement);
      }
      byArrangement.set(arrangement, e);
      this.list.push(e);
      this.request(e);
    }
    e.lastUse = ++this.clock;
    return e.loaded;
  }

  /** Asks for an arrangement ahead of time (stingers, the next piece). */
  prepare(piece: string, arrangement: MusicArrangementKind): void {
    this.get(piece, arrangement);
  }

  /** Whether the arrangement is loaded. */
  isLoaded(piece: string, arrangement: MusicArrangementKind): boolean {
    return this.find(piece, arrangement)?.loaded != null;
  }

  private find(piece: string, arrangement: MusicArrangementKind): Entry | undefined {
    return this.entries.get(piece)?.get(arrangement);
  }

  /** Once per frame: steps a main-thread render and uploads a slice of rendered stems; frees the least used. */
  frame(keep: ReadonlySet<string>): void {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i] as Entry;
      if (e.job !== null) {
        for (let k = 0; k < FALLBACK_STEPS_PER_FRAME && e.job.step(); k++);
        if (e.job.done) {
          this.rendered(e, e.job.result());
          e.job = null;
        }
        break;
      }
    }
    let budget = UPLOAD_FRAMES_PER_FRAME;
    for (let i = 0; i < list.length; i++) {
      const e = list[i] as Entry;
      if (budget <= 0) break;
      if (e.rendered !== null && e.loaded === null) budget -= this.upload(e, budget);
    }
    this.evict(keep);
  }

  // -------------------------------------------------------------------------------------------

  private request(e: Entry): void {
    if (this.worker !== null) {
      const id = this.nextRequest++;
      this.byRequest.set(id, e);
      this.worker.postMessage({ id, piece: e.piece, arrangement: e.arrangement });
      return;
    }
    this.library ??= createMusicLibrary();
    const piece = this.library.piece(e.piece);
    if (piece === undefined) e.failed = true;
    else e.job = new PieceRender(piece, e.arrangement, this.library.tables);
  }

  private received(result: MusicRenderResult): void {
    const e = this.byRequest.get(result.id);
    this.byRequest.delete(result.id);
    if (e === undefined || this.find(e.piece, e.arrangement) !== e) return;
    if ('error' in result) {
      e.failed = true;
      console.error(`Musik: ${result.error}`);
      return;
    }
    this.rendered(e, result.rendered);
  }

  private rendered(e: Entry, r: RenderedPiece): void {
    e.rendered = r;
    let stems = 0;
    for (const layer of MUSIC_LAYERS) if (r.stems[layer] !== undefined) stems++;
    e.bytes = r.lengthSamples * r.channels * stems * SAMPLE_BYTES;
  }

  /** Copies up to `budget` frames of `e` into its buffers; returns the frames copied. */
  private upload(e: Entry, budget: number): number {
    const r = e.rendered as RenderedPiece;
    const n = r.lengthSamples;
    if (e.buffers === null) {
      const buffers: Partial<Record<MusicLayer, AudioBufferLike>> = {};
      for (const layer of MUSIC_LAYERS) if (r.stems[layer] !== undefined) buffers[layer] = this.ctx.createBuffer(r.channels, n, r.sampleRate);
      e.buffers = buffers;
    }
    const layers = MUSIC_LAYERS.filter((l) => r.stems[l] !== undefined);
    const per = Math.max(1, Math.floor(budget / Math.max(1, layers.length)));
    const from = e.uploaded;
    const to = Math.min(n, from + per);
    for (const layer of layers) {
      const stem = r.stems[layer] as Float32Array;
      const buffer = e.buffers[layer] as AudioBufferLike;
      for (let ch = 0; ch < r.channels; ch++) buffer.copyToChannel(stem.subarray(ch * n + from, ch * n + to) as Float32Array<ArrayBuffer>, ch, from);
    }
    e.uploaded = to;
    if (to >= n) {
      e.loaded = {
        key: e.key,
        piece: e.piece,
        arrangement: r.arrangement,
        buffers: e.buffers,
        loopStart: r.loopStartSample / r.sampleRate,
        loopEnd: n / r.sampleRate,
        loops: r.loopStartSample < n,
        duration: n / r.sampleRate,
      };
      // The stems may go: the buffers hold the sound now.
      e.rendered = null;
    }
    return (to - from) * layers.length;
  }

  /** Frees the least recently used arrangements not in `keep` while the bank holds more than its budget. */
  private evict(keep: ReadonlySet<string>): void {
    const list = this.list;
    let bytes = this.bytes;
    while (bytes > this.budget) {
      let victim = -1;
      for (let i = 0; i < list.length; i++) {
        const e = list[i] as Entry;
        if (keep.has(e.key) || e.bytes === 0) continue;
        if (victim < 0 || e.lastUse < (list[victim] as Entry).lastUse) victim = i;
      }
      if (victim < 0) return;
      const e = list[victim] as Entry;
      this.entries.get(e.piece)?.delete(e.arrangement);
      list.splice(victim, 1);
      bytes -= e.bytes;
    }
  }

  /** Sample memory held now [bytes]. */
  get bytes(): number {
    let bytes = 0;
    for (let i = 0; i < this.list.length; i++) bytes += (this.list[i] as Entry).bytes;
    return bytes;
  }
}

/** The bank key of an arrangement (what `frame` keeps). */
export function musicKey(piece: string, arrangement: MusicArrangementKind): string {
  return keyOf(piece, arrangement);
}
