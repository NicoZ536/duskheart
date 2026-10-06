/** Meteorite crater (Scherbenhain; M7-08/M7-09, strand B): the Grünhain layout `meteoritenkrater_gruenhain_01` on the biome's own ground, plants and Grünhain rocks left out – every biome the rule of this type allows has its layout (src/world/gen/locations.ts `LOCATION_RULES`, validator rule `orte`). */
import type { PlaceLayoutInput } from '../schema';

export const METEORITENKRATER_SCHERBENHAIN_01: PlaceLayoutInput = {
  id: 'meteoritenkrater_scherbenhain_01',
  ortstyp: 'meteoritenkrater',
  biom: 'scherbenhain',
  drehbar: false,
  legende: {
    a: { boden: 'asche' },
    e: { boden: 'erde' },
    M: { boden: 'asche', objekt: 'ort_meteorit' },
    '#': { boden: 'asche' },
    O: { boden: 'erde', objekt: 'erz_sternenerz', marke: 'erz' },
    F: { objekt: 'ort_geroell' },
    r: { boden: 'erde', objekt: 'ort_geroell' },
  },
  zeilen: [
    '.................',
    '.................',
    '......F..........',
    '.................',
    '......eeOee.F....',
    '...F.eeeeree.....',
    '....eOeaaaeee....',
    '....eeaM#aaOe....',
    '....era##aaee....',
    '....OeraaareeF...',
    '..F.eeeaaaeee....',
    '.....eOeeeOe.....',
    '....r.eeeeer.....',
    '.........F.......',
    '.................',
    '.................',
    '.................',
  ],
};
