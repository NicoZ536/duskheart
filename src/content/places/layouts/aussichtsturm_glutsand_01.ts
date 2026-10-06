/** Look-out tower (Glutsand; M7-08/M7-09, strand B): the Grünhain layout on the biome's own ground – the slots of this type lie mostly outside the Grünhain (src/world/gen/locations.ts `LOCATION_RULES`). */
import type { PlaceLayoutInput } from '../schema';

export const AUSSICHTSTURM_GLUTSAND_01: PlaceLayoutInput = {
  id: 'aussichtsturm_glutsand_01',
  ortstyp: 'aussichtsturm',
  biom: 'glutsand',
  drehbar: false,
  legende: {
    T: { boden: 'sand', objekt: 'ort_aussichtsturm' },
    '#': { boden: 'sand' },
    A: { boden: 'sand', marke: 'aussicht' },
    e: { boden: 'sand' },
    C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '1' },
    W: { marke: 'waechter' },
    r: { objekt: 'ort_geroell' },
  },
  zeilen: ['.......', '.W.##r.', '...T#..', '...A...', '.reeeC.', '...e...', '...e...'],
};
