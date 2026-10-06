/**
 * "Grünhain" (M7-05; docs/SPIEL.md §24, §29 – the theme of the start region with a day and a night arrangement):
 *
 * - **Tag** – G major, 100 BPM, a wooden flute over plucked harp, string pad and triangle bass, a light pastoral groove of
 *   kick, snare and shaker. Form: accompaniment (i) · A A' · B B' · A with a bell counter-line · C (the bridge over
 *   C–D–Bm–Em, rising into D7) · A. 11 patterns of 4 bars ≈ 106 s, looping from the start.
 * - **Nacht** – E minor colours (with B7 from harmonic minor), glass bells instead of the flute, choir pad, the harp only on
 *   quarters, no drums: the ambience's crickets carry the rhythm. ≈ 106 s.
 * - **Gefahr** layer (both): a tom and dark-saw ostinato on the bar's root – the danger percussion that rises when an enemy
 *   hunts the player nearby (docs/SPIEL.md §24 "Gefahren-Percussion").
 *
 * Channels: 0 bass · 1 harp · 2–3 pad · 4 lead · 5 counter-line · 6 drums · 7 danger.
 */
import { PatternBuilder, arpeggio, bass, chord, n, pad, root } from './compose';
import { ECHO_WEICH, idx, instruments, type PaletteName } from './instrumente';
import type { MusicPieceInput, TrackerPatternInput } from './schema';

const NAMES: readonly PaletteName[] = ['bass', 'harfe', 'streicher', 'chor', 'floete', 'glocke', 'glas', 'kick', 'snare', 'shaker', 'tom', 'dunkel'];
const I = (name: PaletteName): number => idx(NAMES, name);
const ROWS = 64;
const BAR = 16;
const CHANNELS = 8;

/** One pattern of four bars. */
interface Section {
  readonly id: string;
  readonly chords: readonly string[];
  readonly melody?: string;
  readonly lead?: PaletteName;
  readonly counter?: string;
  readonly night: boolean;
  readonly drums: 'keine' | 'shaker' | 'leicht';
}

function section(s: Section): TrackerPatternInput {
  const p = new PatternBuilder(s.id, ROWS, CHANNELS);
  // Bass: root on one, fifth on three, the root again as an upbeat (day); a long root per bar at night.
  bass(p, 0, I('bass'), s.chords, BAR, 2, s.night ? 'x...............' : 'x.......5...o...', s.night ? 50 : 60);
  // Harp: eighths up and down the chord by day, quarters at night.
  if (s.night) arpeggio(p, 1, I('harfe'), s.chords, BAR, 4, [0, 2, 3, 1], 4, 34);
  else arpeggio(p, 1, I('harfe'), s.chords, BAR, 4, [0, 1, 2, 3, 4, 3, 2, 1], 2, 36);
  // Pad: third and fifth held per bar – strings by day, choir at night.
  pad(p, [2, 3], s.night ? I('chor') : I('streicher'), s.chords, BAR, 4, s.night ? 44 : 40, 1);
  if (s.melody !== undefined) p.line(4, I(s.lead ?? 'floete'), s.melody);
  if (s.counter !== undefined) p.line(5, I('glocke'), s.counter);
  for (let bar = 0; bar < 4; bar++) {
    const o = bar * BAR;
    if (s.drums === 'leicht') {
      p.hits(6, I('kick'), n('A1'), 'x.......x.......', o, 50);
      p.hits(6, I('snare'), n('C6'), '....o.......o...', o, 64, 26);
      p.hits(6, I('shaker'), n('C6'), '..o...o...o...o.', o, 64, 40);
    } else if (s.drums === 'shaker') p.hits(6, I('shaker'), n('C6'), '..o...o...o...o.', o, 64, 34);
    // Danger: tom on the beats, dark saw pulsing on the root in between.
    const c = chord(s.chords[bar] as string);
    const r = root(c, 2);
    p.note(7, o, r + 12, I('tom'), { vol: 56 });
    p.note(7, o + 2, r, I('dunkel'), { vol: 46 });
    p.note(7, o + 3, r, I('dunkel'), { vol: 34 });
    p.note(7, o + 4, r + 12, I('tom'), { vol: 44 });
    p.note(7, o + 6, r, I('dunkel'), { vol: 46 });
    p.note(7, o + 7, r + 7, I('dunkel'), { vol: 34 });
    p.note(7, o + 8, r + 12, I('tom'), { vol: 52 });
    p.note(7, o + 10, r, I('dunkel'), { vol: 46 });
    p.note(7, o + 11, r, I('dunkel'), { vol: 34 });
    p.note(7, o + 12, r + 12, I('tom'), { vol: 44 });
    p.note(7, o + 13, r + 19, I('tom'), { vol: 40 });
    p.note(7, o + 14, r, I('dunkel'), { vol: 46 });
    p.note(7, o + 15, r + 3 + (c.tones[1] === 4 ? 1 : 0), I('dunkel'), { vol: 34 });
  }
  return p.build();
}

const DAY_A = ['G', 'D', 'Em', 'C'];
const DAY_A2 = ['G', 'D', 'C', 'D'];
const DAY_B = ['Em', 'C', 'G', 'D'];
const DAY_B2 = ['Em', 'C', 'Am', 'D'];
const DAY_C = ['C', 'D', 'Bm', 'Em'];
const DAY_C2 = ['C', 'Am', 'D', 'D7'];

const MEL_A1 = 'B4:4 D5:4 G5:6 F#5:2 | A5:6 G5:2 F#5:4 D5:4 | E5:4 G5:4 B5:6 A5:2 | G5:8 E5:4 r:4';
const MEL_A2 = 'B4:4 D5:4 G5:6 A5:2 | A5:6 B5:2 A5:4 F#5:4 | G5:4 E5:4 C5:4 E5:4 | D5:12 r:4';
const MEL_B1 = 'G5:6 F#5:2 E5:4 B4:4 | C5:4 E5:4 G5:8 | D5:6 E5:2 D5:4 B4:4 | A4:8 D5:4 F#5:4';
const MEL_B2 = 'G5:6 A5:2 B5:4 G5:4 | E5:6 G5:2 C6:8 | A5:4 C6:4 B5:4 A5:4 | F#5:8 r:4 A4:4';
const MEL_C1 = 'E5:8 D5:4 C5:4 | D5:8 F#5:4 A5:4 | B5:8 A5:4 F#5:4 | G5:12 E5:4';
const MEL_C2 = 'C5:4 E5:4 G5:4 C6:4 | C6:6 B5:2 A5:8 | F#5:4 A5:4 D6:8 | D6:8 C6:4 A5:4';
// The bell answers the flute a sixth below on the long notes.
const CNT_A1 = 'r:8 G4:8 | r:8 D5:8 | r:8 G5:8 | E5:8 C5:8';
const CNT_A2 = 'r:8 G4:8 | r:8 F#5:8 | r:8 C5:8 | A4:8 F#4:8';

const NIGHT_A = ['Em', 'C', 'G', 'D'];
const NIGHT_A2 = ['Em', 'Am', 'C', 'B7'];
const NIGHT_B = ['C', 'D', 'G', 'B7'];
const NIGHT_I = ['Em', 'C', 'Am', 'B7'];

const NMEL_A1 = 'B4:8 E5:8 | G5:12 E5:4 | D5:8 B4:8 | A4:12 r:4';
const NMEL_A2 = 'B4:8 E5:8 | A5:8 G5:4 E5:4 | E5:8 G5:8 | F#5:12 D#5:4';
const NMEL_B = 'E5:12 G5:4 | F#5:8 A5:8 | B5:12 G5:4 | A5:4 F#5:4 D#5:8';

const PATTERNS: TrackerPatternInput[] = [
  section({ id: 't_i', chords: DAY_A, night: false, drums: 'shaker' }),
  section({ id: 't_a1', chords: DAY_A, melody: MEL_A1, night: false, drums: 'leicht' }),
  section({ id: 't_a2', chords: DAY_A2, melody: MEL_A2, night: false, drums: 'leicht' }),
  section({ id: 't_b1', chords: DAY_B, melody: MEL_B1, night: false, drums: 'leicht' }),
  section({ id: 't_b2', chords: DAY_B2, melody: MEL_B2, night: false, drums: 'leicht' }),
  section({ id: 't_a1g', chords: DAY_A, melody: MEL_A1, counter: CNT_A1, night: false, drums: 'leicht' }),
  section({ id: 't_a2g', chords: DAY_A2, melody: MEL_A2, counter: CNT_A2, night: false, drums: 'leicht' }),
  section({ id: 't_c1', chords: DAY_C, melody: MEL_C1, night: false, drums: 'shaker' }),
  section({ id: 't_c2', chords: DAY_C2, melody: MEL_C2, night: false, drums: 'shaker' }),
  section({ id: 'n_i', chords: NIGHT_I, night: true, drums: 'keine' }),
  section({ id: 'n_a1', chords: NIGHT_A, melody: NMEL_A1, lead: 'glas', night: true, drums: 'keine' }),
  section({ id: 'n_a2', chords: NIGHT_A2, melody: NMEL_A2, lead: 'glas', night: true, drums: 'keine' }),
  section({ id: 'n_b', chords: NIGHT_B, melody: NMEL_B, lead: 'glas', night: true, drums: 'keine' }),
  section({ id: 'n_b0', chords: NIGHT_B, night: true, drums: 'keine' }),
];

export const MUSIK_GRUENHAIN: MusicPieceInput = {
  id: 'gruenhain',
  titel: { de: 'Grünhain', en: 'Greengrove' },
  bpm: 100,
  zeilenJeSchlag: 4,
  instrumente: instruments(NAMES),
  patterns: PATTERNS,
  arrangements: [
    { art: 'tag', folge: ['t_i', 't_a1', 't_a2', 't_b1', 't_b2', 't_a1g', 't_a2g', 't_c1', 't_c2', 't_a1', 't_a2'], loopAb: 0 },
    { art: 'nacht', folge: ['n_i', 'n_a1', 'n_a2', 'n_b0', 'n_b', 'n_a1', 'n_a2', 'n_i', 'n_b', 'n_a1', 'n_a2'], loopAb: 0 },
  ],
  schichten: { basis: [0, 1, 2, 3, 6], melodie: [4, 5], gefahr: [7] },
  echo: ECHO_WEICH,
  zaehlt: true,
};
