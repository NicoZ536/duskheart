/**
 * Tileset Klippe Erbauer (M7-11, Strang C; Material-Klippengruppe `erbauer` für das feste Material `erbauerstein`,
 * `KLIPPE_JE_MATERIAL` in src/world/autotile.ts; docs/SPIEL.md §29): das Mauerwerk der Gewölbe. Anders als der natürliche
 * Fels der Biome (M5-33) ist das hier gesetzter Stein: große Quader in zwei Lagen je Kachel (8 px), Stoßfugen versetzt, jede
 * Lage oben hell `stein.3` (sieht das Licht), unten im Schatten `stein.1`, Fugen `stein.0`; der Grünhain ist durch die Fugen
 * gewachsen – Moos `gras.2`/`gras.3` in Lager- und Stoßfugen, an der Südlippe hängt es über die Kante. Rampe: abgetretene
 * Platten; Treppe: Erbauer-Stufen mit heller Trittkante.
 */
import { GEOMETRIE_KLIPPE, klippenTileset } from './_klippe';

export default klippenTileset({
  gruppe: 'erbauer',
  legende: { '0': 'stein.0', '1': 'stein.1', '2': 'stein.2', '3': 'stein.3', '4': 'stein.4', G: 'gras.2', H: 'gras.3', E: 'stein.2', e: 'stein.1', f: 'stein.3' },
  front: [
    `3333333033333330
     2222222022222220
     2212222022222120
     2222222022222220
     2222122022122220
     2222222022222220
     1111111011111110
     0000000000000000
     3330333333330333
     2220222222220222
     2220222122220222
     2220222222220212
     2120222222220222
     2220221222220222
     1110111111110111
     0000000000000000`,
    `3333333033333330
     2222222022222220
     2222222022222220
     2222222022222220
     2222222H22122220
     2122222G22222220
     1111111G11111110
     0GH00000000000G0
     3330333333330333
     2220222222220222
     2220222222220222
     222H222212220222
     222G222222220222
     2220222222220222
     1110111111110111
     000000GHG0000000`,
  ],
  seite: `012234
          012234
          012234
          012234
          012234
          012234
          011124
          000004
          012234
          012234
          012234
          012234
          012234
          012234
          011124
          000004`,
  randNord: `4444444444444444
             3333333333333333
             1111111111111111`,
  saum: 'stein.1',
  fuss: `................
         ................
         ................
         ................
         ..G........H....
         .GHG......HGG...`,
  kontur: 'stein.0',
  oberkante: 'stein.4',
  lippe: { kante: 'stein.4', ueberhang: 'gras.2', schatten: 'stein.0' },
  rampe: `EEEEEEEeEEEEEEEE
          EEEEEEEeEEEEEEEE
          EEEEEEEeEEEEEEEE
          eeeeeeeeeeeeeeee
          EEEeEEEEEEEeEEEE
          EEEeEEEEEEEeEEEE
          EEEeEEEEEEEeEEEE
          eeeeeeeeeeeeeeee
          EEEEEEEeEEEEEEEE
          EEEEEEEeEEEEEEEE
          EEEEEEEeEEEEEEEE
          eeeeeeeeeeeeeeee
          EEEeEEEEEEEeEEEE
          EEEeEEEEEEEeEEEE
          EEEeEEEEEEEeEEEE
          eeeeeeeeeeeeeeee`,
  treppe: `4444444444444444
           3333333333333333
           2222222222222222
           1111111111111111
           4444444444444444
           3333333333333333
           2222222222222222
           1111111111111111
           4444444444444444
           3333333333333333
           2222222222222222
           1111111111111111
           4444444444444444
           333G333333333333
           22GH222222222222
           1111111111111111`,
  geometrie: GEOMETRIE_KLIPPE,
  buesche: [0,  0,  1,  2,  1,  0,  0,  0,  0,  0,  1,  2,  1,  0,  0,  0],
});
