/**
 * "Klingen im Dämmer" – the fight (M7-05; docs/SPIEL.md §24 "kampf (Gegner jagt den Spieler)"): A minor at 140 BPM. A
 * resonant saw bass drives eighths, a hollow square spins sixteenth arpeggios, strings hold the harmony, the pulse lead
 * cuts through; kick and snare in the base layer, sixteenth hats and tom fills in the danger layer (it rises with the
 * nearest hunter, docs/SPIEL.md §24).
 *
 * Form: A A' · B B' (Dm–Am–Bb–E7, the Neapolitan turn) · A A' · C C' (breakdown: the lead holds long notes) · A A' · B B' ·
 * A with the bell · A'. 14 patterns of 4 bars ≈ 96 s, looping from the start.
 *
 * Channels: 0 bass · 1 arpeggio · 2–3 strings · 4 lead · 5 bell · 6 kick and snare · 7 danger (hats, toms).
 */
import { PatternBuilder, arpeggio, bass, n, pad } from './compose';
import { ECHO_KURZ, idx, instruments, type PaletteName } from './instrumente';
import type { MusicPieceInput, TrackerPatternInput } from './schema';

const NAMES: readonly PaletteName[] = ['saegebass', 'hohl', 'streicher', 'puls', 'glocke', 'kick', 'snare', 'hihat', 'tom'];
const I = (name: PaletteName): number => idx(NAMES, name);
const ROWS = 64;
const BAR = 16;

interface Section {
  readonly id: string;
  readonly chords: readonly string[];
  readonly melody?: string;
  readonly counter?: string;
  readonly breakdown?: boolean;
}

function section(s: Section): TrackerPatternInput {
  const p = new PatternBuilder(s.id, ROWS, 8);
  bass(p, 0, I('saegebass'), s.chords, BAR, 2, s.breakdown === true ? 'x.......x.......' : 'x.x.8.x.x.x.8.x.', 60);
  if (s.breakdown !== true) arpeggio(p, 1, I('hohl'), s.chords, BAR, 4, [0, 1, 2, 1], 1, 24);
  pad(p, [2, 3], I('streicher'), s.chords, BAR, 4, 42, 1);
  if (s.melody !== undefined) p.line(4, I('puls'), s.melody);
  if (s.counter !== undefined) p.line(5, I('glocke'), s.counter);
  for (let bar = 0; bar < 4; bar++) {
    const o = bar * BAR;
    if (s.breakdown === true) p.hits(6, I('kick'), n('A1'), 'x.......x.......', o, 52);
    else {
      p.hits(6, I('kick'), n('A1'), 'x.....x.x.......', o, 60);
      p.hits(6, I('snare'), n('C6'), '....x.......x...', o, 52);
    }
    // Danger: sixteenth hats with accents on the beats, a tom fill in the last bar of the pattern.
    p.hits(7, I('hihat'), n('C7'), bar === 3 ? 'xoxoxoxo........' : 'xoxoxoxoxoxoxoxo', o, 52, 30);
    if (bar === 3) {
      const fill = [n('E3'), n('E3'), n('C3'), n('C3'), n('A2'), n('A2'), n('E2'), n('E2')];
      fill.forEach((note, k) => p.note(7, o + 8 + k, note, I('tom'), { vol: 40 + k * 3 }));
    }
  }
  return p.build();
}

const A1 = ['Am', 'F', 'G', 'Em'];
const A2 = ['Am', 'F', 'G', 'E'];
const B1 = ['Dm', 'Am', 'F', 'E'];
const B2 = ['Dm', 'Am', 'Bb', 'E7'];
const C1 = ['Am', 'Am', 'F', 'F'];
const C2 = ['G', 'G', 'E', 'E'];

const MEL_A1 = 'A5:2 C6:2 E6:4 D6:2 C6:2 B5:2 C6:2 | A5:4 F5:4 C6:6 A5:2 | B5:4 G5:4 D6:4 B5:4 | E6:8 D6:2 B5:2 G5:4';
const MEL_A2 = 'A5:2 C6:2 E6:4 D6:2 C6:2 B5:2 C6:2 | A5:4 F5:4 C6:6 D6:2 | D6:4 B5:4 G5:4 B5:4 | G#5:8 B5:4 E6:4';
const MEL_B1 = 'F6:4 E6:2 D6:2 A5:8 | C6:4 B5:2 A5:2 E5:8 | F5:4 A5:4 C6:4 F6:4 | E6:8 G#5:8';
const MEL_B2 = 'D6:4 F6:4 A6:8 | E6:4 C6:4 A5:8 | Bb5:4 D6:4 F6:8 | E6:4 D6:2 B5:2 G#5:8';
const MEL_C1 = 'A5:16 | E5:16 | F5:16 | C6:16';
const MEL_C2 = 'B5:16 | D6:16 | B5:16 | G#5:16';
const CNT_A1 = 'E6:8 r:8 | C6:8 r:8 | D6:8 r:8 | B5:8 r:8';

const PATTERNS: TrackerPatternInput[] = [
  section({ id: 'a1', chords: A1, melody: MEL_A1 }),
  section({ id: 'a2', chords: A2, melody: MEL_A2 }),
  section({ id: 'b1', chords: B1, melody: MEL_B1 }),
  section({ id: 'b2', chords: B2, melody: MEL_B2 }),
  section({ id: 'c1', chords: C1, melody: MEL_C1, breakdown: true }),
  section({ id: 'c2', chords: C2, melody: MEL_C2, breakdown: true }),
  section({ id: 'a1g', chords: A1, melody: MEL_A1, counter: CNT_A1 }),
];

export const MUSIK_KAMPF: MusicPieceInput = {
  id: 'kampf',
  titel: { de: 'Klingen im Dämmer', en: 'Blades at Dusk' },
  bpm: 140,
  zeilenJeSchlag: 4,
  instrumente: instruments(NAMES),
  patterns: PATTERNS,
  arrangements: [{ art: 'standard', folge: ['a1', 'a2', 'b1', 'b2', 'a1', 'a2', 'c1', 'c2', 'a1', 'a2', 'b1', 'b2', 'a1g', 'a2'], loopAb: 0 }],
  schichten: { basis: [0, 1, 2, 3, 6], melodie: [4, 5], gefahr: [7] },
  echo: ECHO_KURZ,
  zaehlt: true,
};
