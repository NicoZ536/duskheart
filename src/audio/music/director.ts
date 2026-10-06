/**
 * The music director (M7-04; docs/SPIEL.md §24 "Musik-System"; MASTERPROMPT §27 "adaptive Schichten (Gefahren-Percussion bei
 * Gegnernähe), weiche Überblendungen, … Stille ist erlaubt"): a pure state machine over the probe of each frame (what the
 * world asks for) that decides what plays – piece, arrangement, the gain of every layer and the length of the fade. It
 * never touches Web Audio (src/audio/music/player.ts does) and never the simulation (src/audio/music/probe.ts reads it), so
 * tests/unit/audio/musik-zustand.test.ts drives it with probes over time.
 *
 * - **Moods:** `titel` → the title theme; `erkundung` → the biome's piece (`BIOME_MUSIC`), day or night arrangement;
 *   `basis` → the base theme; `kampf` → the fight; `boss` → the boss's own theme (a piece with the boss's id) or the fight;
 *   `gewoelbe` → the biome's night arrangement without the melody layer (until the vaults get their own piece); `stille` →
 *   nothing.
 * - **Hysteresis:** a new mood must hold for `ENTER_SECONDS` before the music follows; leaving the fight needs
 *   `KAMPF_HOLD_SECONDS` without a hunter close (a dodge out of range does not drop the fight music).
 * - **Fades:** 2–4 s by the mood entered (`FADE_SECONDS`); a change of the arrangement of the same piece (dusk) fades too.
 * - **Danger layer:** rises as the nearest hunting enemy comes from `DANGER_FAR_TILES` to `DANGER_NEAR_TILES`; in a fight it
 *   never falls below `FIGHT_DANGER_MIN`, in a boss fight it is full.
 * - **Quiet nights:** exploring at night with no danger, after the piece played through once the music rests for
 *   `QUIET_MIN_SECONDS`–`QUIET_MAX_SECONDS`, drawn from a presentation hash of (world seed, night, pause) – the simulation's
 *   random streams are never touched – then the piece starts again. Day, danger or another mood end the rest at once.
 */
import { BIOME_MUSIC, MOOD_MUSIC } from '../../content/music/biome';
import type { MusicArrangementKind, MusicLayer } from '../../content/music/schema';
import { hash3, hashToUnit } from '../../engine/rng';
import type { MusicMood, MusicProbe } from './types';
import type { AudioClock } from '../clock';

/** Seconds a mood must hold before the music follows. */
export const ENTER_SECONDS: Readonly<Record<MusicMood, number>> = { titel: 0, erkundung: 2, basis: 3, kampf: 0.5, boss: 0, gewoelbe: 1, stille: 1.5 };
/** Seconds without a hunter close before the fight music ends. */
export const KAMPF_HOLD_SECONDS = 6;
/** Fade into a mood [s] (§24 "weiche Überblendung 2–4 s"). */
export const FADE_SECONDS: Readonly<Record<MusicMood, number>> = { titel: 2, erkundung: 4, basis: 4, kampf: 2, boss: 2, gewoelbe: 3, stille: 3 };
/** Danger layer: silent beyond `DANGER_FAR_TILES` (§24 "≤ 12 Kacheln"), full from `DANGER_NEAR_TILES`. */
export const DANGER_FAR_TILES = 12;
export const DANGER_NEAR_TILES = 4;
/** Danger layer in a fight at least. */
export const FIGHT_DANGER_MIN = 0.5;
/** Pause of a quiet night [s] (§24 "nach einem Stück 60–180 s Pause"). */
export const QUIET_MIN_SECONDS = 60;
export const QUIET_MAX_SECONDS = 180;
/** Fade into a quiet night's pause [s]. */
export const QUIET_FADE_SECONDS = 6;

/** What should sound now. */
export interface MusicDecision {
  /** Piece id, or '' for silence. */
  piece: string;
  arrangement: MusicArrangementKind;
  /** Target gain of every layer 0–1. */
  layers: Record<MusicLayer, number>;
  /** Fade [s] for a change of piece or arrangement. */
  fadeSeconds: number;
  /** The mood the music follows. */
  mood: MusicMood;
}

/** A fresh decision (silence). */
export function createMusicDecision(): MusicDecision {
  return { piece: '', arrangement: 'standard', layers: { basis: 1, melodie: 1, gefahr: 0 }, fadeSeconds: FADE_SECONDS.stille, mood: 'stille' };
}

/** Gain of the danger layer for the nearest hunter at `tiles` (−1: none). */
export function dangerGain(tiles: number): number {
  if (tiles < 0 || tiles >= DANGER_FAR_TILES) return 0;
  if (tiles <= DANGER_NEAR_TILES) return 1;
  return (DANGER_FAR_TILES - tiles) / (DANGER_FAR_TILES - DANGER_NEAR_TILES);
}

/** Length of one pass of an arrangement [s] (the director needs it for quiet nights). */
export type PieceSeconds = (piece: string, arrangement: MusicArrangementKind) => number;

export interface MusicDirectorOptions {
  /** World seed of the presentation's quiet-night draws. */
  readonly seed: number;
  /** Length of one pass of a piece's arrangement. */
  readonly pieceSeconds: PieceSeconds;
  /** Whether a piece exists (a boss without its own theme plays the fight). */
  readonly hasPiece: (id: string) => boolean;
}

export class MusicDirector {
  private mood: MusicMood | null = null;
  private pending: MusicMood | null = null;
  private pendingSince = 0;
  /** Last time a hunter was close (the fight holds `KAMPF_HOLD_SECONDS` after it). */
  private lastFight = Number.NEGATIVE_INFINITY;
  /** When the current piece started, and which one. */
  private startedAt = 0;
  private current = '';
  private currentArrangement: MusicArrangementKind = 'standard';
  /** Quiet night: silent until this time; the number of pauses drawn this night. */
  private quietUntil = Number.NEGATIVE_INFINITY;
  private quietDay = -1;
  private quietCount = 0;

  constructor(private readonly options: MusicDirectorOptions) {}

  /** The mood the music follows now (`null` before the first update). */
  get currentMood(): MusicMood | null {
    return this.mood;
  }

  /** Decides from `probe` at the frame's audio time (`clock.now` [s]) into `out` (see module comment). */
  update(probe: Readonly<MusicProbe>, clock: Readonly<AudioClock>, out: MusicDecision): MusicDecision {
    const now = clock.now;
    let wanted = probe.mood;
    if (wanted === 'kampf') this.lastFight = now;
    // The fight holds on a little after the last hunter left (no flicker at the edge of the range).
    if (this.mood === 'kampf' && wanted !== 'kampf' && wanted !== 'boss' && wanted !== 'titel' && now - this.lastFight < KAMPF_HOLD_SECONDS) wanted = 'kampf';
    if (this.mood === null) this.mood = wanted;
    else if (wanted !== this.mood) {
      if (this.pending !== wanted) {
        this.pending = wanted;
        this.pendingSince = now;
      }
      if (now - this.pendingSince >= ENTER_SECONDS[wanted]) {
        this.mood = wanted;
        this.pending = null;
      }
    } else this.pending = null;
    const mood = this.mood;
    out.mood = mood;
    out.fadeSeconds = FADE_SECONDS[mood];
    out.layers.basis = 1;
    out.layers.melodie = 1;
    out.layers.gefahr = 0;
    let piece = '';
    let arrangement: MusicArrangementKind = 'standard';
    const biome = BIOME_MUSIC[probe.biome] ?? BIOME_MUSIC.gruenhain;
    switch (mood) {
      case 'titel':
        piece = MOOD_MUSIC.titel;
        break;
      case 'basis':
        piece = MOOD_MUSIC.basis;
        break;
      case 'kampf':
        piece = MOOD_MUSIC.kampf;
        out.layers.gefahr = Math.max(FIGHT_DANGER_MIN, dangerGain(probe.dangerTiles));
        break;
      case 'boss':
        piece = probe.boss !== '' && this.options.hasPiece(probe.boss) ? probe.boss : MOOD_MUSIC.kampf;
        out.layers.gefahr = 1;
        break;
      case 'gewoelbe':
        if (biome !== undefined) piece = biome.stueck;
        arrangement = 'nacht';
        out.layers.melodie = 0;
        out.layers.gefahr = dangerGain(probe.dangerTiles);
        break;
      case 'erkundung':
        if (biome !== undefined) {
          piece = biome.stueck;
          arrangement = biome.arrangement ?? (probe.night ? 'nacht' : 'tag');
          if (biome.ohneMelodie === true) out.layers.melodie = 0;
        }
        out.layers.gefahr = dangerGain(probe.dangerTiles);
        break;
      case 'stille':
        break;
    }
    // Quiet nights: after one pass of the night's piece, a rest.
    const quietNight = mood === 'erkundung' && probe.night && probe.dangerTiles < 0;
    if (!quietNight) this.quietUntil = Number.NEGATIVE_INFINITY;
    else {
      if (probe.day !== this.quietDay) {
        this.quietDay = probe.day;
        this.quietCount = 0;
      }
      if (now < this.quietUntil) {
        piece = '';
        out.fadeSeconds = QUIET_FADE_SECONDS;
      } else if (piece !== '' && piece === this.current && arrangement === this.currentArrangement && now - this.startedAt >= this.options.pieceSeconds(piece, arrangement)) {
        const u = hashToUnit(hash3(this.options.seed, probe.day, this.quietCount));
        this.quietCount++;
        this.quietUntil = now + QUIET_MIN_SECONDS + (QUIET_MAX_SECONDS - QUIET_MIN_SECONDS) * u;
        piece = '';
        out.fadeSeconds = QUIET_FADE_SECONDS;
      }
    }
    if (piece !== this.current || (piece !== '' && arrangement !== this.currentArrangement)) {
      this.current = piece;
      this.currentArrangement = arrangement;
      this.startedAt = now;
    }
    out.piece = piece;
    out.arrangement = arrangement;
    return out;
  }
}
