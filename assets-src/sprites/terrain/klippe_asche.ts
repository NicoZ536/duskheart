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
    `2332232344322222
     2332232233200022
     2332222233234322
     2332000233223222
     2332343233223222
     2222232233223200
     0000232233223233
     3443232222223222
     2332232000023222
     2332222344323222
     2332000233222222
     2332343233200022
     2222232233234322
     0000232233223222
     3443232222223222
     2332232000023222`,
    `2332232344322222
     2332232233200022
     2332222233234322
     2332000233223222
     2332343200223222
     2222232244223200
     0000232233223233
     3443232222223222
     2332232000023222
     2332222344323222
     2332000233222222
     2332343233200022
     2222232233234322
     0000202233223222
     3443232222223222
     2332232000023222`,
  ],
  seite: `022334
          022234
          011124
          023334
          022333
          022234
          022224
          011224
          022114
          022334
          022233
          012224
          011124
          023334
          022334
          022234`,
  randNord: `3443344433444334
             2332233322333223
             1101_1011_101101`,
  saum: 'nacht.2',
  fuss: `................
         ................
         1......1111....1
         11...0344430.341
         01.103333333G033
         _G_1222222221_22`,
  kontur: 'nacht.0',
  oberkante: 'nacht.4',
  lippe: { ueberhang: 'nacht.4', schatten: 'nacht.0' },
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
