/**
 * Stingers (docs/SPIEL.md §24 "Stinger … ducken die Musik", §29 `entdeckung`, `leuchtfeuer`, `boss_besiegt`,
 * `stufenaufstieg`, `ereignis`): short pieces played once over the music, which ducks by `duckDb` while they sound. Their
 * pieces do not count towards §C "Musikstücke" (`zaehlt: false`). The event → stinger table is src/audio/music/stingers.ts.
 *
 * - `entdeckung` – a place discovered: a harp run up a G major chord into a bell and choir chord (3 s).
 * - `leuchtfeuer` – a beacon lit: a timpani roll under a horn climbing over C into F major, bells falling like sparks (8 s).
 * - `boss_besiegt` – a boss defeated: a horn call over G into a held C major with choir and timpani (6 s).
 * - `stufenaufstieg` – a skill level up: three bell notes up a C major chord over a harp sparkle (2 s).
 * - `ereignis` – a world event announced: low choir and horn sliding from D minor to E-flat, a dark pulse (7 s).
 */
import { PatternBuilder, n } from './compose';
import { ECHO_WEICH, ECHO_WEIT, idx, instruments, type PaletteName } from './instrumente';
import type { MusicPieceInput, StingerInput } from './schema';

function stinger(id: string, titel: MusicPieceInput['titel'], bpm: number, names: readonly PaletteName[], rows: number, write: (p: PatternBuilder, i: (name: PaletteName) => number) => void, weit: boolean): MusicPieceInput {
  const p = new PatternBuilder('s', rows, 6);
  write(p, (name) => idx(names, name));
  return {
    id,
    titel,
    bpm,
    zeilenJeSchlag: 4,
    instrumente: instruments(names),
    patterns: [p.build()],
    arrangements: [{ art: 'standard', folge: ['s'], loopAb: 1 }],
    schichten: { basis: [0, 1, 2, 3, 5], melodie: [4], gefahr: [] },
    echo: weit ? ECHO_WEIT : ECHO_WEICH,
    zaehlt: false,
  };
}

const ENTDECKUNG = stinger(
  'stinger_entdeckung',
  { de: 'Entdeckung', en: 'Discovery' },
  120,
  ['harfe', 'glocke', 'chor', 'bass'],
  24,
  (p, i) => {
    ['G4', 'B4', 'D5', 'G5', 'B5', 'D6'].forEach((note, k) => p.note(0, k, n(note), i('harfe'), { vol: 40 + k * 3 }));
    p.note(4, 6, n('G6'), i('glocke'), { vol: 52 });
    p.note(1, 8, n('B5'), i('glocke'), { vol: 40 });
    p.note(2, 0, n('B4'), i('chor'), { vol: 44 });
    p.note(3, 0, n('D5'), i('chor'), { vol: 44 });
    p.note(5, 0, n('G2'), i('bass'), { vol: 50 });
    p.off(2, 16).off(3, 16).off(5, 16);
  },
  false,
);

const LEUCHTFEUER = stinger(
  'stinger_leuchtfeuer',
  { de: 'Das Feuer brennt', en: 'The Fire Burns' },
  90,
  ['horn', 'chor', 'pauke', 'glocke', 'bass'],
  48,
  (p, i) => {
    for (let k = 0; k < 16; k++) p.note(0, k, n('C2'), i('pauke'), { vol: 14 + k * 3 });
    p.note(0, 16, n('F1'), i('pauke'), { vol: 64 });
    p.line(4, i('horn'), 'G4:4 C5:4 E5:4 G5:4 | A5:8 C6:20 | r:4');
    p.line(2, i('chor'), 'E4:16 F4:24 r:8');
    p.line(3, i('chor'), 'G4:16 A4:24 r:8');
    p.line(5, i('bass'), 'C2:16 F2:24 r:8');
    p.line(1, i('glocke'), 'r:16 F6:2 C6:2 A5:2 F5:2 C6:2 A5:2 F5:2 C5:2 F6:16');
  },
  true,
);

const BOSS_BESIEGT = stinger(
  'stinger_boss_besiegt',
  { de: 'Sieg', en: 'Victory' },
  100,
  ['horn', 'chor', 'pauke', 'glocke', 'bass'],
  40,
  (p, i) => {
    p.line(4, i('horn'), 'G4:2 C5:2 E5:2 G5:2 | C6:24 r:8');
    p.line(2, i('chor'), 'B4:8 C5:24 r:8');
    p.line(3, i('chor'), 'D5:8 E5:24 r:8');
    p.note(0, 0, n('G2'), i('pauke'), { vol: 48 });
    p.note(0, 8, n('C2'), i('pauke'), { vol: 62 });
    p.note(0, 12, n('C2'), i('pauke'), { vol: 40 });
    p.line(5, i('bass'), 'G2:8 C2:24 r:8');
    p.line(1, i('glocke'), 'r:8 C6:4 E6:4 G6:24');
  },
  true,
);

const STUFENAUFSTIEG = stinger(
  'stinger_stufenaufstieg',
  { de: 'Stufenaufstieg', en: 'Level Up' },
  120,
  ['glocke', 'harfe'],
  16,
  (p, i) => {
    ['C5', 'E5', 'G5', 'C6'].forEach((note, k) => p.note(0, k, n(note), i('harfe'), { vol: 36 }));
    p.note(4, 0, n('E5'), i('glocke'), { vol: 48 });
    p.note(1, 2, n('G5'), i('glocke'), { vol: 48 });
    p.note(2, 4, n('C6'), i('glocke'), { vol: 56 });
  },
  false,
);

const EREIGNIS = stinger(
  'stinger_ereignis',
  { de: 'Vorzeichen', en: 'Omen' },
  70,
  ['chor', 'horn', 'pauke', 'dunkel'],
  32,
  (p, i) => {
    p.line(2, i('chor'), 'D4:16 Eb4:12 r:4');
    p.line(3, i('chor'), 'F4:16 G4:12 r:4');
    p.line(4, i('horn'), 'D4:12 F4:4 Eb4:12 r:4');
    p.note(0, 0, n('D2'), i('pauke'), { vol: 54 });
    p.note(0, 16, n('Eb2'), i('pauke'), { vol: 54 });
    p.hits(5, i('dunkel'), n('D2'), 'x...x...x...x...', 0, 44);
    p.hits(5, i('dunkel'), n('Eb2'), 'x...x...x...-...', 16, 44);
  },
  true,
);

export const STINGER_PIECES: readonly MusicPieceInput[] = [ENTDECKUNG, LEUCHTFEUER, BOSS_BESIEGT, STUFENAUFSTIEG, EREIGNIS];

export const STINGERS: readonly StingerInput[] = [
  { id: 'entdeckung', stueck: ENTDECKUNG.id, duckDb: -8 },
  { id: 'leuchtfeuer', stueck: LEUCHTFEUER.id, duckDb: -14 },
  { id: 'boss_besiegt', stueck: BOSS_BESIEGT.id, duckDb: -14 },
  { id: 'stufenaufstieg', stueck: STUFENAUFSTIEG.id, duckDb: -6 },
  { id: 'ereignis', stueck: EREIGNIS.id, duckDb: -10 },
];
