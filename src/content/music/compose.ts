/**
 * Building blocks of the music content (src/content/music/*.ts): a piece is written as chords, lines and rhythms and turned
 * into tracker patterns here, the way `defineSfxGroup` and its constructors keep the SFX recipes readable. The output is
 * plain tracker notation (src/content/music/notation.ts) checked by the schema like hand-written rows.
 *
 * - `PatternBuilder`: an empty pattern of `rows` × `channels`; `note`, `off`, `line`, `hits` place cells; `build` writes the
 *   rows.
 * - **Lines** (`line`): tokens separated by spaces – `E5:4` (note E5 for 4 rows), `r:2` (rest: the note is released), `.:2`
 *   (hold: the previous note sounds on), `E5:4@40` (volume 0–64), `E5:4!047` (an effect cell, notation `FXX`), `|` bar
 *   lines are ignored (they only help reading).
 * - **Rhythms** (`hits`): one character per row – `x` full hit, `o` soft hit, `-` release, `.` nothing.
 * - **Chords** (`chord`): `Dm`, `Bb`, `F#m7`, `Csus4`, `Gmaj7`, `Adim` → semitone offsets over the root; `chordNotes` and
 *   `arpeggio` place them in an octave.
 */
import { formatCell, NOTE_NONE, NOTE_OFF, FX_NONE, FX_ARPEGGIO, FX_PORTAMENTO, FX_VIBRATO, FX_ECHO, type TrackerCell } from './notation';
import type { TrackerPatternInput } from './schema';
import { psin } from './portableMath';

const LETTERS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FX_CODES: Readonly<Record<string, number>> = { '0': FX_ARPEGGIO, '3': FX_PORTAMENTO, '4': FX_VIBRATO, E: FX_ECHO };

/** Note number of a pitch name in scientific notation (`C4` = 48 = middle C, `F#3`, `Bb2`). */
export function n(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (m === null) throw new Error(`music: bad pitch "${name}"`);
  const letter = LETTERS[m[1] as string] as number;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return Number(m[3]) * 12 + letter + acc;
}

const QUALITIES: Readonly<Record<string, readonly number[]>> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  '5': [0, 7],
};

/** A chord: root pitch class and the offsets of its tones. */
export interface Chord {
  readonly root: number;
  readonly tones: readonly number[];
}

/** Parses `Dm`, `Bb`, `F#m7`, `Csus4`, `Gmaj7`, `Adim`, `E5`. */
export function chord(symbol: string): Chord {
  const m = /^([A-G])([#b]?)(.*)$/.exec(symbol);
  const tones = m === null ? undefined : QUALITIES[m[3] as string];
  if (m === null || tones === undefined) throw new Error(`music: bad chord "${symbol}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return { root: ((LETTERS[m[1] as string] as number) + acc + 12) % 12, tones };
}

/** The tones of `c` as notes from the root in `octave` (C-based octave numbers: `octave × 12 + root`). */
export function chordNotes(c: Chord, octave: number): number[] {
  return c.tones.map((t) => octave * 12 + c.root + t);
}

/** The root of `c` in `octave`. */
export function root(c: Chord, octave: number): number {
  return octave * 12 + c.root;
}

/** Whether pitch `note` is a tone of `c` (any octave). */
export function inChord(c: Chord, note: number): boolean {
  const pc = (((note - c.root) % 12) + 12) % 12;
  return c.tones.some((t) => t % 12 === pc);
}

/** Options of a cell. */
export interface CellOptions {
  /** Volume 0–64. */
  readonly vol?: number;
  /** Effect in notation (`047`, `310`, `E20`). */
  readonly fx?: string;
}

/** The text of a cell without note, instrument, volume or effect. */
const EMPTY_CELL = formatCell({ note: NOTE_NONE, inst: -1, vol: -1, fx: FX_NONE, param: 0 });
/** Offsets that make every cell field a non-negative whole number of `cellKey`. */
const NOTE_OFFSET = 2;
const INST_OFFSET = 1;
const VOL_OFFSET = 1;
/** Bit positions of the fields in `cellKey` (note 0…109 in 7 bits, instrument 0…16 in 5, volume 0…65 in 7, effect 0…4 in 3, parameter 0…255 in 8). */
const KEY_INST_SHIFT = 7;
const KEY_VOL_SHIFT = 12;
const KEY_FX_SHIFT = 19;
const KEY_PARAM_SHIFT = 22;
/**
 * The text of every distinct cell the composers wrote, by `cellKey` (M7-129): the pieces hold some 50 000 cells but only a
 * few hundred distinct ones, and `formatCell` built five strings per cell while the page loaded (3,4 MB of boot garbage).
 */
const CELL_TEXT = new Map<number, string>();
/** The cell `formatCell` reads on a cache miss. */
const CELL_SCRATCH: TrackerCell = { note: NOTE_NONE, inst: -1, vol: -1, fx: FX_NONE, param: 0 };
/** The cell texts of the row under construction (`build`), joined per row; grown to the widest pattern. */
let rowParts: string[] = [];

/** One whole number per distinct cell (the fields packed, every field shifted into the non-negative range). */
function cellKey(note: number, inst: number, vol: number, fx: number, param: number): number {
  return note + NOTE_OFFSET + ((inst + INST_OFFSET) << KEY_INST_SHIFT) + ((vol + VOL_OFFSET) << KEY_VOL_SHIFT) + (fx << KEY_FX_SHIFT) + (param << KEY_PARAM_SHIFT);
}

/** The text of a cell: the empty cell's constant, else the cached `formatCell`. */
function cellText(note: number, inst: number, vol: number, fx: number, param: number): string {
  if (note === NOTE_NONE && inst < 0 && vol < 0 && fx === FX_NONE) return EMPTY_CELL;
  const key = cellKey(note, inst, vol, fx, param);
  const known = CELL_TEXT.get(key);
  if (known !== undefined) return known;
  CELL_SCRATCH.note = note;
  CELL_SCRATCH.inst = inst;
  CELL_SCRATCH.vol = vol;
  CELL_SCRATCH.fx = fx;
  CELL_SCRATCH.param = param;
  const text = formatCell(CELL_SCRATCH);
  CELL_TEXT.set(key, text);
  return text;
}

/**
 * A pattern under construction. Its cells live in typed arrays (row-major, `row × channels + channel`), not in one object
 * per cell: the pieces are composed while the page loads, and 50 000 cell objects plus their texts were boot garbage
 * V8's memory reducer swept up in the middle of play (M7-129). `build` writes the rows from the cached cell texts.
 */
export class PatternBuilder {
  private readonly noteOf: Int16Array;
  private readonly instOf: Int8Array;
  private readonly volOf: Int8Array;
  private readonly fxOf: Uint8Array;
  private readonly paramOf: Uint8Array;

  constructor(
    readonly id: string,
    readonly rows: number,
    readonly channels: number,
  ) {
    const n = rows * channels;
    this.noteOf = new Int16Array(n).fill(NOTE_NONE);
    this.instOf = new Int8Array(n).fill(-1);
    this.volOf = new Int8Array(n).fill(-1);
    this.fxOf = new Uint8Array(n);
    this.paramOf = new Uint8Array(n);
  }

  /** Index of the cell on channel `ch` at `row`. */
  private at(ch: number, row: number): number {
    if (ch < 0 || ch >= this.channels || row < 0 || row >= this.rows) throw new Error(`music: ${this.id}: cell ${ch}/${row} outside ${this.channels}×${this.rows}`);
    return row * this.channels + ch;
  }

  /** A note of instrument `inst` on channel `ch` at `row`. */
  note(ch: number, row: number, note: number, inst: number, o: CellOptions = {}): this {
    const i = this.at(ch, row);
    this.noteOf[i] = note;
    this.instOf[i] = inst;
    this.volOf[i] = o.vol === undefined ? -1 : Math.round(o.vol);
    if (o.fx !== undefined) this.effect(i, o.fx);
    return this;
  }

  /** Releases channel `ch` at `row`. */
  off(ch: number, row: number): this {
    const i = this.at(ch, row);
    this.noteOf[i] = NOTE_OFF;
    this.instOf[i] = -1;
    return this;
  }

  /** An effect without a new note. */
  fx(ch: number, row: number, fx: string): this {
    this.effect(this.at(ch, row), fx);
    return this;
  }

  private effect(i: number, fx: string): void {
    const code = FX_CODES[fx[0] as string];
    if (code === undefined || !/^[0-9A-F]{2}$/.test(fx.slice(1))) throw new Error(`music: ${this.id}: bad effect "${fx}"`);
    this.fxOf[i] = code;
    this.paramOf[i] = Number.parseInt(fx.slice(1), 16);
  }

  /** The cell on channel `ch` at `row` as a `TrackerCell` (tests, tools): a new object. */
  cell(ch: number, row: number): TrackerCell {
    const i = this.at(ch, row);
    return { note: this.noteOf[i] as number, inst: this.instOf[i] as number, vol: this.volOf[i] as number, fx: this.fxOf[i] as number, param: this.paramOf[i] as number };
  }

  /**
   * A line of notes on channel `ch` from row `start` (see module comment); `transpose` semitones are added to every note.
   * Returns the row after the line.
   */
  line(ch: number, inst: number, text: string, start = 0, transpose = 0, vol?: number): number {
    let row = start;
    for (const token of text.split(/\s+/)) {
      if (token === '' || token === '|') continue;
      const m = /^([^:]+):(\d+)(?:@(\d+))?(?:!([0-9A-F]{3}|E[0-9A-F]{2}))?$/.exec(token);
      if (m === null) throw new Error(`music: ${this.id}: bad token "${token}"`);
      const what = m[1] as string;
      const rows = Number(m[2]);
      const v = m[3] === undefined ? vol : Number(m[3]);
      if (what === 'r') this.off(ch, row);
      else if (what !== '.') this.note(ch, row, n(what) + transpose, inst, { vol: v, fx: m[4] });
      row += rows;
    }
    return row;
  }

  /** A rhythm on channel `ch`: one character per row from `start` (`x` hit, `o` soft, `-` off, `.` nothing). */
  hits(ch: number, inst: number, note: number, pattern: string, start = 0, vol = 64, soft = 32): this {
    let row = start;
    for (const ch2 of pattern.replace(/\s|\|/g, '')) {
      if (ch2 === 'x') this.note(ch, row, note, inst, { vol });
      else if (ch2 === 'o') this.note(ch, row, note, inst, { vol: soft });
      else if (ch2 === '-') this.off(ch, row);
      row++;
    }
    return this;
  }

  /** Writes the rows in tracker notation (the cell texts from the cache, one string per row). */
  build(): TrackerPatternInput {
    const zeilen: string[] = new Array<string>(this.rows);
    if (rowParts.length < this.channels) rowParts = new Array<string>(this.channels);
    const parts = rowParts;
    const channels = this.channels;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < channels; c++) {
        const i = r * channels + c;
        parts[c] = cellText(this.noteOf[i] as number, this.instOf[i] as number, this.volOf[i] as number, this.fxOf[i] as number, this.paramOf[i] as number);
      }
      zeilen[r] = parts.length === channels ? parts.join('|') : parts.slice(0, channels).join('|');
    }
    return { id: this.id, kanaele: channels, zeilen };
  }
}

/**
 * Arpeggiates `chords` (one per `rowsPerChord` rows) on channel `ch`: the chord tones from `octave` in the order of
 * `order` (indices into the chord tones; ≥ the chord size continue an octave up), one note every `step` rows.
 */
export function arpeggio(p: PatternBuilder, ch: number, inst: number, chords: readonly string[], rowsPerChord: number, octave: number, order: readonly number[], step: number, vol?: number, start = 0): void {
  chords.forEach((sym, ci) => {
    const c = chord(sym);
    const tones = chordNotes(c, octave);
    for (let k = 0; k * step < rowsPerChord; k++) {
      const idx = order[k % order.length] as number;
      const note = (tones[idx % tones.length] as number) + 12 * Math.floor(idx / tones.length);
      p.note(ch, start + ci * rowsPerChord + k * step, note, inst, { vol });
    }
  });
}

/**
 * A bass line over `chords`: per chord the `rhythm` (rows of `x`/`o`/`5`/`8`/`.`/`-` – root, soft root, fifth, octave,
 * nothing, release) in `octave`.
 */
export function bass(p: PatternBuilder, ch: number, inst: number, chords: readonly string[], rowsPerChord: number, octave: number, rhythm: string, vol = 64, start = 0): void {
  const r = rhythm.replace(/\s|\|/g, '');
  chords.forEach((sym, ci) => {
    const c = chord(sym);
    const base = root(c, octave);
    for (let k = 0; k < rowsPerChord; k++) {
      const ch2 = r[k % r.length];
      const row = start + ci * rowsPerChord + k;
      if (ch2 === 'x') p.note(ch, row, base, inst, { vol });
      else if (ch2 === 'o') p.note(ch, row, base, inst, { vol: Math.round(vol * 0.6) });
      else if (ch2 === '5') p.note(ch, row, base + 7, inst, { vol: Math.round(vol * 0.8) });
      else if (ch2 === '8') p.note(ch, row, base + 12, inst, { vol: Math.round(vol * 0.8) });
      else if (ch2 === '-') p.off(ch, row);
    }
  });
}

/**
 * Holds every chord of `chords` as a pad on channels `chs` for `rowsPerChord` rows: channel k plays chord tone
 * `from + k` (tones past the chord continue an octave up).
 */
export function pad(p: PatternBuilder, chs: readonly number[], inst: number, chords: readonly string[], rowsPerChord: number, octave: number, vol?: number, from = 0, start = 0): void {
  chords.forEach((sym, ci) => {
    const tones = chordNotes(chord(sym), octave);
    chs.forEach((ch, k) => {
      const t = from + k;
      const note = (tones[t % tones.length] as number) + 12 * Math.floor(t / tones.length);
      p.note(ch, start + ci * rowsPerChord, note, inst, { vol });
    });
  });
}

/** Sine table values of a sum of harmonics (`amps[k]` for harmonic k + 1, `phases` in cycles), scaled to peak 1. */
export function harmonics(length: number, amps: readonly number[], phases: readonly number[] = []): number[] {
  const v: number[] = [];
  for (let i = 0; i < length; i++) {
    let s = 0;
    amps.forEach((a, k) => {
      s += a * psin(2 * Math.PI * ((k + 1) * (i / length) + (phases[k] ?? 0)));
    });
    v.push(s);
  }
  const peak = Math.max(...v.map(Math.abs));
  return v.map((x) => Math.round((x / peak) * 10000) / 10000);
}
