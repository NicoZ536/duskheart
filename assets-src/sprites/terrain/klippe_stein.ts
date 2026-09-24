/**
 * Tileset Klippe Stein (M2-18, MASTERPROMPT §4.4, docs/ART.md §3/§5, docs/WORLD.md §7): Fels und Schnee
 * des Frostkamms. Dieselben gestaffelten Felsbuckel wie `klippe_gruen` in `stein` (die Biomzeile tönt sie
 * eisgrau), aber jede Buckeloberseite trägt eine Schneekappe `eis.3`; oben hängt eine Wächte `eis.4`
 * über den Rand, am Fuß liegen Schneeklumpen. Rampe: festgetretener Schnee; Treppe: verschneite Stufen.
 */
import { GEOMETRIE_KLIPPE, klippenTileset } from './_klippe';

export default klippenTileset({
  gruppe: 'stein',
  legende: { '0': 'stein.0', '1': 'stein.1', '2': 'stein.2', '3': 'stein.3', '4': 'eis.3', G: 'eis.4', E: 'eis.2', e: 'eis.1', f: 'eis.3' },
  front: [
    `3334431233344433
     3333321223333332
     2233211022233321
     1122100341122210
     0011034443301100
     4430233333210344
     3321223333210233
     3321122222101233
     2210011111012222
     1103444300234111
     0233333321333400
     4333333221233344
     3322222210122333
     2211111101102233
     1100000343210122
     0344433333321011`,
    `3334431233344433
     3333321223333332
     2233211022233321
     1122300341122210
     0013034143301100
     4430233133210344
     3321232133210233
     3321122022101233
     2210011011012222
     1103444300234111
     0233333321333400
     4333333221233344
     3322222210122333
     2211111101102233
     1100000343210122
     0344433333321011`,
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
  saum: 'eis.2',
  fuss: `................
         ................
         1......1111....1
         11...0344430.341
         01.103333333G033
         _G_1222222221_22`,
  kontur: 'stein.0',
  oberkante: 'eis.4',
  lippe: { ueberhang: 'eis.4', schatten: 'stein.0' },
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
  buesche: [0,  0,  1,  2,  2,  1,  0,  0,  0,  1,  1,  2,  1,  0,  0,  0],
});
