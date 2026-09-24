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
    `4444333334444444
     3333333333332233
     3333333330033333
     3333333331133333
     1111113333311111
     3333331111133333
     2222223333322112
     2210122222222222
     1111222222111111
     4444111111444444
     3333444444333333
     3333333111111333
     1111111333333111
     3333333222222333
     2220011112222222
     1311144341113311`,
    `4444333334444444
     3333333333332233
     3333113330033333
     3333333331133333
     1111113333311111
     3333331111133333
     2222220333322112
     2210121222222222
     1111222222111111
     4444111111444444
     3333444004333333
     3333333111111333
     1111111333333111
     3333333222222333
     2220011112222222
     1311144341113311`,
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
  saum: 'sand.2',
  fuss: `................
         ................
         1......1111....1
         11...0344430.341
         01.103333333G033
         _G_1222222221_22`,
  kontur: 'laub.0',
  oberkante: 'sand.4',
  lippe: { ueberhang: 'sand.3', schatten: 'laub.0' },
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
