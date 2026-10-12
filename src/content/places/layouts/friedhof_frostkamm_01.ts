/**
 * Builder graveyard (Frostkamm; M7-08/M7-09, strand B): the Grünhain layout on the biome's own ground – the slots of this type lie mostly outside the Grünhain (src/world/gen/locations.ts `LOCATION_RULES`).
 * M7-96: Builder tablet 8 (`ort_erbauer_tafel`, mark `tafel` with data `tafel_08`) stands east of the paved way, opposite
 * the obelisk – E there reads the tablet (`tabletRead`), the obelisk keeps its inscription.
 */
import type { PlaceLayoutInput } from '../schema';

export const FRIEDHOF_FROSTKAMM_01: PlaceLayoutInput = {
  id: 'friedhof_frostkamm_01',
  ortstyp: 'friedhof',
  biom: 'frostkamm',
  drehbar: false,
  legende: {
    z: { objekt: 'ort_eisenzaun' },
    y: { objekt: 'ort_eisenzaun_senkrecht' },
    g: { objekt: 'ort_grabstein' },
    O: { boden: 'strasse', objekt: 'ort_obelisk', marke: 'tafel' },
    T: { objekt: 'ort_erbauer_tafel', marke: 'tafel', daten: 'tafel_08' },
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
    '.y.s.PPP.T.y.',
    '.yg.g.P.g.g..',
    '.yW..sP...Wy.',
    '...g..P......',
    '...zz.P.zz...',
    '.............',
  ],
};
