/**
 * Music (docs/SPIEL.md §24 "Tracker/Sequencer", MASTERPROMPT §27; ADR-0175; strand A – collections `music` (§C
 * "Musikstücke", only `zaehlt`), `stingers`, `songs`, `wavetables`): pieces in tracker notation – instruments, patterns,
 * arrangements per day and night, layers as stems, an SNES-like echo – rendered by the own synth in Node and in the worker
 * bit-identically. The zod schemas producing these types are strand A's.
 */
import type { LocalizedText } from '../schema/common';

export const TRACKER_WAVES = ['rechteck', 'dreieck', 'saege', 'rauschen', 'fm', 'wavetable'] as const;
export type TrackerWave = (typeof TRACKER_WAVES)[number];
export const MUSIC_LAYERS = ['basis', 'melodie', 'gefahr'] as const;
export type MusicLayer = (typeof MUSIC_LAYERS)[number];
export const MUSIC_ARRANGEMENTS = ['standard', 'tag', 'nacht'] as const;
export type MusicArrangementKind = (typeof MUSIC_ARRANGEMENTS)[number];
export interface TrackerInstrument {
  readonly id: string;
  readonly welle: TrackerWave;
  readonly tastgrad?: number;
  readonly fm?: { readonly verhaeltnis: number; readonly index: number };
  readonly tabelle?: string;
  /** ADSR [s, s, 0–1, s]. */
  readonly huellkurve: readonly [number, number, number, number];
  readonly pegel: number;
  readonly pan: number;
  readonly echoSend: number;
}
/**
 * One pattern in tracker notation: `zeilen[r]` holds one cell per channel separated by `|`; a cell is `NOT II VV FXX`
 * (note `C-4`/`C#4`, `---` none, `===` off; instrument index hex; volume 00–40 hex; effect letter + parameter:
 * `0xy` arpeggio, `3xx` portamento, `4xy` vibrato, `Exx` echo send, `...` none). Parsed by src/audio/music/notation.ts.
 */
export interface TrackerPattern {
  readonly id: string;
  readonly kanaele: number;
  readonly zeilen: readonly string[];
}
export interface MusicArrangement {
  readonly art: MusicArrangementKind;
  readonly folge: readonly string[];
  readonly loopAb: number;
}
export interface MusicPiece {
  readonly id: string;
  readonly titel: LocalizedText;
  readonly bpm: number;
  readonly zeilenJeSchlag: number;
  readonly instrumente: readonly TrackerInstrument[];
  readonly patterns: readonly TrackerPattern[];
  readonly arrangements: readonly MusicArrangement[];
  /** Channels per layer (each layer becomes one stem). */
  readonly schichten: Readonly<Record<MusicLayer, readonly number[]>>;
  /** SNES-like echo: delay, feedback, 8-tap FIR, level. */
  readonly echo: { readonly verzoegerungMs: number; readonly rueckkopplung: number; readonly fir: readonly number[]; readonly pegel: number };
  /** Counts towards §C "Musikstücke" (false for stingers and player songs). */
  readonly zaehlt: boolean;
}
export interface StingerDef {
  readonly id: string;
  readonly stueck: string;
  readonly duckDb: number;
}
export interface SongDef {
  readonly id: string;
  readonly name: LocalizedText;
  readonly stueck: string;
  readonly instrument: string;
}
export interface WavetableDef {
  readonly id: string;
  readonly werte: readonly number[];
}
