/** Bridge ruin (Nebelmoor; M7-08/M7-09, strand B): the Grünhain layout on the biome's own ground – the slots of this type lie mostly outside the Grünhain (src/world/gen/locations.ts `LOCATION_RULES`). */
import type { PlaceLayoutInput } from '../schema';

export const BRUECKENRUINE_NEBELMOOR_01: PlaceLayoutInput = {
  id: 'brueckenruine_nebelmoor_01',
  ortstyp: 'brueckenruine',
  biom: 'nebelmoor',
  drehbar: true,
  legende: {
    p: { boden: 'strasse', objekt: 'ort_brueckenpfeiler' },
    P: { boden: 'strasse' },
    r: { objekt: 'ort_geroell' },
    q: { objekt: 'ort_geroell' },
    C: { objekt: 'ort_truhe_2', marke: 'truhe', daten: '2' },
    W: { marke: 'waechter' },
  },
  zeilen: ['.p.P.p.', 'r.PPP.r', '..PPP.q', 'qC.P.W.', '...P.r.'],
};
