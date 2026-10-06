/** Builder graveyard (Scherbenhain; M7-08/M7-09, strand B): the Grünhain layout on the biome's own ground – the slots of this type lie mostly outside the Grünhain (src/world/gen/locations.ts `LOCATION_RULES`). */
import type { PlaceLayoutInput } from '../schema';

export const FRIEDHOF_SCHERBENHAIN_01: PlaceLayoutInput = {
  id: 'friedhof_scherbenhain_01',
  ortstyp: 'friedhof',
  biom: 'scherbenhain',
  drehbar: false,
  legende: {
    z: { objekt: 'ort_eisenzaun' },
    y: { objekt: 'ort_eisenzaun_senkrecht' },
    g: { objekt: 'ort_grabstein' },
    O: { boden: 'strasse', objekt: 'ort_obelisk', marke: 'tafel' },
    C: { boden: 'strasse', objekt: 'ort_truhe_3', marke: 'truhe', daten: '3' },
    P: { boden: 'strasse' },
    s: { objekt: 'deko_steinchen' },
    W: { marke: 'waechter' },
  },
  zeilen: [
    '.............',
    '...zzzzzz....',
    '......W......',
    '.yg.g...g.gy.',
    '......C....y.',
    '.yg.g.O.g.gy.',
    '.y...PPP.s.y.',
    '.y.s.PPP...y.',
    '.yg.g.P.g.g..',
    '.yW..sP...Wy.',
    '...g..P......',
    '...zz.P.zz...',
    '.............',
  ],
};
