/** Look-out tower, Grünhain, small (M7-08): the tower with its door, a chest and the wasps – for slots on a narrow summit. */
import type { PlaceLayoutInput } from '../schema';

export const AUSSICHTSTURM_GRUENHAIN_02: PlaceLayoutInput = {
  id: 'aussichtsturm_gruenhain_02',
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
  },
  zeilen: ['..##.', '.WT#.', '..AC.', '..e..', '..e..'],
};
