/**
 * Where the music comes from in the browser (M7-03; docs/SPIEL.md §24 "im Browser im Worker (`music.worker.ts`,
 * Transferable)"): `MusicBank` asks the music worker for an arrangement, learns its shape (`info`) and pulls its stems slice by
 * slice – one slice of `UPLOAD_FRAMES_PER_FRAME` frames (all layers together) per rendered frame, transferred, copied into the
 * Web Audio buffers on arrival and dropped (src/audio/music/protocol.ts). The buffers themselves are created one layer per
 * frame. So a two-minute piece never lands on the main thread as one 50–80 MB message (whose arrival makes the garbage
 * collector stop the page; E2E tests/e2e/musik.spec.ts: no main-thread task over 16 ms while the title music starts).
 * Without a worker the same render job runs in small steps on the main thread (`FALLBACK_STEPS_PER_FRAME`) and its stems are
 * copied in the same slices.
 *
 * The bank keeps buffers up to `MUSIC_BUFFER_BUDGET_BYTES` (the least recently used arrangements that do not play give way:
 * a piece of 100 s in three stereo stems at 32 kHz holds 77 MB of float samples; a stinger 1–4 MB). The playing deck, the
 * one fading out, the player's song and the stingers are always kept (`frame(keep)`).
 */
import type { MusicArrangementKind, MusicLayer } from '../../content/music/schema';
import type { AudioBufferLike, AudioContextLike } from '../webAudio';
import { createMusicLibrary, type MusicLibrary } from './library';
import { infoOf, type MusicWorkerReply, type MusicWorkerRequest, type RenderedInfo } from './protocol';
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
  onmessage: ((ev: MessageEvent<MusicWorkerReply>) => unknown) | null;
  postMessage(message: MusicWorkerRequest): void;
}

interface Entry {
  readonly key: string;
  readonly piece: string;
  readonly arrangement: MusicArrangementKind;
  /** The worker's request number (0: rendered on the main thread). */
  id: number;
  /** The rendered shape (null until the worker answered or the job finished). */
  info: RenderedInfo | null;
  /** A main-thread render's stems, sliced from here (null with a worker, and once uploaded). */
  stems: RenderedPiece | null;
  /** Upload progress: the buffers created so far, frames copied, a slice asked of the worker. */
  buffers: Partial<Record<MusicLayer, AudioBufferLike>> | null;
  made: number;
  uploaded: number;
  inFlight: boolean;
  loaded: LoadedPiece | null;
  lastUse: number;
  /** A render job on the main thread (no worker). */
  job: PieceRender | null;
  failed: boolean;
  /** Sample memory of the arrangement's buffers [bytes] (0 until its shape is known). */
  bytes: number;
}

function keyOf(piece: string, arrangement: MusicArrangementKind): string {
  return `${piece}/${arrangement}`;
}

/** What the bank asks of the keys to keep (a `Set`, or the frame's held `KeepList`). */
export type KeepKeys = Pick<ReadonlySet<string>, 'has'>;

/**
 * The bank keys kept this frame (the playing deck, the one fading, the song, the stingers): a held list refilled every frame
 * – a `Set` cleared and filled anew allocates its table each frame (200 B).
 */
export class KeepList implements KeepKeys {
  private readonly keys: string[] = [];
  private n = 0;

  clear(): void {
    this.n = 0;
  }

  add(key: string): void {
    if (this.has(key)) return;
    if (this.n < this.keys.length) this.keys[this.n] = key;
    else this.keys.push(key);
    this.n++;
  }

  has(key: string): boolean {
    for (let i = 0; i < this.n; i++) if (this.keys[i] === key) return true;
    return false;
  }
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
      e = { key: keyOf(piece, arrangement), piece, arrangement, id: 0, info: null, stems: null, buffers: null, made: 0, uploaded: 0, inFlight: false, loaded: null, lastUse: 0, job: null, failed: false, bytes: 0 };
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
    const e = this.find(piece, arrangement);
    return e !== undefined && e.loaded !== null;
  }

  private find(piece: string, arrangement: MusicArrangementKind): Entry | undefined {
    return this.entries.get(piece)?.get(arrangement);
  }

  /**
   * Once per frame: steps a main-thread render; creates one buffer or moves one slice of stems towards the buffers (in
   * request order, `UPLOAD_FRAMES_PER_FRAME` frames in all); frees the least used.
   */
  frame(keep: KeepKeys): void {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i] as Entry;
      if (e.job !== null) {
        for (let k = 0; k < FALLBACK_STEPS_PER_FRAME && e.job.step(); k++);
        if (e.job.done) {
          const r = e.job.result();
          e.job = null;
          e.stems = r;
          this.shaped(e, infoOf(r));
        }
        break;
      }
    }
    let budget = UPLOAD_FRAMES_PER_FRAME;
    for (let i = 0; i < list.length && budget > 0; i++) {
      const e = list[i] as Entry;
      if (e.info === null || e.loaded !== null || e.failed) continue;
      budget = this.advance(e, budget);
    }
    this.evict(keep);
  }

  // -------------------------------------------------------------------------------------------

  private request(e: Entry): void {
    if (this.worker !== null) {
      e.id = this.nextRequest++;
      this.byRequest.set(e.id, e);
      this.worker.postMessage({ kind: 'render', id: e.id, piece: e.piece, arrangement: e.arrangement });
      return;
    }
    this.library ??= createMusicLibrary();
    const piece = this.library.piece(e.piece);
    if (piece === undefined) e.failed = true;
    else e.job = new PieceRender(piece, e.arrangement, this.library.tables);
  }

  private received(reply: MusicWorkerReply): void {
    const e = this.byRequest.get(reply.id);
    if (e === undefined || this.find(e.piece, e.arrangement) !== e) {
      // An arrangement the bank gave up meanwhile: the worker may forget it.
      this.byRequest.delete(reply.id);
      if (reply.kind === 'info') this.worker?.postMessage({ kind: 'drop', id: reply.id });
      return;
    }
    switch (reply.kind) {
      case 'error':
        this.byRequest.delete(reply.id);
        e.failed = true;
        console.error(`Musik: ${reply.error}`);
        return;
      case 'info':
        this.shaped(e, reply.info);
        return;
      case 'slice': {
        e.inFlight = false;
        const info = e.info as RenderedInfo;
        const buffers = e.buffers as Partial<Record<MusicLayer, AudioBufferLike>>;
        const len = reply.to - reply.from;
        for (const layer of info.layers) {
          const part = reply.stems[layer] as Float32Array;
          const buffer = buffers[layer] as AudioBufferLike;
          for (let ch = 0; ch < info.channels; ch++) buffer.copyToChannel(part.subarray(ch * len, (ch + 1) * len) as Float32Array<ArrayBuffer>, ch, reply.from);
        }
        e.uploaded = reply.to;
        if (e.uploaded >= info.lengthSamples) {
          this.byRequest.delete(reply.id);
          this.complete(e, info);
        }
        return;
      }
    }
  }

  /** The arrangement's shape is known: its buffers' memory counts from now. */
  private shaped(e: Entry, info: RenderedInfo): void {
    e.info = info;
    e.bytes = info.lengthSamples * info.channels * info.layers.length * SAMPLE_BYTES;
  }

  /**
   * One step of the upload of `e` with `budget` frames left this frame; returns what is left. A missing buffer is created
   * first (one per frame – a 100-s stereo buffer is 26 MB); then a slice is asked of the worker (one at a time) or copied
   * from the main-thread render.
   */
  private advance(e: Entry, budget: number): number {
    const info = e.info as RenderedInfo;
    const layers = info.layers;
    if (e.buffers === null) e.buffers = {};
    if (e.made < layers.length) {
      const layer = layers[e.made] as MusicLayer;
      e.buffers[layer] = this.ctx.createBuffer(info.channels, info.lengthSamples, info.sampleRate);
      e.made++;
      return 0;
    }
    const n = info.lengthSamples;
    const per = Math.max(1, Math.floor(budget / Math.max(1, layers.length)));
    const from = e.uploaded;
    const to = Math.min(n, from + per);
    if (e.stems === null) {
      // The worker's render: one slice in flight at a time, copied when it arrives.
      if (e.inFlight || this.worker === null) return budget;
      e.inFlight = true;
      this.worker.postMessage({ kind: 'slice', id: e.id, from, to });
      return budget - (to - from) * layers.length;
    }
    const r = e.stems;
    for (const layer of layers) {
      const stem = r.stems[layer] as Float32Array;
      const buffer = e.buffers[layer] as AudioBufferLike;
      for (let ch = 0; ch < info.channels; ch++) buffer.copyToChannel(stem.subarray(ch * n + from, ch * n + to) as Float32Array<ArrayBuffer>, ch, from);
    }
    e.uploaded = to;
    if (to >= n) {
      // The stems may go: the buffers hold the sound now.
      e.stems = null;
      this.complete(e, info);
    }
    return budget - (to - from) * layers.length;
  }

  private complete(e: Entry, info: RenderedInfo): void {
    const n = info.lengthSamples;
    e.loaded = {
      key: e.key,
      piece: e.piece,
      arrangement: info.arrangement,
      buffers: e.buffers as Partial<Record<MusicLayer, AudioBufferLike>>,
      loopStart: info.loopStartSample / info.sampleRate,
      loopEnd: n / info.sampleRate,
      loops: info.loopStartSample < n,
      duration: n / info.sampleRate,
    };
  }

  /** Frees the least recently used arrangements not in `keep` while the bank holds more than its budget. */
  private evict(keep: KeepKeys): void {
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
      // A transfer still running: the worker forgets its render.
      if (e.id !== 0 && e.loaded === null && this.byRequest.delete(e.id)) this.worker?.postMessage({ kind: 'drop', id: e.id });
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
