/**
 * Tracker notation of the music patterns (docs/SPIEL.md §24 "Tracker-Notation je Zeile"; MASTERPROMPT §27 "eigener
 * Tracker/Sequencer (Patterns …)"). A row holds one cell per channel, separated by `|`; a cell is `NOT II VV FXX`:
 *
 * | field | meaning |
 * |---|---|
 * | `NOT` | note `C-4`, `C#4` … `B-8` (octave 0–8), `---` nothing new (the channel keeps sounding), `===` note off (release) |
 * | `II` | instrument index into the piece's `instrumente`, hex `00`–`0F`; `..` keeps the channel's instrument |
 * | `VV` | volume `00`–`40` hex (0–64); `..` full volume on a new note, else the channel's volume |
 * | `FXX` | effect: `0xy` arpeggio (+x, +y semitones), `3xx` portamento to the note at xx/16 semitones per tick, `4xy` vibrato (speed x, depth y), `Exx` echo send xx/40 hex; `...` none |
 *
 * Every note names its instrument (no `..` beside a note): a pattern then sounds the same wherever it stands in an
 * arrangement – the renderer's loop seam and pre-roll rely on that (src/audio/music/render.ts). Parsed once into typed
 * arrays (`ParsedPattern`) that the synthesiser walks without allocating.
 *
 * Content imports only engine and content, so the parser lives here; src/audio/music uses it.
 */

/** A cell without a new note. */
export const NOTE_NONE = -1;
/** A cell that releases the channel's note. */
export const NOTE_OFF = -2;
/** Effect codes. */
export const FX_NONE = 0;
export const FX_ARPEGGIO = 1;
export const FX_PORTAMENTO = 2;
export const FX_VIBRATO = 3;
export const FX_ECHO = 4;
/** Highest volume of a cell (0x40). */
export const VOLUME_MAX = 0x40;
/** Highest note (B-8). */
export const NOTE_MAX = 8 * 12 + 11;
/** Note number of A-4 (440 Hz). */
export const NOTE_A4 = 4 * 12 + 9;
/** Width of a cell: `NOT II VV FXX`. */
export const CELL_LENGTH = 13;

const SEMITONES: Readonly<Record<string, number>> = { 'C-': 0, 'C#': 1, 'D-': 2, 'D#': 3, 'E-': 4, 'F-': 5, 'F#': 6, 'G-': 7, 'G#': 8, 'A-': 9, 'A#': 10, 'B-': 11 };
const NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'] as const;
const FX_LETTERS: Readonly<Record<string, number>> = { '0': FX_ARPEGGIO, '3': FX_PORTAMENTO, '4': FX_VIBRATO, E: FX_ECHO };

/** One parsed cell. */
export interface TrackerCell {
  /** Note number (octave × 12 + semitone), `NOTE_NONE` or `NOTE_OFF`. */
  note: number;
  /** Instrument index, −1 = keep. */
  inst: number;
  /** Volume 0–64, −1 = default. */
  vol: number;
  fx: number;
  /** Effect parameter 0–255. */
  param: number;
}

/** A pattern parsed into typed arrays, row-major (`row × channels + channel`). */
export interface ParsedPattern {
  readonly id: string;
  readonly channels: number;
  readonly rows: number;
  readonly note: Int16Array;
  readonly inst: Int8Array;
  readonly vol: Int8Array;
  readonly fx: Uint8Array;
  readonly param: Uint8Array;
}

/** A pattern as written in the content. */
export interface NotatedPattern {
  readonly id: string;
  readonly kanaele: number;
  readonly zeilen: readonly string[];
}

/** Error in the notation of a pattern. */
export class NotationError extends Error {
  override readonly name = 'NotationError';
}

/** Length of one row [s] at `bpm` with `rowsPerBeat` rows per beat. */
export function patternRowSeconds(bpm: number, rowsPerBeat: number): number {
  return 60 / (bpm * rowsPerBeat);
}

/** Frequency of note number `n` [Hz] (equal temperament, A-4 = 440 Hz); fractional notes for slides and vibrato. */
export function noteFrequency(n: number): number {
  return 440 * 2 ** ((n - NOTE_A4) / 12);
}

/** The note name of note number `n` (`C#4`). */
export function noteName(n: number): string {
  return `${NAMES[n % 12] as string}${Math.floor(n / 12)}`;
}

/** Parses a note field: number, `NOTE_NONE`, `NOTE_OFF` or null for garbage. */
export function parseNote(field: string): number | null {
  if (field === '---') return NOTE_NONE;
  if (field === '===') return NOTE_OFF;
  const semitone = SEMITONES[field.slice(0, 2)];
  const octave = field.charCodeAt(2) - 48;
  if (semitone === undefined || field.length !== 3 || octave < 0 || octave > 8) return null;
  return octave * 12 + semitone;
}

function hexByte(field: string): number | null {
  if (!/^[0-9A-F]{2}$/.test(field)) return null;
  return Number.parseInt(field, 16);
}

/** Parses one cell into `out`; returns an error text or null. */
export function parseCell(text: string, out: TrackerCell): string | null {
  if (text.length !== CELL_LENGTH || text[3] !== ' ' || text[6] !== ' ' || text[9] !== ' ') return `cell "${text}" is not "NOT II VV FXX"`;
  const note = parseNote(text.slice(0, 3));
  if (note === null) return `cell "${text}": bad note`;
  const instField = text.slice(4, 6);
  const inst = instField === '..' ? -1 : hexByte(instField);
  if (inst === null) return `cell "${text}": bad instrument`;
  const volField = text.slice(7, 9);
  const vol = volField === '..' ? -1 : hexByte(volField);
  if (vol === null || vol > VOLUME_MAX) return `cell "${text}": bad volume (00–40 hex)`;
  const fxField = text.slice(10, 13);
  let fx = FX_NONE;
  let param = 0;
  if (fxField !== '...') {
    const code = FX_LETTERS[fxField[0] as string];
    const p = hexByte(fxField.slice(1));
    if (code === undefined || p === null) return `cell "${text}": bad effect (0xy, 3xx, 4xy, Exx or ...)`;
    fx = code;
    param = p;
  }
  if (note >= 0 && inst < 0) return `cell "${text}": a note names its instrument`;
  out.note = note;
  out.inst = inst;
  out.vol = vol;
  out.fx = fx;
  out.param = param;
  return null;
}

/** Writes one cell (the inverse of `parseCell`). */
export function formatCell(c: Readonly<TrackerCell>): string {
  const note = c.note === NOTE_NONE ? '---' : c.note === NOTE_OFF ? '===' : noteName(c.note);
  const hex = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0');
  const inst = c.inst < 0 ? '..' : hex(c.inst);
  const vol = c.vol < 0 ? '..' : hex(c.vol);
  const fx = c.fx === FX_NONE ? '...' : `${c.fx === FX_ARPEGGIO ? '0' : c.fx === FX_PORTAMENTO ? '3' : c.fx === FX_VIBRATO ? '4' : 'E'}${hex(c.param)}`;
  return `${note} ${inst} ${vol} ${fx}`;
}

/** Problems of the notation of `p` with `instruments` instruments (empty: fine). At most one per row. */
export function checkPatternNotation(p: NotatedPattern, instruments: number): string[] {
  const problems: string[] = [];
  const cell: TrackerCell = { note: 0, inst: 0, vol: 0, fx: 0, param: 0 };
  p.zeilen.forEach((row, r) => {
    const cells = row.split('|');
    if (cells.length !== p.kanaele) {
      problems.push(`${p.id} row ${r}: ${cells.length} cells, ${p.kanaele} channels`);
      return;
    }
    for (const text of cells) {
      const err = parseCell(text, cell);
      if (err !== null) {
        problems.push(`${p.id} row ${r}: ${err}`);
        return;
      }
      if (cell.inst >= instruments) {
        problems.push(`${p.id} row ${r}: instrument ${cell.inst} beyond the piece's ${instruments}`);
        return;
      }
    }
  });
  return problems;
}

/** Parses `p` into typed arrays (throws `NotationError`). */
export function parsePattern(p: NotatedPattern): ParsedPattern {
  const rows = p.zeilen.length;
  const n = rows * p.kanaele;
  const out: ParsedPattern = { id: p.id, channels: p.kanaele, rows, note: new Int16Array(n), inst: new Int8Array(n), vol: new Int8Array(n), fx: new Uint8Array(n), param: new Uint8Array(n) };
  const cell: TrackerCell = { note: 0, inst: 0, vol: 0, fx: 0, param: 0 };
  for (let r = 0; r < rows; r++) {
    const cells = (p.zeilen[r] as string).split('|');
    if (cells.length !== p.kanaele) throw new NotationError(`${p.id} row ${r}: ${cells.length} cells, ${p.kanaele} channels`);
    for (let c = 0; c < p.kanaele; c++) {
      const err = parseCell(cells[c] as string, cell);
      if (err !== null) throw new NotationError(`${p.id} row ${r}: ${err}`);
      const i = r * p.kanaele + c;
      out.note[i] = cell.note;
      out.inst[i] = cell.inst;
      out.vol[i] = cell.vol;
      out.fx[i] = cell.fx;
      out.param[i] = cell.param;
    }
  }
  return out;
}
