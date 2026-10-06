/** Look-out tower (Scherbenhain; M7-08/M7-09, strand B): the Grünhain layout on the biome's own ground – the slots of this type lie mostly outside the Grünhain (src/world/gen/locations.ts `LOCATION_RULES`). */
import type { PlaceLayoutInput } from '../schema';

export const AUSSICHTSTURM_SCHERBENHAIN_01: PlaceLayoutInput = {
  id: 'aussichtsturm_scherbenhain_01',
  ortstyp: 'aussichtsturm',
  biom: 'scherbenhain',
  drehbar: false,
  legende: {
    T: { boden: 'kristallboden', objekt: 'ort_aussichtsturm' },
    '#': { boden: 'kristallboden' },
    A: { boden: 'kristallboden', marke: 'aussicht' },
    e: { boden: 'kristallboden' },
    C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '1' },
    W: { marke: 'waechter' },
    r: { objekt: 'ort_geroell' },
  },
  zeilen: ['.......', '.W.##r.', '...T#..', '...A...', '.reeeC.', '...e...', '...e...'],
};
