/**
 * Tileset Klippe Höhle (M2-18, MASTERPROMPT §4.4, docs/ART.md §5, docs/WORLD.md §7): Höhlenwände der
 * Wurzelhöhlen und des Tiefgrunds (festes Gestein als Höhe über dem Höhlenboden). Gestaffelte Felsbuckel in
 * `stein` (die Biomzeilen tönen sie erdig bzw. blaugrau) mit Erdfugen `erde.0` und Moos `gras.2`; oben
 * hängen Wurzeln `holz.2` über den Rand. Rampe: Erdhang; Treppe: grob behauene Felsstufen.
 */
import { GEOMETRIE_KLIPPE, klippenTileset } from './_klippe';

export default klippenTileset({
  gruppe: 'hoehle',
  legende: { '0': 'erde.0', '1': 'stein.1', '2': 'stein.2', '3': 'stein.3', '4': 'stein.4', G: 'gras.2', H: 'gras.3', E: 'erde.2', e: 'erde.1', f: 'erde.3' },
  front: [
    `2333212321233323
     2343232321233323
     2343232321233323
     2343212221233323
     2343212120233323
     2333213430233323
     2233212320233323
     2233212420233321
     2233202421232221
     2333202421221111
     233320242111HH31
     233320232134G321
     2233212323234321
     1122212323234321
     3411112323234321
     2344312323233321`,
    `3232123333321232
     3222323333321232
     3211323343321232
     3143323343321232
     3332123343321232
     3242122343321222
     3242122333320212
     1242022333320343
     1242023333320232
     1232022333320242
     1232011222321242
     1232134111221242
     1232123444111232
     12321233GH431232
     1232123333321232
     1232123333323232`,
  ],
  seite: `022344
          023344
          023334
          012334
          022334
          023234
          023234
          013334
          022334
          022344
          012334
          023334
          023234
          022234
          012334
          022334`,
  randNord: `3443443344434434
             2332332233323323
             1_0110_1101_1011`,
  saum: 'erde.1',
  fuss: `................
         ................
         1......1111....1
         11...0344430.341
         01.103333333G033
         _G_1222222221_22`,
  kontur: 'erde.0',
  oberkante: 'stein.4',
  lippe: { kante: 'stein.3', ueberhang: 'holz.2', schatten: 'erde.0' },
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
