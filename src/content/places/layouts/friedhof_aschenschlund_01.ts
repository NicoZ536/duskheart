/**
 * Builder graveyard (Aschenschlund; M7-08/M7-09, strand B): the Grünhain layout `friedhof_gruenhain_01` on the biome's own ground, plants and Grünhain rocks left out – every biome the rule of this type allows has its layout (src/world/gen/locations.ts `LOCATION_RULES`, validator rule `orte`).
 * M7-96: Builder tablet 8 (`ort_erbauer_tafel`, mark `tafel` with data `tafel_08`) stands east of the paved way, opposite
 * the obelisk – E there reads the tablet (`tabletRead`), the obelisk keeps its inscription.
 */
import type { PlaceLayoutInput } from '../schema';

export const FRIEDHOF_ASCHENSCHLUND_01: PlaceLayoutInput = {
  id: 'friedhof_aschenschlund_01',
  ortstyp: 'friedhof',
  biom: 'aschenschlund',
  drehbar: false,
  legende: {
    z: { objekt: 'ort_eisenzaun' },
    y: { objekt: 'ort_eisenzaun_senkrecht' },
    g: { objekt: 'ort_grabstein' },
    O: { boden: 'strasse', objekt: 'ort_obelisk', marke: 'tafel' },
    T: { objekt: 'ort_erbauer_tafel', marke: 'tafel', daten: 'tafel_08' },
    C: { boden: 'strasse', objekt: 'ort_truhe_3', marke: 'truhe', daten: '3' },
    P: { boden: 'strasse' },
    W: { marke: 'waechter' },
  },
  zeilen: [
    '.............',
    '...zzzzzz....',
    '......W......',
    '.yg.g...g.gy.',
    '......C....y.',
    '.yg.g.O.g.gy.',
    '.y...PPP...y.',
    '.y...PPP.T.y.',
    '.yg.g.P.g.g..',
    '.yW...P...Wy.',
    '...g..P......',
    '...zz.P.zz...',
    '.............',
  ],
};
