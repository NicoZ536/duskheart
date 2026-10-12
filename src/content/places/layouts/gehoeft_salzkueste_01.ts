/**
 * Abandoned farmstead (Salzküste; M7-08/M7-09, strand B): the Grünhain layout `gehoeft_gruenhain_01` on the biome's own ground, plants and Grünhain rocks left out – every biome the rule of this type allows has its layout (src/world/gen/locations.ts `LOCATION_RULES`, validator rule `orte`).
 * M7-96: Builder tablet 10 (`ort_erbauer_tafel`, mark `tafel` with data `tafel_10`) stands in the yard by the east fence –
 * E there reads the tablet (`tabletRead`), the post keeps the farmer's note.
 */
import type { PlaceLayoutInput } from '../schema';

export const GEHOEFT_SALZKUESTE_01: PlaceLayoutInput = {
  id: 'gehoeft_salzkueste_01',
  ortstyp: 'gehoeft',
  biom: 'salzkueste',
  drehbar: false,
  legende: {
    f: { boden: 'erde' },
    k: { boden: 'erde', objekt: 'ort_mauer_kurz' },
    M: { boden: 'erde', objekt: 'ort_mauer' },
    m: { boden: 'erde' },
    D: { boden: 'erde', objekt: 'ort_truhe_2', marke: 'truhe', daten: '2' },
    h: { objekt: 'ort_heuballen' },
    r: { objekt: 'ort_geroell' },
    e: { boden: 'erde' },
    B: { objekt: 'ort_brunnen' },
    K: { objekt: 'ort_karren' },
    '#': { boden: 'sand' },
    N: { objekt: 'ort_notizpfahl', marke: 'tafel' },
    T: { objekt: 'ort_erbauer_tafel', marke: 'tafel', daten: 'tafel_10' },
    C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '1' },
    z: { objekt: 'ort_zaun' },
    W: { marke: 'waechter' },
  },
  zeilen: [
    '...............',
    '...............',
    '..........hh...',
    '...kMmMmfkk....',
    '...kDfffhfk....',
    '...kfffrfff....',
    '...kfrffffk....',
    '...kMmffkfk....',
    '......ee.......',
    '..W....e..K#...',
    '....B..eN...T..',
    '..zzz..e..zzz..',
    '...z.C.e.W.....',
    '....r..e.......',
    '...............',
  ],
};
