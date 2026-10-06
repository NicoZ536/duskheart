/**
 * Natural wonder "Uraltbaum", Grünhain (M7-08; docs/SPIEL.md §18; slot variant `uraltbaum`): the ancient tree (2 × 2) on bare
 * earth, its roots reaching out across the clearing, moss, mushrooms and flowers in its shade, and a hollow in the roots that
 * holds an old chest.
 */
import type { PlaceLayoutInput } from '../schema';

export const NATURWUNDER_GRUENHAIN_01: PlaceLayoutInput = {
  id: 'naturwunder_gruenhain_01',
  ortstyp: 'naturwunder',
  biom: 'gruenhain',
  variante: 'uraltbaum',
  drehbar: false,
  legende: {
    U: { boden: 'erde', objekt: 'ort_uraltbaum' },
    '#': { boden: 'erde' },
    e: { boden: 'erde' },
    w: { objekt: 'ort_wurzel' },
    o: { objekt: 'deko_moos' },
    p: { objekt: 'deko_pilze' },
    b: { objekt: 'deko_blumen' },
    C: { boden: 'erde', objekt: 'ort_truhe_2', marke: 'truhe', daten: '2' },
  },
  zeilen: [
    '...............',
    '...............',
    '...............',
    '.........b.....',
    '....p.....o....',
    '..o..weeew.....',
    '...w.eU#ee.w...',
    '..b.we##ew..p..',
    '...o.weewC.....',
    '....w.eee.w.b..',
    '...p..o....o...',
    '.......p.......',
    '.....b.........',
    '...............',
    '...............',
  ],
};
