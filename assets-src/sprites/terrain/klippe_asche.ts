/**
 * Tileset Klippe Asche (M2-18, MASTERPROMPT §4.4, docs/ART.md §5, docs/WORLD.md §7): Basaltwände von
 * Aschenschlund, Nachtherz und Glutadern in `nacht` (ungetönt), eine Stufe dunkler als die Ascheebene
 * `nacht.3`, damit die Wand sich abhebt. Front: schmale Basaltsäulen – Mitte `nacht.2`, Rand `nacht.1`,
 * Fugen und Brüche `nacht.0` mit hellen, aschebedeckten Säulenköpfen `nacht.4` in versetzter Höhe. Oben
 * liegt Asche `nacht.4` über dem Rand. Rampe: Aschehang; Treppe:
 * Basaltstufen.
 */
import { GEOMETRIE_KLIPPE, klippenTileset } from './_klippe';

export default klippenTileset({
  gruppe: 'asche',
  legende: { '0': 'nacht.0', '1': 'nacht.0', '2': 'nacht.1', '3': 'nacht.2', '4': 'nacht.4', G: 'nacht.4', E: 'nacht.3', e: 'nacht.2', f: 'nacht.4' },
  front: [
    `3321323123313321
     3321323123313321
     3321323100013321
     3321323144413321
     3320323033203320
     0000323033203320
     4440323033203320
     3320323033203320
     3320323033203320
     3320323033203320
     3321000133213321
     3321444133213321
     3321323133210001
     3321323133214441
     3321323133213321
     3321323133213321`,
    `3313213321323133
     3313213321000133
     3313213321444133
     3303203320323033
     0003203320323000
     4403203320323044
     3303203320323033
     3303200000323033
     3303204440323033
     3303203320323033
     3303203320323033
     3313213321323133
     3310013321323133
     3314413321323133
     3313213321323133
     3313213321323133`,
  ],
  seite: `023324
          023324
          023334
          022324
          023324
          023344
          023324
          022324
          023324
          023334
          023324
          022324
          023324
          023344
          023324
          022324`,
  randNord: `3443443344434434
             2332332233323323
             1_0110_1101_1011`,
  saum: 'nacht.2',
  fuss: `................
         ................
         1......1111....1
         11...0344430.341
         01.103333333G033
         _G_1222222221_22`,
  kontur: 'nacht.0',
  oberkante: 'nacht.4',
  lippe: { kante: 'nacht.4', ueberhang: 'nacht.3', schatten: 'nacht.0' },
  rampe: `EEEEEfffffEEEEEE
          EEEEffffffEEEEEE
          EEEEfffeffEEEEEE
          EEEEEffffffEEeEE
          EEeEEfffffEEEeEE
          EEeEEEfffffEEEEE
          EEEEEEffeffEEEEE
          EEEEEEfffffEEEEE
          EEEEEfffffEEEEEE
          EEEEffffffEEEeEE
          EEEEfffeffEEEeEE
          EEeEffffffEEEEEE
          EEeEEfffffEEEEEE
          EEEEEEffffEEEEEE
          EEEEEfffffEEEEEE
          EEEEEfffffEEEEEE`,
  treppe: `4444434444444444
           3333323333332333
           2222212222221222
           1111111111111111
           4444444443444444
           3333333332333333
           2212222221222222
           1111111111111111
           4434444444444434
           3323333333333323
           2212222222222212
           1111111111111111
           4444444344444444
           333G333233333333
           22GG222122222222
           1111111111111111`,
  geometrie: GEOMETRIE_KLIPPE,
  buesche: [0,  0,  1,  1,  0,  0,  0,  1,  2,  1,  0,  0,  0,  1,  0,  0],
});
