/**
 * Meteorite crater, Grünhain (M7-09; docs/SPIEL.md §18 "krater"): a scorched hollow – ash around the fallen star (2 × 2), bare
 * earth in the ring of its blast –, star ore nodes `erz_sternenerz` in the broken ground, rubble, and boulders thrown onto the
 * rim. Meadow in a disc around it (`g`): the round crater stands out against the grass instead of the slot's bare clearing.
 */
import type { PlaceLayoutInput } from '../schema';

export const METEORITENKRATER_GRUENHAIN_01: PlaceLayoutInput = {
  id: 'meteoritenkrater_gruenhain_01',
  ortstyp: 'meteoritenkrater',
  biom: 'gruenhain',
  drehbar: false,
  legende: {
    a: { boden: 'asche' },
    e: { boden: 'erde' },
    M: { boden: 'asche', objekt: 'ort_meteorit' },
    '#': { boden: 'asche' },
    O: { boden: 'erde', objekt: 'erz_sternenerz', marke: 'erz' },
    F: { objekt: 'fels_klein_gruenhain' },
    r: { boden: 'erde', objekt: 'ort_geroell' },
    g: { boden: 'gras' },
  },
  zeilen: [
    '.................',
    '.................',
    '......Fgggg......',
    '....ggggggggg....',
    '...gggeeOeegFg...',
    '...Fgeeeereegg...',
    '..ggeOeaaaeeegg..',
    '..ggeeaM#aaOegg..',
    '..ggera##aaeegg..',
    '..ggOeraaareeFg..',
    '..Fgeeeaaaeeegg..',
    '...ggeOeeeOegg...',
    '...grgeeeeergg...',
    '....gggggFggg....',
    '......ggggg......',
    '.................',
    '.................',
  ],
};
