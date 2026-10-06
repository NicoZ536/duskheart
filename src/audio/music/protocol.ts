/**
 * Messages of the music worker (src/audio/music/music.worker.ts; docs/SPIEL.md §24 "im Browser im Worker (`music.worker.ts`,
 * Transferable)"): the main thread asks for an arrangement of a piece, the worker renders it with the same pure code as
 * Node (src/audio/music/render.ts) and transfers the stems back. `handleMusicRequest` is the worker's whole job – the Node
 * tests call it directly and compare its hash with the worker's.
 */
import type { MusicArrangementKind } from '../../content/music/schema';
import type { MusicLibrary } from './library';
import { renderPiece } from './render';
import type { RenderedPiece } from './types';

/** Main thread → worker: render this arrangement. */
export interface MusicRenderRequest {
  /** Request number (answers carry it). */
  readonly id: number;
  readonly piece: string;
  readonly arrangement: MusicArrangementKind;
}

/** Worker → main thread: the rendered piece, or why not. */
export type MusicRenderResult = { readonly id: number; readonly rendered: RenderedPiece } | { readonly id: number; readonly error: string };

/** Renders `req` from `library`. */
export function handleMusicRequest(req: MusicRenderRequest, library: MusicLibrary): MusicRenderResult {
  const piece = library.piece(req.piece);
  if (piece === undefined) return { id: req.id, error: `unbekanntes Musikstück „${req.piece}“` };
  return { id: req.id, rendered: renderPiece(piece, req.arrangement, library.tables) };
}

/** The buffers of a result to transfer (its stems). */
export function transferablesOf(result: MusicRenderResult): ArrayBuffer[] {
  if (!('rendered' in result)) return [];
  const out: ArrayBuffer[] = [];
  for (const s of Object.values(result.rendered.stems)) if (s !== undefined) out.push(s.buffer as ArrayBuffer);
  return out;
}
