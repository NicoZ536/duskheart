/**
 * Tileset Erbauer-Boden (M7-11, Strang C; Terrain `erbauerboden`, docs/SPIEL.md §29; docs/ART.md §5, docs/WORLD.md §7): der
 * Boden der Gewölbe – große quadratische Platten, eine je Kachel (wie die Fliesen eines Tempelbodens, nicht die Läufer einer
 * Mauer): die Oberkante jeder Platte hell `stein.3`, Grundton `stein.2`, rechts und unten die Fuge `stein.1` mit tiefem
 * Kreuzungspunkt `stein.0` – so liegen die Platten im Raster und lesen sich als Boden, die Wände tragen die Läuferverbände.
 * Die Biomzeile des Gewölbes tönt ihn (Grünhain: moosig). Varianten: ganze Platte (8), längs geteilt (2), eine Platte mit
 * Sprung und Moos in der Fuge `gras.2`/`gras.3` (2), selten ein eingemeißelter Ring der Erbauer (1). Füllung `textur`: das
 * Fugenraster läuft bis an die Wand. Rand über tieferem Terrain wie der Höhlenboden.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_SCHOLLE, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { s: 'stein.2', S: 'stein.3', d: 'stein.1', D: 'stein.0', g: 'gras.2', G: 'gras.3' } as const;

const VARIANTEN = varianten('erbauerboden', LEGENDE, [
  // 0 eine ganze Platte (ruhig: sie trägt die Fläche; Abwechslung bringen die seltenen Varianten).
  `SSSSSSSSSSSSSSSd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   dddddddddddddddD`,
  // 1 längs geteilt: zwei schmale Platten.
  `SSSSSSSdSSSSSSSd
   sssssssdsssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   dddddddDdddddddD`,
  // 2 ein Sprung über die Platte, Moos in der Fugenkreuzung.
  `SSSSSSSSSSSSSSSd
   sssssssssssssssd
   ssssssssssssdssd
   sssssssssssdsssd
   ssssssssssdssssd
   sssssssssdDssssd
   ssssssssdssssssd
   sssssssdsssssssd
   sssssssdsssssssd
   ssssssdssssssssd
   sssssdsssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssgGd
   ssssssssssssssgG
   ddddddddddddddgG`,
  // 3 selten: ein eingemeißelter Ring der Erbauer in der Plattenmitte.
  `SSSSSSSSSSSSSSSd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssddddssssssd
   ssssdSSSSdsssssd
   sssdSssssSdssssd
   sssdSsddsSdssssd
   sssdSsddsSdssssd
   sssdSssssSdssssd
   ssssdSSSSdsssssd
   sssssddddssssssd
   sssssssssssssssd
   sssssssssssssssd
   sssssssssssssssd
   dddddddddddddddD`,
]);

export default blobTileset({
  id: 'tileset_erbauerboden',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_SCHOLLE,
  varianten: VARIANTEN,
  ruhig: [0, 1],
  basis: 'stein.2',
  fuellung: 'textur',
  faerbung: bandFaerbung({
    baender: { s: ['stein.0', 'stein.1'], n: ['stein.3'], w: ['stein.1'], o: ['stein.1'] },
    breiter: { s: [0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0] },
  }),
});
