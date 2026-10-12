/**
 * Hermit's hut (Nebelmoor; M7-08/M7-09, strand B): the Grünhain layout `eremitenhuette_gruenhain_01` on the biome's own ground, plants and Grünhain rocks left out – every biome the rule of this type allows has its layout (src/world/gen/locations.ts `LOCATION_RULES`, validator rule `orte`).
 * M7-96: Builder tablet 9 (`ort_erbauer_tafel`, mark `tafel` with data `tafel_09`) leans by the path below the cold fire pit,
 * where the hermit read it – E there reads the tablet (`tabletRead`), the post keeps his writing.
 */
import type { PlaceLayoutInput } from '../schema';

export const EREMITENHUETTE_NEBELMOOR_01: PlaceLayoutInput = {
  id: 'eremitenhuette_nebelmoor_01',
  ortstyp: 'eremitenhuette',
  biom: 'nebelmoor',
  drehbar: false,
  legende: {
    H: { boden: 'erde', objekt: 'ort_huette' },
    '#': { boden: 'erde' },
    e: { boden: 'erde' },
    F: { boden: 'erde', objekt: 'ort_feuerstelle' },
    N: { objekt: 'ort_notizpfahl', marke: 'tafel' },
    T: { objekt: 'ort_erbauer_tafel', marke: 'tafel', daten: 'tafel_09' },
    C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '1' },
  },
  zeilen: ['.........', '.........', '...##....', '...H#.C..', '...##....', '..eeeeN..', '..F.e....', '...Te....', '.........'],
};
