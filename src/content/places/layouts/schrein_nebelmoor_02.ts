/** Builder shrine (Nebelmoor; M7-08/M7-09, strand B): the Grünhain layout `schrein_gruenhain_02` on the biome's own ground, plants and Grünhain rocks left out – every biome the rule of this type allows has its layout (src/world/gen/locations.ts `LOCATION_RULES`, validator rule `orte`). */
import type { PlaceLayoutInput } from '../schema';

export const SCHREIN_NEBELMOOR_02: PlaceLayoutInput = {
  id: 'schrein_nebelmoor_02',
  ortstyp: 'schrein',
  biom: 'nebelmoor',
  drehbar: false,
  legende: {
    X: { boden: 'strasse', objekt: 'ort_schrein', marke: 'altar' },
    '#': { boden: 'strasse' },
  },
  zeilen: ['.X#', '.##', '...'],
};
