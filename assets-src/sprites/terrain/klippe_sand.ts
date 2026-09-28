/**
 * Tileset Klippe Sand (M2-18, MASTERPROMPT §4.4, docs/ART.md §3/§5, docs/WORLD.md §7): Sandsteinwände von
 * Glutsand und Salzküste in `laub` (ungetönt: rotbraune Canyonschichten, die sich vom hellen Sand abheben).
 * Front: gewellte Schichten verschiedener Dicke – Schichtkante `sand.3` (sieht den Himmel), Körper
 * `laub.3`/`laub.2`, Unterseite `laub.1`, Auswaschungen `laub.0`; in der Variante ein Riss. Oben rieselt
 * Sand `sand.3` über den Rand. Rampe: Sandhang; Treppe: gehauene Sandsteinstufen.
 */
import { GEOMETRIE_KLIPPE, klippenTileset } from './_klippe';

export default klippenTileset({
  gruppe: 'sand',
  legende: { '0': 'laub.0', '1': 'laub.1', '2': 'laub.2', '3': 'laub.3', '4': 'sand.3', G: 'sand.4', E: 'sand.2', e: 'sand.1', f: 'sand.3' },
  front: [
    `3333333333332333
     3433333333332333
     3333333333432333
     3334444333332333
     4444444444432444
     4442244444443444
     2222212224441222
     2222212222221222
     2212212222221222
     2212212222221222
     2212212222222322
     3333322223333333
     3333323333333343
     3333323332333333
     3322333331233333
     2222222221222222`,
    `3332333333333333
     3332333333334333
     4332333333333333
     3332333333333433
     4443444333444444
     4443444444342244
     2243222222122222
     2221222222122222
     2221222122122222
     2222222122122222
     2223332122122222
     3333333333223323
     3333333333233323
     3333343333233323
     3333332233332323
     2222222222222212`,
  ],
  seite: `013334
          013334
          013334
          013334
          014444
          014444
          012224
          012224
          011224
          012224
          012224
          013334
          013334
          013334
          013334
          012224`,
  randNord: `3443443344434434
             2332332233323323
             1_0110_1101_1011`,
  saum: 'sand.2',
  fuss: `................
         ................
         1......1111....1
         11...0344430.341
         01.103333333G033
         _G_1222222221_22`,
  kontur: 'laub.0',
  oberkante: 'sand.4',
  lippe: { kante: 'sand.4', ueberhang: 'sand.3', schatten: 'laub.0' },
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
  buesche: [0,  0,  0,  1,  1,  0,  0,  0,  0,  0,  1,  2,  1,  0,  0,  0],
});
