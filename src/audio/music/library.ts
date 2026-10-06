/**
 * The pieces the music renderer knows (src/content/music): validated once with their schemas, the wavetables by id. The
 * worker and the Node tests build the same library from the same content, so a request names a piece by id and both sides
 * render the same bits (docs/SPIEL.md §28 "Musik-Rendering: Node und Worker bitgleich").
 */
import { MUSIC_PIECES, WAVETABLES, musicPieceSchema, wavetableSchema, type MusicPiece, type MusicPieceInput, type WavetableInput } from '../../content/music/index';

export interface MusicLibrary {
  /** The validated piece `id`, or undefined. */
  piece(id: string): MusicPiece | undefined;
  /** Every wavetable by id. */
  readonly tables: ReadonlyMap<string, readonly number[]>;
}

/** A library of `pieces` and `tables` (default: the game's content); pieces are validated on first use. */
export function createMusicLibrary(pieces: readonly MusicPieceInput[] = MUSIC_PIECES, tables: readonly WavetableInput[] = WAVETABLES): MusicLibrary {
  const raw = new Map(pieces.map((p) => [p.id, p]));
  const parsed = new Map<string, MusicPiece>();
  const tableMap = new Map(tables.map((t) => [t.id, wavetableSchema.parse(t).werte]));
  return {
    piece(id) {
      const cached = parsed.get(id);
      if (cached !== undefined) return cached;
      const r = raw.get(id);
      if (r === undefined) return undefined;
      const p = musicPieceSchema.parse(r);
      parsed.set(id, p);
      return p;
    },
    tables: tableMap,
  };
}
