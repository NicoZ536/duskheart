/** Dig site, Grünhain (M7-09; docs/SPIEL.md §18 "buddeln"): loose earth with a cross of stones over the cache (mark `buddel`). */
import type { PlaceLayoutInput } from '../schema';

export const BUDDELSTELLE_GRUENHAIN_01: PlaceLayoutInput = {
  id: 'buddelstelle_gruenhain_01',
  ortstyp: 'buddelstelle',
  biom: 'gruenhain',
  drehbar: true,
  legende: {
    B: { boden: 'erde', objekt: 'ort_buddelmarke', marke: 'buddel', daten: '1' },
    e: { boden: 'erde' },
  },
  zeilen: ['.e.', 'eBe', '.e.'],
};
