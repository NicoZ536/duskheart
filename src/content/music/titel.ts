/**
 * "Duskhearth" – the title theme (M7-05; docs/SPIEL.md §24, §29): D minor at 84 BPM, dusk over the coast and the first
 * fire. A warm horn sings over choir, harp and triangle bass; a glass bell answers in the last turn; timpani swell at the
 * end of every phrase and roll into the bright part.
 *
 * Form: i (Dm–Bb–F–C, the accompaniment alone) · A (the theme, ending on A major) · B (rising to D6, A7 into) · C (the
 * hopeful turn to F major) · A with the bell · A. 9 patterns of 4 bars ≈ 103 s, looping from the start – the accompaniment
 * of i leads back into the theme. No danger layer.
 *
 * Channels: 0 bass · 1 harp · 2–3 choir · 4 horn · 5 bell · 6 timpani · 7 shaker.
 */
import { PatternBuilder, arpeggio, bass, n, pad } from './compose';
import { ECHO_WEIT, idx, instruments, type PaletteName } from './instrumente';
import type { MusicPieceInput, TrackerPatternInput } from './schema';

const NAMES: readonly PaletteName[] = ['bass', 'harfe', 'chor', 'horn', 'glocke', 'pauke', 'shaker'];
const I = (name: PaletteName): number => idx(NAMES, name);
const ROWS = 64;
const BAR = 16;

interface Section {
  readonly id: string;
  readonly chords: readonly string[];
  readonly melody?: string;
  readonly counter?: string;
  /** Timpani: on the first beat of every bar (`schlag`), every other bar (`ruhig`), or a roll in the last bar (`wirbel`). */
  readonly pauke: 'ruhig' | 'schlag' | 'wirbel';
}

function section(s: Section): TrackerPatternInput {
  const p = new PatternBuilder(s.id, ROWS, 8);
  bass(p, 0, I('bass'), s.chords, BAR, 2, 'x.......5.......', 56);
  arpeggio(p, 1, I('harfe'), s.chords, BAR, 4, [0, 1, 2, 3, 4, 3, 2, 1], 2, 32);
  pad(p, [2, 3], I('chor'), s.chords, BAR, 4, 46, 1);
  if (s.melody !== undefined) p.line(4, I('horn'), s.melody);
  if (s.counter !== undefined) p.line(5, I('glocke'), s.counter);
  for (let bar = 0; bar < 4; bar++) {
    const o = bar * BAR;
    const low = n('D2');
    if (s.pauke === 'schlag' || (s.pauke === 'ruhig' && bar % 2 === 0)) p.note(6, o, low, I('pauke'), { vol: s.pauke === 'schlag' ? 44 : 34 });
    if (s.pauke === 'wirbel' && bar < 3) p.note(6, o, low, I('pauke'), { vol: 36 });
    p.hits(7, I('shaker'), n('C6'), '..o...o...o...o.', o, 64, 22);
  }
  if (s.pauke === 'wirbel') {
    // A crescendo roll on A over the last bar, into the next part.
    for (let k = 0; k < 8; k++) p.note(6, 48 + 8 + k, n('A1'), I('pauke'), { vol: 22 + k * 4 });
  }
  return p.build();
}

const A1 = ['Dm', 'Bb', 'F', 'C'];
const A2 = ['Dm', 'Bb', 'Gm', 'A'];
const B1 = ['Bb', 'F', 'C', 'Dm'];
const B2 = ['Bb', 'F', 'Gm', 'A7'];
const C1 = ['F', 'C', 'Dm', 'Bb'];
const C2 = ['F', 'C', 'Bb', 'C'];

const MEL_A1 = 'A4:6 D5:2 F5:8 | F5:4 D5:4 Bb4:8 | C5:6 A4:2 F4:4 A4:4 | G4:12 r:4';
const MEL_A2 = 'A4:6 D5:2 F5:6 E5:2 | D5:8 Bb4:4 D5:4 | G5:6 F5:2 D5:4 Bb4:4 | A4:8 C#5:4 E5:4';
const MEL_B1 = 'F5:6 G5:2 F5:4 D5:4 | C5:6 D5:2 C5:4 A4:4 | E5:6 G5:2 E5:4 C5:4 | D5:12 r:4';
const MEL_B2 = 'D6:6 C6:2 Bb5:4 F5:4 | A5:6 G5:2 F5:4 C5:4 | Bb5:6 A5:2 G5:4 D5:4 | C#5:8 E5:4 G5:4';
const MEL_C1 = 'F5:8 A5:8 | G5:6 E5:2 C5:8 | D5:6 F5:2 A5:8 | Bb5:6 A5:2 F5:8';
const MEL_C2 = 'A5:6 C6:2 A5:4 F5:4 | G5:12 E5:4 | F5:6 D5:2 Bb4:8 | C5:8 E5:4 G5:4';
// The bell answers each phrase an octave up on its long notes.
const CNT_A1 = 'r:8 F6:8 | r:8 D6:8 | r:8 A5:8 | G5:8 E5:8';
const CNT_A2 = 'r:8 F6:8 | r:8 D6:8 | r:8 D6:8 | E6:8 C#6:8';

const PATTERNS: TrackerPatternInput[] = [
  section({ id: 'i', chords: A1, pauke: 'ruhig' }),
  section({ id: 'a1', chords: A1, melody: MEL_A1, pauke: 'ruhig' }),
  section({ id: 'a2', chords: A2, melody: MEL_A2, pauke: 'ruhig' }),
  section({ id: 'b1', chords: B1, melody: MEL_B1, pauke: 'schlag' }),
  section({ id: 'b2', chords: B2, melody: MEL_B2, pauke: 'wirbel' }),
  section({ id: 'c1', chords: C1, melody: MEL_C1, pauke: 'schlag' }),
  section({ id: 'c2', chords: C2, melody: MEL_C2, pauke: 'ruhig' }),
  section({ id: 'a1g', chords: A1, melody: MEL_A1, counter: CNT_A1, pauke: 'ruhig' }),
  section({ id: 'a2g', chords: A2, melody: MEL_A2, counter: CNT_A2, pauke: 'ruhig' }),
];

export const MUSIK_TITEL: MusicPieceInput = {
  id: 'titel',
  titel: { de: 'Duskhearth', en: 'Duskhearth' },
  bpm: 84,
  zeilenJeSchlag: 4,
  instrumente: instruments(NAMES),
  patterns: PATTERNS,
  arrangements: [{ art: 'standard', folge: ['i', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'a1g', 'a2g'], loopAb: 0 }],
  schichten: { basis: [0, 1, 2, 3, 6, 7], melodie: [4, 5], gefahr: [] },
  echo: ECHO_WEIT,
  zaehlt: true,
};
