/** Dig site (Nebelmoor; M7-08/M7-09, strand B): the Grünhain layout `buddelstelle_gruenhain_01` on the biome's own ground, plants and Grünhain rocks left out – every biome the rule of this type allows has its layout (src/world/gen/locations.ts `LOCATION_RULES`, validator rule `orte`). */
import type { PlaceLayoutInput } from '../schema';

export const BUDDELSTELLE_NEBELMOOR_01: PlaceLayoutInput = {
  id: 'buddelstelle_nebelmoor_01',
  ortstyp: 'buddelstelle',
  biom: 'nebelmoor',
  drehbar: true,
  legende: {
    B: { boden: 'erde', objekt: 'ort_buddelmarke', marke: 'buddel', daten: '1' },
    e: { boden: 'erde' },
  },
  zeilen: ['.e.', 'eBe', '.e.'],
};
