/**
 * Hermit's hut, Grünhain (M7-09; docs/SPIEL.md §18 "tafel"): the hut (2 × 2) of bark and clay, a trodden yard, the cold fire
 * pit, a post with the hermit's last writing (mark `tafel`), a chest behind the hut and the herbs he planted around it.
 */
import type { PlaceLayoutInput } from '../schema';

export const EREMITENHUETTE_GRUENHAIN_01: PlaceLayoutInput = {
  id: 'eremitenhuette_gruenhain_01',
  ortstyp: 'eremitenhuette',
  biom: 'gruenhain',
  drehbar: false,
  legende: {
    H: { boden: 'erde', objekt: 'ort_huette' },
    '#': { boden: 'erde' },
    e: { boden: 'erde' },
    F: { boden: 'erde', objekt: 'ort_feuerstelle' },
    N: { objekt: 'ort_notizpfahl', marke: 'tafel' },
    C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '1' },
    k: { objekt: 'pflanze_kraeuter' },
  },
  zeilen: ['.........', '.........', '..k##.k..', '.k.H#.C..', '.k.##..k.', '..eeeeN..', '..F.e....', '....e....', '.........'],
};
