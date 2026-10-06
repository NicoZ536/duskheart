/**
 * Messages of the music worker (src/audio/music/music.worker.ts; docs/SPIEL.md §24 "im Browser im Worker (`music.worker.ts`,
 * Transferable)"): the main thread asks for an arrangement, the worker renders it with the same pure code as Node
 * (src/audio/music/render.ts), keeps it and answers with its shape (`info`); the main thread then pulls the stems slice by
 * slice (`slice`, a frame range of every layer, transferred) – one slice per rendered frame, copied into Web Audio buffers on
 * arrival and dropped. The main thread never holds a whole piece as JavaScript arrays: a 100-s piece is 50–80 MB of floats,
 * and receiving it at once makes the page's garbage collector stop the main thread (tests/e2e/musik.spec.ts). `drop`
 * forgets a render the bank no longer wants. `MusicWorkerCore` is the worker's whole job – the Node tests drive it directly
 * and compare its bits with Node's render.
 */
import { MUSIC_LAYERS, type MusicArrangementKind, type MusicLayer } from '../../content/music/schema';
import type { MusicLibrary } from './library';
import { renderPiece } from './render';
import type { RenderedPiece } from './types';

/** The shape of a rendered arrangement (a `RenderedPiece` without its stems, and the layers it has). */
export interface RenderedInfo extends Omit<RenderedPiece, 'stems'> {
  readonly layers: readonly MusicLayer[];
}

/** Main thread → worker. */
export type MusicWorkerRequest =
  | { readonly kind: 'render'; readonly id: number; readonly piece: string; readonly arrangement: MusicArrangementKind }
  | { readonly kind: 'slice'; readonly id: number; readonly from: number; readonly to: number }
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

/** Frames [from, to) of every stem of `r`, planar per layer (copies: they are transferred). */
export function sliceStems(r: RenderedPiece, from: number, to: number): Partial<Record<MusicLayer, Float32Array>> {
  const n = r.lengthSamples;
  const len = to - from;
  const out: Partial<Record<MusicLayer, Float32Array>> = {};
  for (const layer of MUSIC_LAYERS) {
    const s = r.stems[layer];
    if (s === undefined) continue;
    const part = new Float32Array(r.channels * len);
    for (let ch = 0; ch < r.channels; ch++) part.set(s.subarray(ch * n + from, ch * n + to), ch * len);
    out[layer] = part;
  }
  return out;
}

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
        const piece = this.library.piece(req.piece);
        if (piece === undefined) return { kind: 'error', id: req.id, error: `unbekanntes Musikstück „${req.piece}“` };
        const r = renderPiece(piece, req.arrangement, this.library.tables);
        this.held.set(req.id, r);
        return { kind: 'info', id: req.id, info: infoOf(r) };
      }
      case 'slice': {
        const r = this.held.get(req.id);
        if (r === undefined) return { kind: 'error', id: req.id, error: `Musik: kein Render ${req.id}` };
        const from = Math.max(0, Math.min(req.from, r.lengthSamples));
        const to = Math.max(from, Math.min(req.to, r.lengthSamples));
        if (to >= r.lengthSamples) this.held.delete(req.id);
        return { kind: 'slice', id: req.id, from, to, stems: sliceStems(r, from, to) };
      }
      case 'drop':
        this.held.delete(req.id);
        return null;
    }
  }
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
