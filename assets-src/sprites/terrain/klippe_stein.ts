/**
 * Tileset Klippe Stein (M2-18, MASTERPROMPT §4.4, docs/ART.md §3/§5, docs/WORLD.md §7): Fels und Schnee
 * des Frostkamms. Dieselben gestaffelten Felsbuckel wie `klippe_gruen` in `stein` (die Biomzeile tönt sie
 * eisgrau), aber jede Buckeloberseite trägt eine Schneekappe `eis.3`; oben hängt eine Wächte `eis.4`
 * über den Rand, am Fuß liegen Schneeklumpen. Rampe: festgetretener Schnee; Treppe: verschneite Stufen.
 */
import { GEOMETRIE_KLIPPE, klippenTileset } from './_klippe';

export default klippenTileset({
  gruppe: 'stein',
  legende: { '0': 'stein.0', '1': 'stein.1', '2': 'stein.2', '3': 'stein.3', '4': 'eis.3', S: 'stein.4', G: 'eis.4', E: 'eis.2', e: 'eis.1', f: 'eis.3' },
  front: [
    `2321233232321221
     232123S232323221
     232123S212323221
     222123S212323221
     212123S202323221
     343123S202321221
     2320233202221221
     2320233202121221
     2S20233203431221
     2S20233212320223
     2S21222212S20223
     2S21211212S20223
     23213G4312S20223
     23212S3212S21223
     23212S3232321223
     2321233232321333`,
    `1232323321232322
     12323222212S2322
     12323211212S2322
     123213G4302S2322
     1232123S202S2122
     1232123S20232122
     1232123S20232122
     3232123S21232133
     3222023321232122
     321202S321232122
     334302S321232022
     323202S321232022
     32S2123323222022
     32S2123323212022
     32S2123323343122
     32S2123323232122`,
  ],
  seite: `0122S4
          0122S4
          012SS4
          0112S4
          0122S4
          012224
          012S24
          011224
          0122S4
          012SS4
          0122S4
          0112S4
          012224
          0122S4
          012S24
          0122S4`,
  randNord: `3443443344434434
             2332332233323323
             1_0110_1101_1011`,
  saum: 'eis.2',
  fuss: `................
         ................
         1......1111....1
         11...0344430.341
         01.103333333G033
         _G_1222222221_22`,
  kontur: 'stein.0',
  oberkante: 'eis.4',
  lippe: { kante: 'eis.4', ueberhang: 'eis.3', schatten: 'stein.0' },
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
