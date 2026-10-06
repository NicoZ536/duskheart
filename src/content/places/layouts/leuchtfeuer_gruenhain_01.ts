/**
 * Beacon site, Grünhain (M7-08; docs/SPIEL.md §18): a round plaza of Builder paving with the cold beacon in its middle (mark
 * `leuchtfeuer`, the beacon itself belongs to strand F), six broken pillars around it, rubble and a worn path to the south.
 */
import type { PlaceLayoutInput } from '../schema';

export const LEUCHTFEUER_GRUENHAIN_01: PlaceLayoutInput = {
  id: 'leuchtfeuer_gruenhain_01',
  ortstyp: 'leuchtfeuer',
  biom: 'gruenhain',
  drehbar: true,
  legende: {
    P: { boden: 'strasse' },
    L: { boden: 'strasse', marke: 'leuchtfeuer' },
    S: { boden: 'strasse', objekt: 'ort_saeule' },
    r: { objekt: 'ort_geroell' },
    e: { boden: 'erde' },
  },
  zeilen: [
    '.............',
    '........r....',
    '...S.....S...',
    '....PPPeP....',
    '..rPPPPPPP.r.',
    '...ePPPPPe...',
    '.S.PPPLPPP.S.',
    '...PPPPPPP...',
    '.r.PPPPPPPr..',
    '....ePPPP....',
    '...S..e..S...',
    '.....re......',
    '......e......',
  ],
};
