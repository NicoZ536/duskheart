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
    `3322133203322132
     3322133203322132
     3s22133203322132
     3322133203s22132
     3322111103322132
     33221G4403322132
     3322133203322132
     3322133203322132
     1111133203322132
     4G44133203322132
     3322133201111132
     3322133204G44132
     3322133203322v32
     3322133203322132
     33221332033221s2
     3322133203322132`,
    `3321332213221322
     3321332213221322
     3321332213221111
     33213322132214G4
     3321332213221322
     332133s213221322
     1111332213221322
     4G41332213221322
     3321332211111322
     332133221G441322
     3321332213221322
     3321111113221322
     33214G4413221322
     3321332213s21322
     3321332213221322
     3321332213221v22`,
  ],
  seite: `012234
          012234
          01s234
          012234
          011234
          012234
          012234
          01223G
          012234
          012234
          011234
          012234
          01s234
          012234
          012234
          011234`,
  randNord: `3443443344434434
             2332332233323323
             1_0110_1101_1011`,
  saum: 'eis.0',
  fuss: `................
         ................
         1......1111....1
         11...0344430.341
         01.103333333G033
         _G_1222222221_22`,
  kontur: 'wasser.1',
  oberkante: 'eis.4',
  lippe: { kante: 'eis.4', ueberhang: 'eis.2', schatten: 'wasser.1' },
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
