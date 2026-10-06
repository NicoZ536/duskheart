/** Shrine, Salzküste, small (M7-08): the shrine alone with its altar mark. */
import type { PlaceLayoutInput } from '../schema';

export const SCHREIN_SALZKUESTE_02: PlaceLayoutInput = {
  id: 'schrein_salzkueste_02',
  ortstyp: 'schrein',
  biom: 'salzkueste',
  drehbar: false,
  legende: {
    X: { boden: 'strasse', objekt: 'ort_schrein', marke: 'altar' },
    '#': { boden: 'strasse' },
  },
  zeilen: ['.X#', '.##', '...'],
};
