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
 * Motive verschiedener Größe je Variante an anderen Stellen gegen das 16-px-Raster; alle vollständig
 * in der Kachel (Varianten passen in jeder Anordnung). Kantenstücke: `GEOMETRIE_WEICH`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_WEICH, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { s: 'sand.3', d: 'sand.2', h: 'sand.4', k: 'gras.2', t: 'wasser.3', g: 'wasser.4', l: 'wasser.5' } as const;

const VARIANTEN = varianten('duenengras', LEGENDE, [
  // 0 ruhig: ein mittleres Büschel links, zwei kleine rechts oben und unten.
  `ssssssssssssssss
   sssssssssssssgss
   sssssssssslssgsl
   sssgsssssssttsts
   slsgslsssssskkss
   ssgtgshssssdkdss
   ssttthssssssssss
   ssskdsssssssssss
   ssdkdsssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssslslss
   ssssssssssststss
   ssssssssssssksss
   sssssssssssdkdss
   ssssssssssssssss`,
  // 1 großes Büschel mit trockenem Halm in der Mitte, zwei kleine links.
  `ssssssssssssssss
   slslssssssssssss
   ststssssssssssss
   ssksssssssssssss
   sdkdssssssssssss
   ssssssssssssssss
   ssssssslsgssssss
   sssssgsgsgslssss
   ssssssgtstgsshss
   sssssgstttsshsss
   sssgssttktsdssss
   lssgslskksdsssss
   sttstssdkdssssss
   sskkssssssssssss
   sdkdssssssssssss
   ssssssssssssssss`,
  // 2 zwei mittlere Büschel diagonal, ein kleines rechts unten.
  `ssssssssssssssss
   ssssssssssssssss
   ssssssssssgsssss
   sssssssslsgslsss
   sssssssssgtgshss
   sssssssssttthsss
   sssssssssskdssss
   sssssssssdkdssss
   ssssssssssssssss
   sslsssssssssssss
   ssgsgslsssssssss
   gsstggsssssslsls
   ststtssssssststs
   sskkssssssssskss
   ssdkdsssssssdkds
   ssssssssssssssss`,
  // 3 selten: großes Büschel oben links, ein mittleres und ein kleines rechts.
  `sslsgsssssssssss
   gsgsgslssssssgss
   sgtstgsshslssgsl
   gstttsshsssttsts
   sttktsdssssskkss
   sskksdsssssdkdss
   ssdkdsssssssssss
   ssssssssssssssss
   ssssssssssssssss
   sssssssssslsssss
   ssssssssssgsgsls
   ssssssssgsstggss
   ssssssssststtsss
   sssssssssskkssss
   ssssssssssdkdsss
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
