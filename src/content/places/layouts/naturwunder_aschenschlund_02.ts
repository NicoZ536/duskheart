/**
 * Natural wonder "Geysirfeld", Aschenschlund, small (M7-82; slot variant `geysirfeld`): for a slot that got the fallback radius
 * of a crowded region (3 tiles) – one geyser on its apron of sinter crust in the ash, a hot pool beside it, a steaming fissure and the chest.
 */
import type { PlaceLayoutInput } from '../schema';

export const NATURWUNDER_ASCHENSCHLUND_02: PlaceLayoutInput = {
  id: 'naturwunder_aschenschlund_02',
  ortstyp: 'naturwunder',
  biom: 'aschenschlund',
  variante: 'geysirfeld',
  drehbar: false,
  legende: {
    a: { boden: 'asche' },
    s: { boden: 'sand' },
    G: { boden: 'sand', objekt: 'ort_geysir' },
    B: { boden: 'sand', objekt: 'ort_sinterbecken' },
    d: { boden: 'sand', objekt: 'ort_dampfspalt' },
    C: { boden: 'sand', objekt: 'ort_truhe_2', marke: 'truhe', daten: '2' },
  },
  zeilen: ['.......', '..asd..', '.aGssa.', '.assaBs', '.dsaas.', '..aCa..', '...a...'],
};
