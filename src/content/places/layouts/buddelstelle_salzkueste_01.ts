/** Dig site, Salzküste (M7-09): the cross of stones on the beach sand, the cache beneath it (mark `buddel`). */
import type { PlaceLayoutInput } from '../schema';

export const BUDDELSTELLE_SALZKUESTE_01: PlaceLayoutInput = {
  id: 'buddelstelle_salzkueste_01',
  ortstyp: 'buddelstelle',
  biom: 'salzkueste',
  drehbar: true,
  legende: {
    B: { boden: 'sand', objekt: 'ort_buddelmarke', marke: 'buddel', daten: '1' },
    s: { boden: 'sand' },
  },
  zeilen: ['.s.', 'sBs', '.s.'],
};
