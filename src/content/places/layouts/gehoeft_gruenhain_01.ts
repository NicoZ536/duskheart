/**
 * Abandoned farmstead, Grünhain (M7-08; docs/SPIEL.md §18 "tafel"): the walls of a farmhouse with a broken south side and its
 * earthen floor, an iron-bound chest inside, a rotting hay bale and fallen rubble; in the yard a well, a broken cart, the post
 * with the farmer's note (mark `tafel`), a wooden chest, a rotten fence and the den of a wolf pair (marks `waechter`).
 */
import type { PlaceLayoutInput } from '../schema';

export const GEHOEFT_GRUENHAIN_01: PlaceLayoutInput = {
  id: 'gehoeft_gruenhain_01',
  ortstyp: 'gehoeft',
  biom: 'gruenhain',
  drehbar: false,
  legende: {
    f: { boden: 'erde' },
    k: { boden: 'erde', objekt: 'ort_mauer_kurz' },
    M: { boden: 'erde', objekt: 'ort_mauer' },
    m: { boden: 'erde' },
    D: { boden: 'erde', objekt: 'ort_truhe_2', marke: 'truhe', daten: '2' },
    h: { objekt: 'ort_heuballen' },
    r: { objekt: 'ort_geroell' },
    e: { boden: 'erde' },
    B: { objekt: 'ort_brunnen' },
    K: { objekt: 'ort_karren' },
    '#': { boden: 'gras' },
    N: { objekt: 'ort_notizpfahl', marke: 'tafel' },
    C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '1' },
    z: { objekt: 'ort_zaun' },
    W: { marke: 'waechter' },
  },
  zeilen: [
    '...............',
    '...............',
    '..........hh...',
    '...kMmMmfkk....',
    '...kDfffhfk....',
    '...kfffrfff....',
    '...kfrffffk....',
    '...kMmffkfk....',
    '......ee.......',
    '..W....e..K#...',
    '....B..eN......',
    '..zzz..e..zzz..',
    '...z.C.e.W.....',
    '....r..e.......',
    '...............',
  ],
};
