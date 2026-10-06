/**
 * Shrine, Grünhain (M7-08; docs/SPIEL.md §18 "segen"): the Builder shrine (2 × 1, the mark `altar` on it: E prays) on a small
 * paved platform, wild flowers at its corners and a footpath to the south.
 */
import type { PlaceLayoutInput } from '../schema';

export const SCHREIN_GRUENHAIN_01: PlaceLayoutInput = {
  id: 'schrein_gruenhain_01',
  ortstyp: 'schrein',
  biom: 'gruenhain',
  drehbar: false,
  legende: {
    P: { boden: 'strasse' },
    X: { boden: 'strasse', objekt: 'ort_schrein', marke: 'altar' },
    '#': { boden: 'strasse' },
    e: { boden: 'erde' },
    b: { objekt: 'deko_blumen' },
  },
  zeilen: ['.......', '.PPPP..', '.PX#P..', 'bPPPPb.', '.bPPb..', '..ee...', '...e...'],
};
