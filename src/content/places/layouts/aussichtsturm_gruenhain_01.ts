/**
 * Look-out tower, Grünhain (M7-08; docs/SPIEL.md §18 "aussicht"): the tower (2 × 2) with its door to the south – the mark
 * `aussicht` in front of it (E climbs it, the map reveals 80 tiles) –, a worn path, rubble, a chest at its foot and the wasps'
 * nest above.
 */
import type { PlaceLayoutInput } from '../schema';

export const AUSSICHTSTURM_GRUENHAIN_01: PlaceLayoutInput = {
  id: 'aussichtsturm_gruenhain_01',
  ortstyp: 'aussichtsturm',
  biom: 'gruenhain',
  drehbar: false,
  legende: {
    T: { boden: 'erde', objekt: 'ort_aussichtsturm' },
    '#': { boden: 'erde' },
    A: { boden: 'erde', marke: 'aussicht' },
    e: { boden: 'erde' },
    C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '1' },
    W: { marke: 'waechter' },
    r: { objekt: 'ort_geroell' },
  },
  zeilen: ['.......', '.W.##r.', '...T#..', '...A...', '.reeeC.', '...e...', '...e...'],
};
