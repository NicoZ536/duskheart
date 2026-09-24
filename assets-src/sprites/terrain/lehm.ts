/**
 * Tileset Lehm (docs/ART.md §5, docs/WORLD.md §7, ADR-0024): feuchte Lehmnester im Boden der
 * Wurzelhöhlen. Ockerbrauner Grund in `sand` (die Biomzeile Wurzelhöhlen tönt `sand` nicht: der Lehm
 * bleibt warm gegen den dunklen, getönten Wurzelboden), Trockenrisse in `holz.1`/`holz.0`, glatt
 * gestrichene nasse Stellen mit Glanz (`sand.1`/`sand.2`, Materialflag `nass`), selten eine rote
 * Eisenader (`laub.1`) und ein eingebackener Kiesel (`stein`). Die Motive liegen je Variante in einem
 * anderen Viertel, damit im Fackellicht kein 16-px-Raster entsteht (Lehre aus dem Wurzelboden).
 * Rand über Schlamm, Eis und Wasser: Front `holz.1`/`holz.2`, Oberkante `sand.1`. Kantenstücke:
 * `GEOMETRIE_SCHOLLE`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_SCHOLLE, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { l: 'sand.0', L: 'sand.1', w: 'sand.2', c: 'holz.1', C: 'holz.0', r: 'laub.1', k: 'stein.3', K: 'stein.1' } as const;

const VARIANTEN = varianten('lehm', LEGENDE, [
  // 0 ruhig: ein kurzer, verzweigter Trockenriss oben links.
  `llllllllllllllll
   llllllllllllllll
   lllcllllllllllll
   llllcCllllllllll
   lllllcllllllllll
   lllllcclllllllll
   llllllllcCllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll`,
  // 1 ruhig: glatt gestrichene, flache nasse Stelle unten rechts mit Glanzlicht (ohne Schatten: sie liegt im Boden).
  `llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllLLLlll
   lllllllLLLLwwLll
   llllllllLLLLLlll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll`,
  // 2 Rissnetz: ein Stück Schollenmuster unten links, Schollen mit heller Oberkante.
  `llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   lllLLllllLLlllll
   llcccccLLlclllll
   llllLlclllclllll
   lLLllllcccCcllll
   lcccLLlcllllllll
   llllcclCllllllll
   llllllccllllllll
   llllllllllllllll
   llllllllllllllll`,
  // 3 selten: rote Eisenader quer und ein eingebackener Kiesel oben rechts.
  `llllllllllllllll
   llllllllllllllll
   llllllllllllkkll
   lllllllllllkkKll
   llllllllllllKKll
   llllllllllllllll
   llllllllllllllll
   llrrllllllllllll
   lllrrrllllllllll
   llllllrrrlllllll
   lllllllllrrlllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll
   llllllllllllllll`,
]);

export default blobTileset({
  id: 'tileset_lehm',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_SCHOLLE,
  varianten: VARIANTEN,
  ruhig: [0, 1],
  basis: 'sand.0',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['holz.1', 'holz.2'], n: ['sand.1'], w: ['holz.2'], o: ['holz.2'] },
    breiter: { s: [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0] },
  }),
  material: { nass: ['sand.2'] },
});
