/**
 * Natural wonder "Geysirfeld", Aschenschlund (M7-82; docs/SPIEL.md §18; slot variant `geysirfeld`): two geysers, each on its
 * apron of pale sinter crust (`sand`) in the dark ash – the great one in the north-west, a second in the south-east –, hot
 * sinter pools with their rings of ochre and orange, steaming fissures, sulphur crust and obsidian chips on the ash between
 * them, and an iron-bound chest at the second geyser's foot. The ash between the aprons keeps the pale sinter a landmark
 * instead of one bright square. Nothing guards it; the field itself is the wonder.
 */
import type { PlaceLayoutInput } from '../schema';

export const NATURWUNDER_ASCHENSCHLUND_01: PlaceLayoutInput = {
  id: 'naturwunder_aschenschlund_01',
  ortstyp: 'naturwunder',
  biom: 'aschenschlund',
  variante: 'geysirfeld',
  drehbar: false,
  legende: {
    a: { boden: 'asche' },
    s: { boden: 'sand' },
    G: { boden: 'sand', objekt: 'ort_geysir' },
    B: { boden: 'sand', objekt: 'ort_sinterbecken' },
    d: { boden: 'asche', objekt: 'ort_dampfspalt' },
    y: { boden: 'asche', objekt: 'deko_schwefelkruste' },
    o: { boden: 'asche', objekt: 'deko_obsidiansplitter' },
    C: { boden: 'sand', objekt: 'ort_truhe_2', marke: 'truhe', daten: '2' },
  },
  zeilen: [
    '...............',
    '......aaa......',
    '....aassaaa....',
    '...asssssaaa...',
    '..aassssssaya..',
    '..asssGsssaaa..',
    '.aadssssssBsa..',
    '.aaasssassssda.',
    '.aBssaaaaasssa.',
    '.assyaaosssssa.',
    '.aaasaassssssa.',
    '..ayaaassGssa..',
    '...aaadsssCa...',
    '....aaoaaaa....',
    '...............',
  ],
};
