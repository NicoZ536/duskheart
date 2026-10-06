/**
 * Events of making music and of the net (M7-31; docs/SPIEL.md §17 "`instrumentPlayed` / `instrumentStopped`"):
 *
 * - `instrumentPlayed`: the player began to play song `lied` on `instrument` at (x, y) on `layer` – the audio plays the song
 *   (src/audio/music), the chronicle and the statistics count it.
 * - `instrumentStopped`: the music ended – `gestoppt` (by the player), `bewegung` (a step, a roll, a jump, water), `handlung`
 *   (another action: a blow, eating, crafting …), `treffer`, `schlaf`, `tod`, `weg` (the instrument left its slot).
 * - `netSwung`: a swing of the net at (x, y) – `fang` the item caught (`gluehwuermchen`, `grille`) or null.
 */
import type { Layer } from '../../world/model/coords';

/** Why the music ended. */
export const INSTRUMENT_STOP_REASONS = ['gestoppt', 'bewegung', 'handlung', 'treffer', 'schlaf', 'tod', 'weg'] as const;
export type InstrumentStopReason = (typeof INSTRUMENT_STOP_REASONS)[number];

/**
 * Why an instrument command was refused: no player (`noPlayer`), dead or asleep, stunned, the slot holds no instrument
 * (`notAnInstrument`), a song the instrument does not know (`unknownSong`), in deep water (`swimming`), nothing played
 * (`notPlaying`).
 */
export const INSTRUMENT_REJECT_REASONS = ['noPlayer', 'dead', 'asleep', 'stunned', 'invalidSlot', 'notAnInstrument', 'unknownSong', 'swimming', 'notPlaying'] as const;
export type InstrumentRejectReason = (typeof INSTRUMENT_REJECT_REASONS)[number];

export interface InstrumentEventMap {
  instrumentPlayed: { readonly instrument: string; readonly lied: string; readonly layer: Layer; readonly x: number; readonly y: number; readonly tick: number };
  instrumentStopped: { readonly instrument: string; readonly lied: string; readonly grund: InstrumentStopReason; readonly tick: number };
  netSwung: { readonly fang: string | null; readonly layer: Layer; readonly x: number; readonly y: number; readonly tick: number };
}

/** Event names of `InstrumentEventMap`. */
export const INSTRUMENT_EVENT_TYPES = ['instrumentPlayed', 'instrumentStopped', 'netSwung'] as const satisfies ReadonlyArray<keyof InstrumentEventMap>;
