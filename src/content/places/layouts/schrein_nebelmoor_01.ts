/** Builder shrine (Nebelmoor; M7-08/M7-09, strand B): the Grünhain layout `schrein_gruenhain_01` on the biome's own ground, plants and Grünhain rocks left out – every biome the rule of this type allows has its layout (src/world/gen/locations.ts `LOCATION_RULES`, validator rule `orte`). */
import type { PlaceLayoutInput } from '../schema';

export const SCHREIN_NEBELMOOR_01: PlaceLayoutInput = {
  id: 'schrein_nebelmoor_01',
  ortstyp: 'schrein',
  biom: 'nebelmoor',
  drehbar: false,
  legende: {
    P: { boden: 'strasse' },
    X: { boden: 'strasse', objekt: 'ort_schrein', marke: 'altar' },
    '#': { boden: 'strasse' },
    e: { boden: 'erde' },
  },
  zeilen: ['.......', '.PPPP..', '.PX#P..', '.PPPP..', '..PP...', '..ee...', '...e...'],
};
