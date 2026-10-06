/**
 * "Am Herdfeuer" – the base theme (M7-05; docs/SPIEL.md §24 "basis (in einer Herdfeuerzone, keine Gefahr)"): a cosy waltz
 * in F major at 80 BPM, three beats of four rows. The accordion sings over an electric-piano "oom-pah-pah", a lute picks
 * eighths in the gaps, a soft kick on one and the shaker on two and three. The bell joins in the last turn.
 *
 * Form: i · A A' · B B' · A A' · C C' · A A'. 11 patterns of 4 bars ≈ 99 s, looping from the start. No danger layer: the
 * base music plays only while nothing hunts the player.
 *
 * Channels: 0 bass · 1, 2, 7 piano chord · 3 lute · 4 accordion · 5 bell · 6 kick and shaker.
 */
import { PatternBuilder, arpeggio, chord, chordNotes, n, root } from './compose';
import { ECHO_WEICH, idx, instruments, type PaletteName } from './instrumente';
import type { MusicPieceInput, TrackerPatternInput } from './schema';

const NAMES: readonly PaletteName[] = ['bass', 'epiano', 'laute', 'zunge', 'glocke', 'kick', 'shaker'];
const I = (name: PaletteName): number => idx(NAMES, name);
const BAR = 12;
const ROWS = 4 * BAR;

interface Section {
  readonly id: string;
  readonly chords: readonly string[];
  readonly melody?: string;
  readonly counter?: string;
}

function section(s: Section): TrackerPatternInput {
  const p = new PatternBuilder(s.id, ROWS, 8);
  s.chords.forEach((sym, bar) => {
    const o = bar * BAR;
    const c = chord(sym);
    // Oom: the root on one (the fifth in every second bar for a walking feel); pah-pah: the chord on two and three.
    p.note(0, o, root(c, 2) + (bar % 2 === 1 ? 7 : 0), I('bass'), { vol: 58 });
    const tones = chordNotes(c, 4);
    for (const beat of [4, 8]) {
      p.note(1, o + beat, tones[0] as number, I('epiano'), { vol: beat === 4 ? 38 : 30 });
      p.note(2, o + beat, tones[1] as number, I('epiano'), { vol: beat === 4 ? 38 : 30 });
      p.note(7, o + beat, tones[2] as number, I('epiano'), { vol: beat === 4 ? 38 : 30 });
    }
    p.hits(6, I('kick'), n('A1'), 'x...........', o, 30);
    p.hits(6, I('shaker'), n('C6'), '....o...o...', o, 64, 26);
  });
  // Lute: eighths in the gaps of the melody, an octave below it.
  arpeggio(p, 3, I('laute'), s.chords, BAR, 3, [2, 3, 4, 3, 2, 3], 2, 26);
  if (s.melody !== undefined) p.line(4, I('zunge'), s.melody);
  if (s.counter !== undefined) p.line(5, I('glocke'), s.counter);
  return p.build();
}

const A1 = ['F', 'Gm', 'C', 'F'];
const A2 = ['F', 'Bb', 'C7', 'F'];
const B1 = ['Dm', 'Am', 'Bb', 'F'];
const B2 = ['Gm', 'C', 'F', 'F'];
const C1 = ['Bb', 'F', 'Gm', 'C'];
const C2 = ['Bb', 'F', 'C7', 'F'];

const MEL_A1 = 'C5:4 F5:4 A5:4 | G5:8 Bb5:4 | C6:4 Bb5:4 G5:4 | A5:8 r:4';
const MEL_A2 = 'C5:4 F5:4 A5:4 | D6:8 Bb5:4 | C6:4 E5:4 G5:4 | F5:8 r:4';
const MEL_B1 = 'A5:6 G5:2 F5:4 | E5:8 C5:4 | D5:4 F5:4 Bb5:4 | A5:8 r:4';
const MEL_B2 = 'Bb5:6 A5:2 G5:4 | E5:4 G5:4 C6:4 | A5:12 | F5:4 C5:4 A4:4';
const MEL_C1 = 'F5:4 D5:4 F5:4 | A5:8 F5:4 | G5:4 Bb5:4 D6:4 | C6:8 G5:4';
const MEL_C2 = 'D6:6 C6:2 Bb5:4 | A5:6 G5:2 F5:4 | E5:4 G5:4 Bb5:4 | A5:8 r:4';
const CNT_C1 = 'r:4 D6:8 | r:4 C6:8 | r:4 Bb5:8 | r:4 E6:8';
const CNT_C2 = 'r:4 F6:8 | r:4 C6:8 | r:4 E6:8 | F6:12';

const PATTERNS: TrackerPatternInput[] = [
  section({ id: 'i', chords: A1 }),
  section({ id: 'a1', chords: A1, melody: MEL_A1 }),
  section({ id: 'a2', chords: A2, melody: MEL_A2 }),
  section({ id: 'b1', chords: B1, melody: MEL_B1 }),
  section({ id: 'b2', chords: B2, melody: MEL_B2 }),
  section({ id: 'c1', chords: C1, melody: MEL_C1, counter: CNT_C1 }),
  section({ id: 'c2', chords: C2, melody: MEL_C2, counter: CNT_C2 }),
];

export const MUSIK_BASIS: MusicPieceInput = {
  id: 'basis',
  titel: { de: 'Am Herdfeuer', en: 'By the Hearth' },
  bpm: 80,
  zeilenJeSchlag: 4,
  instrumente: instruments(NAMES),
  patterns: PATTERNS,
  arrangements: [{ art: 'standard', folge: ['i', 'a1', 'a2', 'b1', 'b2', 'a1', 'a2', 'c1', 'c2', 'a1', 'a2'], loopAb: 0 }],
  schichten: { basis: [0, 1, 2, 3, 6, 7], melodie: [4, 5], gefahr: [] },
  echo: ECHO_WEICH,
  zaehlt: true,
};
