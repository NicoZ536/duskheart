/** Bridge ruin, Salzküste (M7-09): the bridge head on the sandy bank – cracked pillars, rubble, a chest, the boar. */
import type { PlaceLayoutInput } from '../schema';

export const BRUECKENRUINE_SALZKUESTE_01: PlaceLayoutInput = {
  id: 'brueckenruine_salzkueste_01',
  ortstyp: 'brueckenruine',
  biom: 'salzkueste',
  drehbar: true,
  legende: {
    p: { boden: 'strasse', objekt: 'ort_brueckenpfeiler' },
    P: { boden: 'strasse' },
    r: { objekt: 'ort_geroell' },
    q: { objekt: 'fels_klein_salzkueste' },
    C: { objekt: 'ort_truhe_2', marke: 'truhe', daten: '2' },
    W: { marke: 'waechter' },
  },
  zeilen: ['.p.P.p.', 'r.PPP.r', '..PPP.q', 'qC.P.W.', '...P.r.'],
};
