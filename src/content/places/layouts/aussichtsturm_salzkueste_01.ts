/** Look-out tower (Salzküste; M7-08/M7-09, strand B): the Grünhain layout `aussichtsturm_gruenhain_01` on the biome's own ground, plants and Grünhain rocks left out – every biome the rule of this type allows has its layout (src/world/gen/locations.ts `LOCATION_RULES`, validator rule `orte`). */
import type { PlaceLayoutInput } from '../schema';

export const AUSSICHTSTURM_SALZKUESTE_01: PlaceLayoutInput = {
  id: 'aussichtsturm_salzkueste_01',
  ortstyp: 'aussichtsturm',
  biom: 'salzkueste',
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
