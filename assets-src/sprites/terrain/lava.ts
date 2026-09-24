/**
 * Tileset Lava (M2-18, docs/ART.md §7 Gefahren-Bildsprache, docs/WORLD.md §7): Lavagrund – zähe Glut
 * `feuer.3*` mit hellen Adern `feuer.4*` und weißglühenden Kernen `feuer.5*` (Kern heller als Rand),
 * Hautfalten aus abkühlender Glut `feuer.2*`, selten eine treibende Krustenplatte `nacht.1` (Oberseite
 * `nacht.2`) mit warm glühendem Rand `laub.0` und Glutriss. Nur ungetönte Rampen (`feuer`, `nacht`, `laub`), damit die Biomzeilen die Kruste nicht
 * verschlucken. Emissiv sind nur die Glutpixel. Lava liegt ganz unten und ist **Saum-Terrain** wie der
 * Meeresgrund: Zu jedem fremden Nachbarn erkaltet sie zu einer Krustenbank (`laub.0` an der Glut,
 * dahinter `nacht.1`/`nacht.2` mit schrägen Glutrissen `feuer.1*`/`feuer.2*`); unter fremden Kacheln
 * liegt die reine Krustenbank (Blob 0). Die Glut am Saum kühlt nach außen ab (`feuer.2*`).
 * Kantenstücke: `GEOMETRIE_WEICH` (zähe Zungen).
 */
import { blobTileset } from '../../lib/blob';
import { BANK, GEOMETRIE_WEICH, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { f: 'feuer.3*', F: 'feuer.4*', W: 'feuer.5*', r: 'feuer.2*', k: 'nacht.1', K: 'laub.0', c: 'nacht.2' } as const;

const VARIANTEN = varianten('lava', LEGENDE, [
  // 0 ruhig: Fließstreifen – helle Adern `feuer.4*`, abkühlende Streifen `feuer.2*`.
  `ffffffffffffffff
   ffffffffffffffff
   ffffffFFFFffffff
   fffffffffFFfffff
   ffffffffffffffff
   ffrrrfffffffffff
   ffffrrffffffffff
   ffffffffffffffff
   ffffffffffffffff
   fffffffffffFFFff
   ffffffFFFFFfffff
   ffffffffffffffff
   ffffffffffffffff
   fffrrrrfffffffff
   ffffffrrffffffff
   ffffffffffffffff`,
  // 1 Hautfalten: abkühlende Haut `feuer.2*` in Bögen, darunter die heiße Glut `feuer.4*`.
  `ffffffffffffffff
   ffffffffffffffff
   ffffffffffffffff
   ffffffffffffffff
   fffffrrrrfffffff
   ffffrFFFFrrfffff
   fffffffffFFfffff
   ffffffffffffffff
   fffffffrrrrrffff
   ffffffrFFFFFrfff
   ffffffffffffFfff
   ffffffffffffffff
   ffrrrfffffffffff
   fffFFrffffffffff
   ffffffffffffffff
   ffffffffffffffff`,
  // 2 Aufquellen: kleiner weißglühender Kern im hellen Hof.
  `ffffffffffffffff
   ffffffffffffffff
   ffffffffffffffff
   ffffffffffffffff
   ffffffffffffffff
   fffffffFFfffffff
   ffffffFWWFffffff
   fffffffFFFffffff
   ffffffffffffffff
   ffffffffffffffff
   ffffffffffffffff
   ffffffffffffffff
   ffFFFfffffffffff
   ffffFFffffffffff
   ffffffffffffffff
   ffffffffffffffff`,
  // 3 selten: treibende Krustenplatte – glühender Rand `laub.0`, Kruste `nacht.1`, Oberseite `nacht.2`, Riss.
  `ffffffffffffffff
   ffffffffffffffff
   ffffffffffffffff
   ffffffffffffffff
   ffffffffffffffff
   fffffrrrrrrrffff
   ffffrKKKKKKKrfff
   fffrKkccccckKrff
   ffrKkkkckrkkKrff
   fffrKKkkkrkKrfff
   ffffrrKKKKKrffff
   ffffffrrrrrfffff
   ffffffffffffffff
   ffffffffffffffff
   ffffffffffffffff
   ffffffffffffffff`,
]);

/** Krustenbank: dunkle Kruste `nacht.1` mit helleren Oberseiten `nacht.2` und schrägen Glutrissen (Kern `feuer.2*`). */
const KRUSTE = [
  'kkkkkkkkkkkkkkkk',
  'kkkkkkkkkkkkkkkk',
  'kkkcckkkkkkkkkkk',
  'kkkkcckkkkkkkkRk',
  'kkkkkkkkkkkkrRkk',
  'kkkkkkkkkkkRkkkk',
  'kkkkkkkkkkkkkkkk',
  'kkRkkkkkkkkkkkkk',
  'kkkRrkkkkkkkkkkk',
  'kkkkkRRkkkkkcckk',
  'kkkkkkkkkkkkkcck',
  'kkkkkkkkkkkkkkkk',
  'kkkkkkkkkRkkkkkk',
  'kkkkkkkkkkrRkkkk',
  'kkkkkkkkkkkkkkkk',
  'kkkkkkkkkkkkkkkk',
];
const KRUSTE_FARBE: Readonly<Record<string, string>> = { k: 'nacht.1', c: 'nacht.2', R: 'feuer.1*', r: 'feuer.2*' };

export default blobTileset({
  id: 'tileset_lava',
  group: GRUPPE_TERRAIN,
  art: 'saum',
  geometrie: GEOMETRIE_WEICH,
  varianten: VARIANTEN,
  ruhig: [0, 1],
  basis: 'feuer.3*',
  fuellung: 'motive',
  motivAbstand: 3,
  faerbung: bandFaerbung({
    baender: { s: ['feuer.2*'], n: ['feuer.2*'], w: ['feuer.2*'], o: ['feuer.2*'] },
    breiter: {
      s: [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0],
      n: [0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    aussen: { s: ['laub.0', BANK], n: ['laub.0', BANK], w: ['laub.0', BANK], o: ['laub.0', BANK] },
    bank: (x, y) => KRUSTE_FARBE[KRUSTE[y]?.[x] ?? 'k'] ?? 'nacht.1',
  }),
});
