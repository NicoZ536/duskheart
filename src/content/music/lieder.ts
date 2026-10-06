/**
 * The songs of the player's instruments (M7-31; docs/SPIEL.md §24 "die Melodien sind kurze Tracker-Lieder (`songs`)", §29
 * `lied_<n>`): short loops the flute and the lute play in the world while the player makes music (fear −2/s around them).
 * Their pieces do not count towards §C "Musikstücke" (`zaehlt: false`). Solo instruments: the flute alone, the lute with
 * its own bass strings.
 *
 * - `lied_1` „Wiegenlied“ (flute) – a lullaby in G major, three-four time, 72 BPM (20 s).
 * - `lied_2` „Wanderweise“ (flute) – a walking tune in D major, 104 BPM (18 s).
 * - `lied_3` „Herdlied“ (lute) – a hearth song in A minor, 92 BPM, melody over bass strings (21 s).
 * - `lied_4` „Abendstern“ (lute) – an evening song in F major, three-four time, 76 BPM (19 s).
 */
import { PatternBuilder } from './compose';
import { ECHO_WEICH, idx, instruments, type PaletteName } from './instrumente';
import type { MusicPieceInput, SongInput } from './schema';

function song(id: string, titel: MusicPieceInput['titel'], bpm: number, rows: number, names: readonly PaletteName[], parts: readonly (readonly [melody: string, bassLine?: string])[]): MusicPieceInput {
  // The flute plays alone (one channel), the lute adds its bass strings (a second one).
  const channels = parts.some(([, b]) => b !== undefined) ? 2 : 1;
  const patterns = parts.map(([melody, bassLine], k) => {
    const p = new PatternBuilder(`p${k + 1}`, rows, channels);
    p.line(0, idx(names, names[0] as PaletteName), melody);
    if (bassLine !== undefined) p.line(1, idx(names, names[0] as PaletteName), bassLine, 0, 0, 40);
    return p.build();
  });
  return {
    id,
    titel,
    bpm,
    zeilenJeSchlag: 4,
    instrumente: instruments(names),
    patterns,
    arrangements: [{ art: 'standard', folge: patterns.map((p) => p.id), loopAb: 0 }],
    schichten: { basis: channels === 2 ? [1] : [], melodie: [0], gefahr: [] },
    echo: ECHO_WEICH,
    zaehlt: false,
  };
}

const WIEGENLIED = song('lied_wiegenlied', { de: 'Wiegenlied', en: 'Lullaby' }, 72, 48, ['floete'], [
  ['B4:4 A4:4 G4:4 | A4:8 F#4:4 | G4:4 B4:4 D5:4 | E5:8 D5:4'],
  ['D5:4 E5:4 D5:4 | B4:8 G4:4 | A4:4 B4:4 A4:4 | G4:8 r:4'],
]);

const WANDERWEISE = song('lied_wanderweise', { de: 'Wanderweise', en: 'Wayfarer’s Tune' }, 104, 64, ['floete'], [
  ['D5:4 F#5:4 A5:6 G5:2 | F#5:4 E5:4 D5:8 | E5:4 F#5:4 G5:4 E5:4 | A5:12 r:4'],
  ['B5:4 A5:4 G5:4 F#5:4 | E5:6 F#5:2 G5:8 | F#5:4 E5:4 C#5:4 E5:4 | D5:12 r:4'],
]);

const HERDLIED = song('lied_herdlied', { de: 'Herdlied', en: 'Hearth Song' }, 92, 64, ['laute'], [
  ['A4:4 C5:4 E5:4 C5:4 | D5:4 F5:4 A5:8 | G#5:4 E5:4 B4:4 D5:4 | C5:8 A4:8', 'A2:8 E3:8 | D3:8 A2:8 | E2:8 B2:8 | A2:16'],
  ['A5:6 G5:2 F5:8 | E5:6 D5:2 C5:8 | D5:4 F5:4 E5:4 G#5:4 | A5:12 r:4', 'F2:16 | C3:16 | D3:8 E3:8 | A2:16'],
]);

const ABENDSTERN = song('lied_abendstern', { de: 'Abendstern', en: 'Evening Star' }, 76, 48, ['laute'], [
  ['C5:4 F5:4 A5:4 | G5:8 E5:4 | F5:4 D5:4 A4:4 | Bb4:8 D5:4', 'F2:12 | C3:12 | D3:12 | Bb2:12'],
  ['A5:6 G5:2 F5:4 | E5:4 G5:4 C5:4 | F5:12 | r:12', 'F2:12 | C3:12 | F2:12 | r:12'],
]);

export const SONG_PIECES: readonly MusicPieceInput[] = [WIEGENLIED, WANDERWEISE, HERDLIED, ABENDSTERN];

export const SONGS: readonly SongInput[] = [
  { id: 'lied_1', name: { de: 'Wiegenlied', en: 'Lullaby' }, stueck: WIEGENLIED.id, instrument: 'floete' },
  { id: 'lied_2', name: { de: 'Wanderweise', en: 'Wayfarer’s Tune' }, stueck: WANDERWEISE.id, instrument: 'floete' },
  { id: 'lied_3', name: { de: 'Herdlied', en: 'Hearth Song' }, stueck: HERDLIED.id, instrument: 'laute' },
  { id: 'lied_4', name: { de: 'Abendstern', en: 'Evening Star' }, stueck: ABENDSTERN.id, instrument: 'laute' },
];
