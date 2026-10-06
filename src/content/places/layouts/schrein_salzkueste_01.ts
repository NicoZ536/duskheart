/** Shrine, Salzküste (M7-08): the Builder shrine on its paved platform between dune grass and sand, its altar mark on it. */
import type { PlaceLayoutInput } from '../schema';

export const SCHREIN_SALZKUESTE_01: PlaceLayoutInput = {
  id: 'schrein_salzkueste_01',
  ortstyp: 'schrein',
  biom: 'salzkueste',
  drehbar: false,
  legende: {
    P: { boden: 'strasse' },
    X: { boden: 'strasse', objekt: 'ort_schrein', marke: 'altar' },
    '#': { boden: 'strasse' },
    s: { boden: 'sand' },
    m: { objekt: 'deko_muscheln' },
  },
  zeilen: ['.......', '.PPPP..', '.PX#P..', 'mPPPPm.', '.sPPs..', '..ss...', '...s...'],
};
