/**
 * Natural wonder "Kristallbogen", Scherbenhain, small (M7-82; slot variant `kristallbogen`): for a slot that got the fallback
 * radius of a crowded region (3 tiles) – the arch over the slot centre, a crystal spire behind it and the chest before it.
 */
import type { PlaceLayoutInput } from '../schema';

export const NATURWUNDER_SCHERBENHAIN_02: PlaceLayoutInput = {
  id: 'naturwunder_scherbenhain_02',
  ortstyp: 'naturwunder',
  biom: 'scherbenhain',
  variante: 'kristallbogen',
  drehbar: false,
  legende: {
    k: { boden: 'kristallboden' },
    W: { boden: 'kristallboden', objekt: 'ort_kristallbogen_west' },
    O: { boden: 'kristallboden', objekt: 'ort_kristallbogen_ost' },
    n: { boden: 'kristallboden', objekt: 'ort_kristallnadel' },
    C: { boden: 'kristallboden', objekt: 'ort_truhe_2', marke: 'truhe', daten: '2' },
  },
  zeilen: ['.......', '..kkn..', '.kkkkk.', '.WkkkO.', '.kkkkk.', '..kCk..', '...k...'],
};
