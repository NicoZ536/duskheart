/** Look-out tower (Frostkamm; M7-08/M7-09, strand B): the Grünhain layout on the biome's own ground – the slots of this type lie mostly outside the Grünhain (src/world/gen/locations.ts `LOCATION_RULES`). */
import type { PlaceLayoutInput } from '../schema';

export const AUSSICHTSTURM_FROSTKAMM_01: PlaceLayoutInput = {
  id: 'aussichtsturm_frostkamm_01',
  ortstyp: 'aussichtsturm',
  biom: 'frostkamm',
  drehbar: false,
  legende: {
    T: { boden: 'schnee', objekt: 'ort_aussichtsturm' },
    '#': { boden: 'schnee' },
    A: { boden: 'schnee', marke: 'aussicht' },
    e: { boden: 'schnee' },
    C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '1' },
    W: { marke: 'waechter' },
    r: { objekt: 'ort_geroell' },
  },
  zeilen: ['.......', '.W.##r.', '...T#..', '...A...', '.reeeC.', '...e...', '...e...'],
};
