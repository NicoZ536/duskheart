/**
 * Builder graveyard, Grünhain (M7-09; docs/SPIEL.md §18 "tafel"): a rusted iron fence with gaps, rows of gravestones, the
 * obelisk in the middle with its inscription (mark `tafel`), a Builder casket behind it, a paved way from the gate in the south
 * and three thornlings among the graves (marks `waechter`).
 */
import type { PlaceLayoutInput } from '../schema';

export const FRIEDHOF_GRUENHAIN_01: PlaceLayoutInput = {
  id: 'friedhof_gruenhain_01',
  ortstyp: 'friedhof',
  biom: 'gruenhain',
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
