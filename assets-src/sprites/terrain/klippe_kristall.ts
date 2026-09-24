/**
 * Tileset Klippe Kristall (M2-18, MASTERPROMPT §4.4, docs/ART.md §5, docs/WORLD.md §7): Kristallwände des
 * Scherbenhains in `wasser`/`eis` (ungetönt). Front: Prismen – Mitte `wasser.4`, Rand `wasser.3`, Fugen
 * `wasser.2`, Brüche `wasser.1` mit hellen Prismenköpfen `eis.3`; einzelne Kanten leuchten `wasser.5*`
 * (Kristallkanten sind echte Lichtquellen), Prismenviolett `verderb.3` als seltener Saum. Oben der
 * blasse Kristallboden `eis.2`. Rampe: Kristallhang; Treppe: geschliffene Kristallstufen.
 */
import { GEOMETRIE_KLIPPE, klippenTileset } from './_klippe';

export default klippenTileset({
  gruppe: 'kristall',
  legende: { '0': 'wasser.1', '1': 'wasser.2', '2': 'wasser.3', '3': 'wasser.4', '4': 'eis.3', G: 'eis.4', s: 'wasser.5*', v: 'verderb.3', E: 'eis.1', e: 'eis.0', f: 'eis.2' },
  front: [
    `2333223322332232
     2333223322222232
     2333223320000232
     222222332344s232
     000002332233s232
     3444323322332232
     2333s23322332222
     2333s22222332000
     2333200002332343
     233323vv32332232
     2333223322222232
     2222223320000232
     00000233s3443232
     3444323322332232
     2333223322332232
     2333223322332232`,
    `2333223322332232
     2333223322222232
     2333223320000232
     222222332344s232
     000002332233s232
     3444323322332232
     2333s23322vv2222
     2333s22222s32000
     2333200002332343
     233323vv32332232
     2333223322222232
     2222223320000232
     00000233s3443232
     3444323322332232
     2333223322332232
     2333223322332232`,
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
  saum: 'eis.0',
  fuss: `................
         ................
         1......1111....1
         11...0344430.341
         01.103333333G033
         _G_1222222221_22`,
  kontur: 'wasser.1',
  oberkante: 'eis.4',
  lippe: { ueberhang: 'eis.2', schatten: 'wasser.1' },
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
  buesche: [0,  0,  0,  1,  1,  0,  0,  0,  0,  1,  1,  1,  0,  0,  0,  0],
});
