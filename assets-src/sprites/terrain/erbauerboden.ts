/**
 * Tileset Erbauer-Boden (M7-11, Strang C; Terrain `erbauerboden`, docs/SPIEL.md §29; docs/ART.md §5, docs/WORLD.md §7): der
 * Boden der Gewölbe – große behauene Platten im Läuferverband (oben eine Platte über die ganze Kachel, unten zwei halbe, die
 * Fugen kacheln nahtlos), die Oberkante jeder Platte hell `stein.3`, Grundton `stein.2`, Fugen `stein.1` mit tiefem Kern
 * `stein.0`. Die Biomzeile des Gewölbes tönt ihn (Grünhain: moosig). Varianten: ruhig (4), ein Sprung (3), Moos in der Fuge
 * `gras.2`/`gras.3` (2), selten ein eingemeißelter Ring der Erbauer (1). Rand über tieferem Terrain wie der Höhlenboden.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_SCHOLLE, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { s: 'stein.2', S: 'stein.3', d: 'stein.1', D: 'stein.0', g: 'gras.2', G: 'gras.3' } as const;

const VARIANTEN = varianten('erbauerboden', LEGENDE, [
  // 0 ruhig: nur die Fugen.
  `dSSSSSSSSSSSSSSS
   dsssssssssssssss
   dsssssssssssssss
   dsssssssssssssss
   dsssssssssssssss
   dsssssssssssssss
   dsssssssssssssss
   dddddddddddddddd
   SSSSSSSdSSSSSSSS
   sssssssdssssssss
   sssssssdssssssss
   sssssssdssssssss
   sssssssdssssssss
   sssssssdssssssss
   sssssssdssssssss
   dddddddddddddddd`,
  // 1 ein Sprung quer über die obere Platte.
  `dSSSSSSSSSSSSSSS
   dsssssssssssssss
   dssssssssdssssss
   dsssssssdDdsssss
   dssssssdsssdssss
   dsssssdsssssdsss
   dsssssssssssssss
   dddddddddddddddd
   SSSSSSSdSSSSSSSS
   sssssssdssssssss
   sssssssdssssssss
   sssssssdssssssss
   sssssssdssssssss
   sssssssdssssssss
   sssssssdssssssss
   dddddddddddddddd`,
  // 2 Moos wächst aus den Fugen.
  `dSSSSSSSSSSSSSSS
   dsssssssssssssss
   gsssssssssssssss
   Ggssssssssssssss
   dsssssssssssssss
   dsssssssssssssss
   dsssssssssssssss
   ddddgGgddddddddd
   SSSSSgSdSSSSSSSS
   sssssssGssssssss
   sssssssggsssssss
   sssssssdssssssss
   sssssssdssssssss
   sssssssdssssssss
   sssssssdssssssss
   ddddddddddddgGdd`,
  // 3 selten: ein eingemeißelter Ring der Erbauer auf der unteren Platte.
  `dSSSSSSSSSSSSSSS
   dsssssssssssssss
   dsssssssssssssss
   dsssssssssssssss
   dsssssssssssssss
   dsssssssssssssss
   dsssssssssssssss
   dddddddddddddddd
   SSSSSSSdSSSSSSSS
   ssssddsdssssssss
   sssdssDdssssssss
   sssdsDsdssssssss
   sssdssDdssssssss
   ssssddsdssssssss
   sssssssdssssssss
   dddddddddddddddd`,
]);

export default blobTileset({
  id: 'tileset_erbauerboden',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_SCHOLLE,
  varianten: VARIANTEN,
  ruhig: [0, 1],
  basis: 'stein.2',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['stein.0', 'stein.1'], n: ['stein.3'], w: ['stein.1'], o: ['stein.1'] },
    breiter: { s: [0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0] },
  }),
});
