/** Hermit's hut (Scherbenhain; M7-08/M7-09, strand B): the Grünhain layout `eremitenhuette_gruenhain_01` on the biome's own ground, plants and Grünhain rocks left out – every biome the rule of this type allows has its layout (src/world/gen/locations.ts `LOCATION_RULES`, validator rule `orte`). */
import type { PlaceLayoutInput } from '../schema';

export const EREMITENHUETTE_SCHERBENHAIN_01: PlaceLayoutInput = {
  id: 'eremitenhuette_scherbenhain_01',
  ortstyp: 'eremitenhuette',
  biom: 'scherbenhain',
  drehbar: false,
  legende: {
    H: { boden: 'erde', objekt: 'ort_huette' },
    '#': { boden: 'erde' },
    e: { boden: 'erde' },
    F: { boden: 'erde', objekt: 'ort_feuerstelle' },
    N: { objekt: 'ort_notizpfahl', marke: 'tafel' },
    C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '1' },
  },
  zeilen: ['.........', '.........', '...##....', '...H#.C..', '...##....', '..eeeeN..', '..F.e....', '....e....', '.........'],
};
