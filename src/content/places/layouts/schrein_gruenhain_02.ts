/** Shrine, Grünhain, small (M7-08): the shrine alone with its altar mark – for slots where little flat land is left. */
import type { PlaceLayoutInput } from '../schema';

export const SCHREIN_GRUENHAIN_02: PlaceLayoutInput = {
  id: 'schrein_gruenhain_02',
  ortstyp: 'schrein',
  biom: 'gruenhain',
  drehbar: false,
  legende: {
    X: { boden: 'strasse', objekt: 'ort_schrein', marke: 'altar' },
    '#': { boden: 'strasse' },
  },
  zeilen: ['.X#', '.##', '...'],
};
