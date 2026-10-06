/**
 * Bridge ruin, Grünhain (M7-09; docs/SPIEL.md §18): the head of a Builder bridge – the generator stands it on the bank at one
 * end of the ruined span with its north row towards the river (src/world/gen/places/select.ts). Two cracked pillars flank the
 * old paving, rubble and rocks lie around, an iron-bound chest waits beside the road, a boar keeps the place.
 */
import type { PlaceLayoutInput } from '../schema';

export const BRUECKENRUINE_GRUENHAIN_01: PlaceLayoutInput = {
  id: 'brueckenruine_gruenhain_01',
  ortstyp: 'brueckenruine',
  biom: 'gruenhain',
  drehbar: true,
  legende: {
    p: { boden: 'strasse', objekt: 'ort_brueckenpfeiler' },
    P: { boden: 'strasse' },
    r: { objekt: 'ort_geroell' },
    q: { objekt: 'fels_klein_gruenhain' },
    C: { objekt: 'ort_truhe_2', marke: 'truhe', daten: '2' },
    W: { marke: 'waechter' },
  },
  zeilen: ['.p.P.p.', 'r.PPP.r', '..PPP.q', 'qC.P.W.', '...P.r.'],
};
