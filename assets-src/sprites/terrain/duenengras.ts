/**
 * Tileset Dünengras (M2-31, docs/ART.md §5 Salzküste „heller Sand mit türkisem Dünengras“, docs/WORLD.md
 * §7): die Dünen hinter dem Strand – Sand, von Büscheln blaugrünen Dünengrases gehalten. Eigenes Motiv
 * statt der getönten Grünhain-Wiese (deren Narbe mit Lippe las sich auf dem Strand als blaue Linien).
 * - Grund `sand.3` wie der Strand: Die Kante zum Sand hat keine Lippe und keinen Saum – die Düne endet
 *   dort, wo ihre Büschel enden (Überstände über die Kante lasen sich als liegende Striche).
 * - Büschel: windschiefe Fächer aus 1-px-Halmen, am Fuß dunkles Grün (`gras.2`), in der Mitte Petrol
 *   (`wasser.3`), oben Türkis (`wasser.4`), Spitzen Schaumtürkis (`wasser.5`); trockene Halme `sand.2`
 *   mit heller Spitze `sand.4`; Fußschatten `sand.2`. Jede Farbe kommt in jedem Büschel mindestens
 *   zweimal vor – sonst entfernte die Einzelpixel-Bereinigung in Kantenframes Teile eines Büschels.
 *   Die Biomzeile der Salzküste lässt `gras.2` und alle `sand`- und `wasser`-Stufen unverändert – das
 *   Tileset ist in Endfarben gezeichnet.
 * Die Varianten sind spärlich (M3-40): einzelne Keime, kleine Büschel und trockene Halme auf viel Sand –
 * die Dichte der Dünen tragen die Horste (`bodendeko_duenengras`), die die Präsentation in Gruppen quer
 * über die Kachelgrenzen streut (`src/render/world/groundDecor.ts`); so entsteht kein gleichmäßiges
 * 16-px-Raster. Motive an anderen Stellen je Variante, alle vollständig in der Kachel (Varianten passen in
 * jeder Anordnung). Kantenstücke: `GEOMETRIE_WEICH`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_WEICH, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { s: 'sand.3', d: 'sand.2', h: 'sand.4', k: 'gras.2', t: 'wasser.3', g: 'wasser.4', l: 'wasser.5' } as const;

const VARIANTEN = varianten('duenengras', LEGENDE, [
  // 0 ruhig: ein Keim links unten, ein trockener Halm rechts oben.
  `ssssssssssssssss
   ssssssssssssssss
   sssssssssssshsss
   ssssssssssssdhss
   ssssssssssssdsss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssslsslsssssss
   ssssssttssssssss
   sssssdkkdsssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss`,
  // 1 kahl: nur ein trockener Halm.
  `ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssshssssss
   sssssssssdhsssss
   sssssssssdssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss`,
  // 2 ein kleines Büschel rechts, ein trockener Halm links.
  `ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssshssssssssss
   sssssdhsssssssss
   sssssdssssslslss
   sssssssssssgtgss
   sssssssssssstths
   sssssssssssdkkds
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss`,
  // 3 selten: ein mittleres Büschel, ein Keim rechts unten.
  `ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   sslsgslsssssssss
   sssgtgshssssssss
   sssttthsssssssss
   ssssskdsssssssss
   sssdkdssssssssss
   ssssssssssssssss
   ssssssssssssssss
   sssssssssssssgls
   ssssssssssssssts
   sssssssssssssdkd
   ssssssssssssssss
   ssssssssssssssss`,
]);

export default blobTileset({
  id: 'tileset_duenengras',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_WEICH,
  varianten: VARIANTEN,
  ruhig: [0, 1, 2],
  basis: 'sand.3',
  fuellung: 'motive',
  // Büschel dürfen bis eine Reihe vor die Kante stehen: auch schmale Dünenzungen tragen Gras.
  motivAbstand: 1,
  // Keine Lippe, kein Saum: der Rand ist Sand wie der Strand darunter.
  faerbung: bandFaerbung({ baender: { s: [undefined], n: [undefined], w: [undefined], o: [undefined] } }),
});
