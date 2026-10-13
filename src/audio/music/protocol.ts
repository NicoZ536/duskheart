/**
 * Messages of the music worker (src/audio/music/music.worker.ts; docs/SPIEL.md §24 "im Browser im Worker (`music.worker.ts`,
 * Transferable)"): the main thread asks for an arrangement, the worker renders it with the same pure code as Node
 * (src/audio/music/render.ts), keeps it and answers with its shape (`info`); the main thread then pulls the stems slice by
 * slice (`slice`, a frame range of every layer, transferred) – one slice per rendered frame, copied into Web Audio buffers on
 * arrival and dropped. The main thread never holds a whole piece as JavaScript arrays: a 100-s piece is 50–80 MB of floats,
 * and receiving it at once makes the page's garbage collector stop the main thread (tests/e2e/musik.spec.ts). `drop`
 * forgets a render the bank no longer wants. `MusicWorkerCore` is the worker's whole job – the Node tests drive it directly
 * and compare its bits with Node's render. In the browser `PacedMusicWorker` runs its renders in turns (M7-81): a piece is a
 * second of synthesis, and right after the audio unlock it shared the cores with the software rasteriser.
 */
import { MUSIC_LAYERS, type MusicArrangementKind, type MusicLayer } from '../../content/music/schema';
import type { MusicLibrary } from './library';
import { PieceRender } from './render';
import type { RenderedPiece } from './types';

/** The shape of a rendered arrangement (a `RenderedPiece` without its stems, and the layers it has). */
export interface RenderedInfo extends Omit<RenderedPiece, 'stems'> {
  readonly layers: readonly MusicLayer[];
}

/** Main thread → worker. */
export type MusicWorkerRequest =
  | { readonly kind: 'render'; readonly id: number; readonly piece: string; readonly arrangement: MusicArrangementKind }
  | {
      readonly kind: 'slice';
      readonly id: number;
      readonly from: number;
      readonly to: number;
      /**
       * The buffers of the slice before, handed back (transferred), one per layer in layer order: the worker fills them for
       * this slice instead of fresh ones, so a piece's upload allocates once per layer, not once per slice. A page that
       * receives and drops a megabyte of array buffers per frame keeps V8 collecting in cycles – a dozen full collections
       * while the title music starts, their pauses up to 17 ms (tests/e2e/musik.spec.ts, the 16-ms budget).
       */
      readonly reuse?: readonly ArrayBuffer[];
    }
  | { readonly kind: 'drop'; readonly id: number };

/** Worker → main thread. */
export type MusicWorkerReply =
  | { readonly kind: 'info'; readonly id: number; readonly info: RenderedInfo }
  | {
      readonly kind: 'slice';
      readonly id: number;
      readonly from: number;
      readonly to: number;
      /** Per layer the frames [from, to) planar: `channels` runs of `to − from` samples. */
      readonly stems: Readonly<Partial<Record<MusicLayer, Float32Array>>>;
    }
  | { readonly kind: 'error'; readonly id: number; readonly error: string };

/** The shape of `r`. */
export function infoOf(r: RenderedPiece): RenderedInfo {
  const layers = MUSIC_LAYERS.filter((l) => r.stems[l] !== undefined);
  return { piece: r.piece, arrangement: r.arrangement, sampleRate: r.sampleRate, loopStartSample: r.loopStartSample, lengthSamples: r.lengthSamples, channels: r.channels, layers };
}

const NO_BUFFERS: readonly ArrayBuffer[] = [];

/**
 * Frames [from, to) of every stem of `r`, planar per layer (copies: they are transferred). The k-th layer's samples go into
 * the k-th of `reuse` (the buffers of the slice before, handed back) when it holds them – a shorter last slice fits the
 * buffer of a full one –, else into a fresh buffer; a buffer too small (or detached, 0 bytes) is left alone.
 */
export function sliceStems(r: RenderedPiece, from: number, to: number, reuse: readonly ArrayBuffer[] = NO_BUFFERS): Partial<Record<MusicLayer, Float32Array>> {
  const n = r.lengthSamples;
  const len = to - from;
  const out: Partial<Record<MusicLayer, Float32Array>> = {};
  let k = 0;
  for (const layer of MUSIC_LAYERS) {
    const s = r.stems[layer];
    if (s === undefined) continue;
    const samples = r.channels * len;
    const spare = reuse[k++];
    const part = spare !== undefined && spare.byteLength >= samples * Float32Array.BYTES_PER_ELEMENT ? new Float32Array(spare, 0, samples) : new Float32Array(samples);
    for (let ch = 0; ch < r.channels; ch++) part.set(s.subarray(ch * n + from, ch * n + to), ch * len);
    out[layer] = part;
  }
  return out;
}

/** A render request. */
export type MusicRenderRequest = Extract<MusicWorkerRequest, { readonly kind: 'render' }>;

/** The worker's job: renders on request, keeps the render until its last slice was taken or it is dropped. */
export class MusicWorkerCore {
  private readonly held = new Map<number, RenderedPiece>();

  constructor(private readonly library: MusicLibrary) {}

  /** Renders kept for slicing (tests: a finished transfer leaves none). */
  get pending(): number {
    return this.held.size;
  }

  /** Answers `req` (null: nothing to answer). */
  handle(req: MusicWorkerRequest): MusicWorkerReply | null {
    switch (req.kind) {
      case 'render': {
        const begun = this.begin(req);
        if (begun instanceof PieceRender) {
          while (begun.step());
          return this.finish(req.id, begun);
        }
        return begun;
      }
      case 'slice': {
        const r = this.held.get(req.id);
        if (r === undefined) return { kind: 'error', id: req.id, error: `Musik: kein Render ${req.id}` };
        const from = Math.max(0, Math.min(req.from, r.lengthSamples));
        const to = Math.max(from, Math.min(req.to, r.lengthSamples));
        if (to >= r.lengthSamples) this.held.delete(req.id);
        return { kind: 'slice', id: req.id, from, to, stems: sliceStems(r, from, to, req.reuse ?? NO_BUFFERS) };
      }
      case 'drop':
        this.held.delete(req.id);
        return null;
    }
  }

  /** The render job of `req` (`PieceRender`, to be stepped), or the error reply for a piece the library does not know. */
  begin(req: MusicRenderRequest): PieceRender | MusicWorkerReply {
    const piece = this.library.piece(req.piece);
    if (piece === undefined) return { kind: 'error', id: req.id, error: `unbekanntes Musikstück „${req.piece}“` };
    return new PieceRender(piece, req.arrangement, this.library.tables);
  }

  /** Keeps the finished `job` of request `id` for its slices; the reply is its shape. */
  finish(id: number, job: PieceRender): MusicWorkerReply {
    const r = job.result();
    this.held.set(id, r);
    return { kind: 'info', id, info: infoOf(r) };
  }
}

/**
 * Work per turn of a paced render and the shortest rest after it [ms] (M7-81): a turn rests at least as long as it worked,
 * so a render takes about half a core – right after the unlock the first piece (0.7–0.9 s of synthesis, 1.8 s on a loaded
 * machine) took a whole one, and in a trace of `spieler-bewegung.spec.ts` the software rasteriser drew no frame for 1.6 s
 * meanwhile. A step is a whole pattern (50–250 ms in the browser), so the rest follows the time the turn took.
 */
export const MUSIC_RENDER_TURN_MS = 12;
export const MUSIC_RENDER_REST_MS = 12;

/**
 * The music worker's loop in the browser (M7-81): a render request becomes a job (`MusicWorkerCore.begin`) that steps – one
 * pattern a step (`PieceRender.step`) – for `MUSIC_RENDER_TURN_MS`, then rests as long as the turn took, at least
 * `MUSIC_RENDER_REST_MS`; renders run one
 * after the other in the order asked for, the info is sent when a job is done (`finish`). Slices and drops are answered at
 * once; a drop also forgets a job that has not finished. The bits are the core's: the same `PieceRender`, run in steps.
 * `schedule` and `now` are the worker's timer and clock (tests: by hand).
 */
export class PacedMusicWorker {
  private readonly jobs: { readonly id: number; readonly job: PieceRender }[] = [];
  private scheduled = false;

  constructor(
    private readonly core: MusicWorkerCore,
    private readonly post: (reply: MusicWorkerReply) => void,
    private readonly schedule: (fn: () => void, ms: number) => void,
    private readonly now: () => number,
  ) {}

  /** Jobs not finished yet (tests). */
  get waiting(): number {
    return this.jobs.length;
  }

  /** Takes a request of the main thread. */
  handle(req: MusicWorkerRequest): void {
    if (req.kind === 'render') {
      const begun = this.core.begin(req);
      if (!(begun instanceof PieceRender)) {
        this.post(begun);
        return;
      }
      this.jobs.push({ id: req.id, job: begun });
      this.wake(0);
      return;
    }
    if (req.kind === 'drop') {
      const i = this.jobs.findIndex((j) => j.id === req.id);
      if (i >= 0) this.jobs.splice(i, 1);
    }
    const reply = this.core.handle(req);
    if (reply !== null) this.post(reply);
  }

  private wake(ms: number): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(this.turn, ms);
  }

  /** One turn: steps the jobs in order until the turn's time is used, then rests as long as it worked (when work is left). */
  private readonly turn = (): void => {
    this.scheduled = false;
    const start = this.now();
    let used = 0;
    while (this.jobs.length > 0) {
      const head = this.jobs[0] as { readonly id: number; readonly job: PieceRender };
      if (!head.job.step()) {
        this.jobs.shift();
        this.post(this.core.finish(head.id, head.job));
      }
      used = this.now() - start;
      if (used >= MUSIC_RENDER_TURN_MS) break;
    }
    if (this.jobs.length > 0) this.wake(used > MUSIC_RENDER_REST_MS ? used : MUSIC_RENDER_REST_MS);
  };
}

/** The buffers of a reply to transfer (a slice's stems). */
export function transferablesOf(reply: MusicWorkerReply | null): ArrayBuffer[] {
  if (reply === null || reply.kind !== 'slice') return [];
  const out: ArrayBuffer[] = [];
  for (const layer of MUSIC_LAYERS) {
    const s = reply.stems[layer];
    if (s !== undefined) out.push(s.buffer as ArrayBuffer);
  }
  return out;
}
