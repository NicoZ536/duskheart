/**
 * Tileset Klippe Höhle (M2-18, MASTERPROMPT §4.4, docs/ART.md §5, docs/WORLD.md §7): Höhlenwände der
 * Wurzelhöhlen und des Tiefgrunds (festes Gestein als Höhe über dem Höhlenboden). Gestaffelte Felsbuckel in
 * `stein` (die Biomzeilen tönen sie erdig bzw. blaugrau) mit Erdfugen `erde.0` und Moos `gras.2`; oben
 * hängen Wurzeln `holz.2` über den Rand. Rampe: Erdhang; Treppe: grob behauene Felsstufen.
 */
import { GEOMETRIE_KLIPPE, klippenTileset } from './_klippe';

export default klippenTileset({
  gruppe: 'hoehle',
  legende: { '0': 'erde.0', '1': 'stein.1', '2': 'stein.2', '3': 'stein.3', '4': 'stein.4', G: 'gras.2', E: 'erde.2', e: 'erde.1', f: 'erde.3' },
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
     1122G00341122210
     001G034143301100
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
  saum: 'erde.1',
  fuss: `................
         ................
         1......1111....1
         11...0344430.341
         01.103333333G033
         _G_1222222221_22`,
  kontur: 'erde.0',
  oberkante: 'stein.4',
  lippe: { ueberhang: 'holz.2', schatten: 'erde.0' },
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
  buesche: [0,  0,  1,  2,  2,  0,  0,  0,  0,  2,  2,  1,  0,  0,  0,  0],
});
