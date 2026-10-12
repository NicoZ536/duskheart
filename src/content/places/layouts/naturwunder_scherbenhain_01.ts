/**
 * Natural wonder "Kristallbogen", Scherbenhain (M7-82; docs/SPIEL.md §18; slot variant `kristallbogen`): two great crystal
 * shards lean against each other over the middle of the place – the arch (`ort_kristallbogen_west` and `_ost`, four tiles
 * from foot to foot, the slot centre beneath it: one walks through) –, crystal spires grow around it, a lumen crystal glows
 * at its edge, crystal splinters and crystal grass lie on the crystal ground, and an iron-bound chest waits south-east of it.
 */
import type { PlaceLayoutInput } from '../schema';

export const NATURWUNDER_SCHERBENHAIN_01: PlaceLayoutInput = {
  id: 'naturwunder_scherbenhain_01',
  ortstyp: 'naturwunder',
  biom: 'scherbenhain',
  variante: 'kristallbogen',
  drehbar: false,
  legende: {
    k: { boden: 'kristallboden' },
    W: { boden: 'kristallboden', objekt: 'ort_kristallbogen_west' },
    O: { boden: 'kristallboden', objekt: 'ort_kristallbogen_ost' },
    n: { boden: 'kristallboden', objekt: 'ort_kristallnadel' },
    l: { boden: 'kristallboden', objekt: 'kristall_lumen' },
    s: { boden: 'kristallboden', objekt: 'deko_kristallsplitter' },
    g: { boden: 'kristallboden', objekt: 'deko_kristallgras' },
    C: { boden: 'kristallboden', objekt: 'ort_truhe_2', marke: 'truhe', daten: '2' },
  },
  zeilen: [
    '...............',
    '......k........',
    '....kkkkk......',
    '...kknkkkkk....',
    '..kkkkkkkknk...',
    '..kskkkkkkkkk..',
    '.kkkkkkkkkkkk..',
    '.knkkWkkkOkkkk.',
    '.kkkkkkkkkkkgk.',
    '.kkgkkkkkkkkkk.',
    '..kkkkkkkskkk..',
    '..klkkkkkkkCk..',
    '...kkknkkkkk...',
    '.....kkkk......',
    '...............',
  ],
};
