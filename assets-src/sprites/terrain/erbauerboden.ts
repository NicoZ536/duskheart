/**
 * Tileset Erbauer-Boden (M7-11, Strang C; Terrain `erbauerboden`, docs/SPIEL.md §29; docs/ART.md §5, docs/WORLD.md §7): der
 * Boden der Gewölbe – große quadratische Platten, eine je Kachel (wie die Fliesen eines Tempelbodens, nicht die Läufer einer
 * Mauer): Grundton `stein.2`, unter der oberen Fuge eine helle Kante `stein.3`, ringsum eine Fuge `stein.1` am Kachelrand –
 * zwei Kacheln nebeneinander ergeben eine Fuge von 2 px, waagrecht wie senkrecht. Weil die Fugen auf beiden Seiten liegen,
 * darf die Streuung die Varianten spiegeln wie bei jedem Boden (nur die Straße mit ihren einseitigen Fugen nicht): das
 * Raster bleibt geschlossen. Die Biomzeile des Gewölbes tönt ihn (Grünhain: moosig). Varianten: ganze Platte (8), längs
 * geteilt (2), eine Platte mit Sprung und Moos in der Fugenecke `gras.2`/`gras.3` (2), selten ein eingemeißelter Ring der
 * Erbauer (1). Füllung `textur`: das Fugenraster läuft bis an die Wand. Rand über tieferem Terrain wie der Höhlenboden.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_SCHOLLE, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { s: 'stein.2', S: 'stein.3', d: 'stein.1', D: 'stein.0', g: 'gras.2', G: 'gras.3' } as const;

const VARIANTEN = varianten('erbauerboden', LEGENDE, [
  // 0 eine ganze Platte (ruhig: sie trägt die Fläche; Abwechslung bringen die seltenen Varianten).
  `dddddddddddddddd
   dSSSSSSSSSSSSSSd
   dssssssssssssssd
   dssssssssssssssd
   dssssssssssssssd
   dssssssssssssssd
   dssssssssssssssd
   dssssssssssssssd
   dssssssssssssssd
   dssssssssssssssd
   dssssssssssssssd
   dssssssssssssssd
   dssssssssssssssd
   dssssssssssssssd
   dssssssssssssssd
   dddddddddddddddd`,
  // 1 längs geteilt: zwei schmale Platten, die Mittelfuge so breit wie die Randfugen.
  `dddddddddddddddd
   dSSSSSSddSSSSSSd
   dssssssddssssssd
   dssssssddssssssd
   dssssssddssssssd
   dssssssddssssssd
   dssssssddssssssd
   dssssssddssssssd
   dssssssddssssssd
   dssssssddssssssd
   dssssssddssssssd
   dssssssddssssssd
   dssssssddssssssd
   dssssssddssssssd
   dssssssddssssssd
   dddddddddddddddd`,
  // 2 ein Sprung über die Platte, Moos in der Fugenecke.
  `dddddddddddddddd
   dSSSSSSSSSSSSSSd
   dsssssssssssdssd
   dssssssssssdsssd
   dsssssssssdssssd
   dssssssssdsssssd
   dssssssssdsssssd
   dsssssssdssssssd
   dssssssdsssssssd
   dssssssdsssssssd
   dsssssdssssssssd
   dssssdsssssssssd
   dssssssssssssssd
   dsssssssssssssgg
   dssssssssssssgGG
   dddddddddddddgGg`,
  // 3 selten: ein eingemeißelter Ring der Erbauer in der Plattenmitte (symmetrisch – gespiegelt derselbe).
  `dddddddddddddddd
   dSSSSSSSSSSSSSSd
   dssssssssssssssd
   dssssssssssssssd
   dsssssddddsssssd
   dssssdSSSSdssssd
   dsssdSssssSdsssd
   dsssdSsddsSdsssd
   dsssdSsddsSdsssd
   dsssdSssssSdsssd
   dssssdSSSSdssssd
   dsssssddddsssssd
   dssssssssssssssd
   dssssssssssssssd
   dssssssssssssssd
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
  fuellung: 'textur',
  faerbung: bandFaerbung({
    baender: { s: ['stein.0', 'stein.1'], n: ['stein.3'], w: ['stein.1'], o: ['stein.1'] },
    breiter: { s: [0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0] },
  }),
});
