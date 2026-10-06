/**
 * "Der Borkenvater" – the theme of the first boss (M7-05; docs/SPIEL.md §24 "boss (erwachter Boss)", §29 Musikstück
 * `borkenvater`): C minor at 120 BPM, old wood and slow anger. A horn states the theme over drawbar organ, a saw bass and
 * timpani; harp sixteenths keep the tension; in the third part the harmony sinks a semitone to Db (Phrygian) and the horn
 * repeats a creaking three-note cell. The danger layer adds a dark-saw ostinato and toms on every beat.
 *
 * Form: A A' · B B' · C C' · A with the bell · A' · B B' · C C'. 12 patterns of 4 bars = 96 s, looping from the start.
 *
 * Channels: 0 bass · 1–2 organ · 3 harp · 4 horn · 5 timpani and bell · 6 kick and snare · 7 danger.
 */
import { PatternBuilder, arpeggio, bass, chord, n, pad, root } from './compose';
import { ECHO_WEIT, idx, instruments, type PaletteName } from './instrumente';
import type { MusicPieceInput, TrackerPatternInput } from './schema';

const NAMES: readonly PaletteName[] = ['saegebass', 'orgel', 'harfe', 'horn', 'pauke', 'glocke', 'kick', 'snare', 'dunkel', 'tom'];
const I = (name: PaletteName): number => idx(NAMES, name);
const ROWS = 64;
const BAR = 16;

interface Section {
  readonly id: string;
  readonly chords: readonly string[];
  readonly melody: string;
  readonly counter?: string;
}

function section(s: Section): TrackerPatternInput {
  const p = new PatternBuilder(s.id, ROWS, 8);
  bass(p, 0, I('saegebass'), s.chords, BAR, 2, 'x...x.x.x...x.o.', 62);
  pad(p, [1, 2], I('orgel'), s.chords, BAR, 4, 40, 0);
  arpeggio(p, 3, I('harfe'), s.chords, BAR, 4, [0, 1, 2, 3], 1, 22);
  p.line(4, I('horn'), s.melody);
  for (let bar = 0; bar < 4; bar++) {
    const o = bar * BAR;
    const c = chord(s.chords[bar] as string);
    const r = root(c, 2);
    p.note(5, o, r, I('pauke'), { vol: 50 });
    if (bar % 2 === 1) p.note(5, o + 8, r, I('pauke'), { vol: 36 });
    p.hits(6, I('kick'), n('A1'), 'x...x.x.x...x...', o, 60);
    p.hits(6, I('snare'), n('C6'), '....x.......x...', o, 50);
    // Danger: the dark saw on the root in eighths, a tom on every beat.
    for (let b = 0; b < 4; b++) {
      p.note(7, o + b * 4, r + 12, I('tom'), { vol: 46 });
      p.note(7, o + b * 4 + 2, r, I('dunkel'), { vol: 48 });
    }
  }
  if (s.counter !== undefined) {
    // The bell shares the timpani's channel: it rings on the off-beats of its line.
    let row = 0;
    for (const token of s.counter.split(/\s+/)) {
      if (token === '' || token === '|') continue;
      const [what, len] = token.split(':') as [string, string];
      if (what !== 'r') p.note(5, row + 4, n(what), I('glocke'), { vol: 36 });
      row += Number(len);
    }
  }
  return p.build();
}

const A1 = ['Cm', 'Ab', 'Bb', 'G'];
const A2 = ['Cm', 'Ab', 'Fm', 'G'];
const B1 = ['Ab', 'Eb', 'Bb', 'Cm'];
const B2 = ['Ab', 'Eb', 'Fm', 'G'];
const C1 = ['Cm', 'Cm', 'Db', 'Db'];
const C2 = ['Cm', 'Cm', 'G', 'G'];

const MEL_A1 = 'C5:6 Eb5:2 G5:8 | Ab5:6 G5:2 Eb5:4 C5:4 | D5:6 F5:2 Bb5:8 | B4:8 D5:4 G5:4';
const MEL_A2 = 'C5:6 Eb5:2 G5:6 F5:2 | Eb5:8 C5:4 Ab4:4 | F5:6 Ab5:2 C6:8 | B5:8 D6:4 G5:4';
const MEL_B1 = 'C6:6 Bb5:2 Ab5:8 | G5:6 F5:2 Eb5:8 | F5:6 D5:2 Bb4:8 | C5:12 r:4';
const MEL_B2 = 'Eb6:6 C6:2 Ab5:8 | Bb5:6 G5:2 Eb5:8 | Ab5:6 F5:2 C5:8 | D5:4 G5:4 B5:8';
const MEL_C1 = 'G5:2 Ab5:2 G5:4 r:8 | G5:2 Ab5:2 G5:4 Eb5:8 | Ab5:2 Bb5:2 Ab5:4 r:8 | F5:2 Ab5:2 Db6:8 F5:4';
const MEL_C2 = 'G5:2 Ab5:2 G5:4 r:8 | Eb6:8 C6:8 | D6:8 B5:8 | G5:16';
const CNT_A1 = 'G6:16 | Eb6:16 | F6:16 | D6:16';

const PATTERNS: TrackerPatternInput[] = [
  section({ id: 'a1', chords: A1, melody: MEL_A1 }),
  section({ id: 'a2', chords: A2, melody: MEL_A2 }),
  section({ id: 'b1', chords: B1, melody: MEL_B1 }),
  section({ id: 'b2', chords: B2, melody: MEL_B2 }),
  section({ id: 'c1', chords: C1, melody: MEL_C1 }),
  section({ id: 'c2', chords: C2, melody: MEL_C2 }),
  section({ id: 'a1g', chords: A1, melody: MEL_A1, counter: CNT_A1 }),
];

export const MUSIK_BORKENVATER: MusicPieceInput = {
  id: 'borkenvater',
  titel: { de: 'Der Borkenvater', en: 'The Barkfather' },
  bpm: 120,
  zeilenJeSchlag: 4,
  instrumente: instruments(NAMES),
  patterns: PATTERNS,
  arrangements: [{ art: 'standard', folge: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'a1g', 'a2', 'b1', 'b2', 'c1', 'c2'], loopAb: 0 }],
  schichten: { basis: [0, 1, 2, 3, 5, 6], melodie: [4], gefahr: [7] },
  echo: ECHO_WEIT,
  zaehlt: true,
};
