/** Builder graveyard, Salzküste (M7-09): the same fenced rows of graves around the inscribed obelisk, in the dune grass. */
import type { PlaceLayoutInput } from '../schema';

export const FRIEDHOF_SALZKUESTE_01: PlaceLayoutInput = {
  id: 'friedhof_salzkueste_01',
  ortstyp: 'friedhof',
  biom: 'salzkueste',
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
