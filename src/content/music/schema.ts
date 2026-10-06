/**
 * Music (docs/SPIEL.md §24 "Tracker/Sequencer", MASTERPROMPT §27; ADR-0207; strand A – collections `music` (§C
 * "Musikstücke", only `zaehlt`), `stingers`, `songs`, `wavetables`): pieces in tracker notation – instruments, patterns,
 * arrangements per day and night, layers as stems, an SNES-like echo – rendered by the own synth in Node and in the worker
 * bit-identically (src/audio/music/render.ts).
 *
 * - **Instrument:** a wave (`rechteck` with pulse width, `dreieck`, `saege`, `rauschen` – pitched noise, the note sets its
 *   clock –, `fm` two-operator, `wavetable` – one cycle of a table of the collection `wavetables`), an ADSR envelope
 *   [s, s, 0–1, s], level, pan and echo send; optionally a pitch envelope (kick drums, toms: the note starts `halbtoene`
 *   above and falls in `sekunden`), a resonant filter, an automatic vibrato after a delay and a detuned second voice
 *   (`chorus`, pads).
 * - **Pattern:** rows × channels in tracker notation (src/content/music/notation.ts); every note names its instrument, so a
 *   pattern sounds the same wherever it stands (the loop seam and the pre-roll of the renderer rely on it).
 * - **Arrangement:** the order of the patterns per `standard` | `tag` | `nacht`; `loopAb` is the index of the pattern the
 *   loop returns to – `loopAb` = number of patterns plays once (stingers).
 * - **Layers:** the channels of each layer (`basis`, `melodie`, `gefahr`) become one stem each; every channel belongs to one.
 * - **Echo:** delay in 16-ms steps up to 240 ms like the SNES DSP, feedback, an 8-tap FIR on the echo path, echo level.
 * - **Length:** a counted piece (`zaehlt`) lasts 1,5–3 min per arrangement (MASTERPROMPT §27 "1,5–3 min, loopbar").
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema, type LocalizedText } from '../schema/common';
import { checkPatternNotation, patternRowSeconds } from './notation';

export const TRACKER_WAVES = ['rechteck', 'dreieck', 'saege', 'rauschen', 'fm', 'wavetable'] as const;
export type TrackerWave = (typeof TRACKER_WAVES)[number];
export const MUSIC_LAYERS = ['basis', 'melodie', 'gefahr'] as const;
export type MusicLayer = (typeof MUSIC_LAYERS)[number];
export const MUSIC_ARRANGEMENTS = ['standard', 'tag', 'nacht'] as const;
export type MusicArrangementKind = (typeof MUSIC_ARRANGEMENTS)[number];
/** Filter types of an instrument (the same resonant biquads as the SFX). */
export const TRACKER_FILTERS = ['tiefpass', 'hochpass', 'bandpass'] as const;
export type TrackerFilterType = (typeof TRACKER_FILTERS)[number];

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
  /** Pitch envelope: the note starts `halbtoene` above (below if negative) and reaches its pitch after `sekunden`. */
  readonly tonhoehenHuelle?: { readonly halbtoene: number; readonly sekunden: number };
  /** Resonant filter of the voice. */
  readonly filter?: { readonly art: TrackerFilterType; readonly frequenz: number; readonly resonanz: number };
  /** Automatic vibrato after `verzoegerung` seconds: depth [cent], rate [Hz]. */
  readonly vibrato?: { readonly tiefe: number; readonly rate: number; readonly verzoegerung: number };
  /** A second voice detuned by `cents` (pads, strings). */
  readonly chorus?: { readonly cents: number };
}
/**
 * One pattern in tracker notation: `zeilen[r]` holds one cell per channel separated by `|`; a cell is `NOT II VV FXX`
 * (note `C-4`/`C#4`, `---` none, `===` off; instrument index hex; volume 00–40 hex; effect letter + parameter:
 * `0xy` arpeggio, `3xx` portamento, `4xy` vibrato, `Exx` echo send, `...` none). Parsed by src/content/music/notation.ts.
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

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

/** Most channels of a piece (8 like the SNES DSP). */
export const MUSIC_MAX_CHANNELS = 8;
/** Most rows of a pattern. */
export const MUSIC_MAX_ROWS = 256;
/** Most instruments of a piece (instrument index is one hex byte in the notation, the piece keeps it small). */
export const MUSIC_MAX_INSTRUMENTS = 16;
/** Tempo range [beats per minute]. */
export const MUSIC_BPM_MIN = 40;
export const MUSIC_BPM_MAX = 240;
/** Echo delay step and maximum [ms] (the SNES DSP: 16-ms steps, EDL 0–15). */
export const ECHO_DELAY_STEP_MS = 16;
export const ECHO_DELAY_MAX_MS = 240;
/** Taps of the echo FIR (the SNES DSP's eight). */
export const ECHO_FIR_TAPS = 8;
/** Most the absolute FIR taps may add up to (the echo path stays stable with feedback < 1). */
export const ECHO_FIR_MAX_GAIN = 1;
/** Length of a counted piece per arrangement [s] (MASTERPROMPT §27 "1,5–3 min"). */
export const COUNTED_PIECE_MIN_SECONDS = 90;
export const COUNTED_PIECE_MAX_SECONDS = 180;
/** Longest piece that does not count (stingers, songs) [s]. */
export const SHORT_PIECE_MAX_SECONDS = 40;
/** Wavetable length range (a power of two). */
export const WAVETABLE_MIN_LENGTH = 8;
export const WAVETABLE_MAX_LENGTH = 256;
/** Lowest and highest filter frequency of an instrument [Hz] (below the Nyquist frequency of 32 kHz). */
const FILTER_MIN_HZ = 20;
const FILTER_MAX_HZ = 14000;

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

const level = z.number().min(0).max(1);

export const trackerInstrumentSchema = z
  .object({
    id: idSchema,
    welle: z.enum(TRACKER_WAVES),
    tastgrad: z.number().min(0.05).max(0.95).optional(),
    fm: z.object({ verhaeltnis: z.number().min(0.125).max(16), index: z.number().min(0).max(16) }).strict().optional(),
    tabelle: idSchema.optional(),
    huellkurve: z.tuple([z.number().min(0.001).max(4), z.number().min(0).max(8), level, z.number().min(0.005).max(8)]),
    pegel: level,
    pan: z.number().min(-1).max(1),
    echoSend: level,
    tonhoehenHuelle: z.object({ halbtoene: z.number().min(-48).max(48), sekunden: z.number().min(0.001).max(2) }).strict().optional(),
    filter: z.object({ art: z.enum(TRACKER_FILTERS), frequenz: z.number().min(FILTER_MIN_HZ).max(FILTER_MAX_HZ), resonanz: z.number().min(0.3).max(12) }).strict().optional(),
    vibrato: z.object({ tiefe: z.number().min(0).max(200), rate: z.number().min(0.1).max(16), verzoegerung: z.number().min(0).max(4) }).strict().optional(),
    chorus: z.object({ cents: z.number().min(1).max(50) }).strict().optional(),
  })
  .strict()
  .superRefine((i, ctx) => {
    if (i.tastgrad !== undefined && i.welle !== 'rechteck') ctx.addIssue({ code: 'custom', path: ['tastgrad'], message: 'tastgrad only applies to rechteck' });
    if ((i.fm !== undefined) !== (i.welle === 'fm')) ctx.addIssue({ code: 'custom', path: ['fm'], message: 'an fm instrument has fm, no other does' });
    if ((i.tabelle !== undefined) !== (i.welle === 'wavetable')) ctx.addIssue({ code: 'custom', path: ['tabelle'], message: 'a wavetable instrument names its table, no other does' });
  }) satisfies z.ZodType<TrackerInstrument>;

export const trackerPatternSchema = z
  .object({
    id: idSchema,
    kanaele: z.number().int().min(1).max(MUSIC_MAX_CHANNELS),
    zeilen: z.array(z.string()).min(1).max(MUSIC_MAX_ROWS),
  })
  .strict() satisfies z.ZodType<TrackerPattern>;

export const musicArrangementSchema = z
  .object({ art: z.enum(MUSIC_ARRANGEMENTS), folge: z.array(idSchema).min(1), loopAb: z.number().int().min(0) })
  .strict()
  .refine((a) => a.loopAb <= a.folge.length, { message: 'loopAb is a pattern index of folge (or its length: play once)', path: ['loopAb'] }) satisfies z.ZodType<MusicArrangement>;

export const musicEchoSchema = z
  .object({
    verzoegerungMs: z
      .number()
      .int()
      .min(ECHO_DELAY_STEP_MS)
      .max(ECHO_DELAY_MAX_MS)
      .refine((ms) => ms % ECHO_DELAY_STEP_MS === 0, { message: `echo delay in ${ECHO_DELAY_STEP_MS}-ms steps` }),
    rueckkopplung: z.number().min(-0.95).max(0.95),
    fir: z
      .array(z.number().min(-1).max(1))
      .length(ECHO_FIR_TAPS)
      .refine((f) => f.reduce((s, v) => s + Math.abs(v), 0) <= ECHO_FIR_MAX_GAIN + 1e-9, { message: `the absolute FIR taps add up to at most ${ECHO_FIR_MAX_GAIN}` }),
    pegel: level,
  })
  .strict();

/** Length of arrangement `a` of `piece` [s]: its rows at the piece's tempo. */
export function arrangementSeconds(piece: Pick<MusicPiece, 'bpm' | 'zeilenJeSchlag' | 'patterns'>, a: Pick<MusicArrangement, 'folge'>): number {
  const rows = new Map(piece.patterns.map((p) => [p.id, p.zeilen.length]));
  let total = 0;
  for (const id of a.folge) total += rows.get(id) ?? 0;
  return total * patternRowSeconds(piece.bpm, piece.zeilenJeSchlag);
}

export const musicPieceSchema = z
  .object({
    id: idSchema,
    titel: localizedTextSchema,
    bpm: z.number().min(MUSIC_BPM_MIN).max(MUSIC_BPM_MAX),
    zeilenJeSchlag: z.number().int().min(1).max(8),
    instrumente: z.array(trackerInstrumentSchema).min(1).max(MUSIC_MAX_INSTRUMENTS),
    patterns: z.array(trackerPatternSchema).min(1),
    arrangements: z.array(musicArrangementSchema).min(1),
    schichten: z.object({ basis: z.array(z.number().int().min(0)), melodie: z.array(z.number().int().min(0)), gefahr: z.array(z.number().int().min(0)) }).strict(),
    echo: musicEchoSchema,
    zaehlt: z.boolean(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    for (const [i, inst] of p.instrumente.entries()) {
      if (ids.has(inst.id)) ctx.addIssue({ code: 'custom', path: ['instrumente', i, 'id'], message: `duplicate instrument "${inst.id}"` });
      ids.add(inst.id);
    }
    const channels = p.patterns[0]?.kanaele ?? 0;
    const patternIds = new Set<string>();
    for (const [i, pat] of p.patterns.entries()) {
      if (patternIds.has(pat.id)) ctx.addIssue({ code: 'custom', path: ['patterns', i, 'id'], message: `duplicate pattern "${pat.id}"` });
      patternIds.add(pat.id);
      if (pat.kanaele !== channels) ctx.addIssue({ code: 'custom', path: ['patterns', i, 'kanaele'], message: `every pattern of a piece has ${channels} channels` });
      for (const problem of checkPatternNotation(pat, p.instrumente.length)) ctx.addIssue({ code: 'custom', path: ['patterns', i, 'zeilen'], message: problem });
    }
    const kinds = new Set<string>();
    for (const [i, a] of p.arrangements.entries()) {
      if (kinds.has(a.art)) ctx.addIssue({ code: 'custom', path: ['arrangements', i, 'art'], message: `two arrangements "${a.art}"` });
      kinds.add(a.art);
      for (const id of a.folge) if (!patternIds.has(id)) ctx.addIssue({ code: 'custom', path: ['arrangements', i, 'folge'], message: `unknown pattern "${id}"` });
      const seconds = arrangementSeconds(p, a);
      if (p.zaehlt && (seconds < COUNTED_PIECE_MIN_SECONDS || seconds > COUNTED_PIECE_MAX_SECONDS)) {
        ctx.addIssue({ code: 'custom', path: ['arrangements', i], message: `a counted piece lasts ${COUNTED_PIECE_MIN_SECONDS}–${COUNTED_PIECE_MAX_SECONDS} s (${seconds.toFixed(1)} s)` });
      }
      if (!p.zaehlt && seconds > SHORT_PIECE_MAX_SECONDS) ctx.addIssue({ code: 'custom', path: ['arrangements', i], message: `a stinger or song lasts at most ${SHORT_PIECE_MAX_SECONDS} s (${seconds.toFixed(1)} s)` });
      if (p.zaehlt && a.loopAb >= a.folge.length) ctx.addIssue({ code: 'custom', path: ['arrangements', i, 'loopAb'], message: 'a counted piece loops' });
    }
    const seen = new Set<number>();
    for (const layer of MUSIC_LAYERS) {
      for (const ch of p.schichten[layer]) {
        if (ch >= channels) ctx.addIssue({ code: 'custom', path: ['schichten', layer], message: `channel ${ch} beyond the ${channels} channels` });
        if (seen.has(ch)) ctx.addIssue({ code: 'custom', path: ['schichten', layer], message: `channel ${ch} in two layers` });
        seen.add(ch);
      }
    }
    for (let ch = 0; ch < channels; ch++) if (!seen.has(ch)) ctx.addIssue({ code: 'custom', path: ['schichten'], message: `channel ${ch} belongs to no layer` });
  }) satisfies z.ZodType<MusicPiece>;

/** Ducking of the music under a stinger [dB] (negative: quieter). */
export const STINGER_DUCK_MIN_DB = -30;

export const stingerSchema = z.object({ id: idSchema, stueck: idSchema, duckDb: z.number().min(STINGER_DUCK_MIN_DB).max(0) }).strict() satisfies z.ZodType<StingerDef>;

/** Songs of the player's instruments: `lied_<n>` (docs/SPIEL.md §29). */
export const SONG_ID_PATTERN = /^lied_[1-9][0-9]*$/;

export const songSchema = z
  .object({ id: idSchema.regex(SONG_ID_PATTERN, { message: 'a song id is lied_<n>' }), name: localizedTextSchema, stueck: idSchema, instrument: idSchema })
  .strict() satisfies z.ZodType<SongDef>;

export const wavetableSchema = z
  .object({
    id: idSchema,
    werte: z
      .array(z.number().min(-1).max(1))
      .min(WAVETABLE_MIN_LENGTH)
      .max(WAVETABLE_MAX_LENGTH)
      .refine((w) => (w.length & (w.length - 1)) === 0, { message: 'a wavetable has a power-of-two length' }),
  })
  .strict() satisfies z.ZodType<WavetableDef>;

/** A piece as written in the content files (mutable arrays; the registry validates it into a `MusicPiece`). */
export type MusicPieceInput = z.input<typeof musicPieceSchema>;
export type TrackerInstrumentInput = z.input<typeof trackerInstrumentSchema>;
export type TrackerPatternInput = z.input<typeof trackerPatternSchema>;
export type MusicEchoInput = z.input<typeof musicEchoSchema>;
export type StingerInput = z.input<typeof stingerSchema>;
export type SongInput = z.input<typeof songSchema>;
export type WavetableInput = z.input<typeof wavetableSchema>;
