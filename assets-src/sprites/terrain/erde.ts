/**
 * Tileset Erde (M2-17, docs/ART.md §3, docs/WORLD.md §7): 47 Blob-Frames + die vier handgezeichneten
 * Erdvarianten aus M1 (`boden_erde`, Streuung 2 : 2 : 3 : 1). Erde liegt über Sand, Pflaster, Torf,
 * Schlamm und Wasser: Südkante = abgebrochene Scholle (Kontur `erde.0`, Front `erde.1`), Nordkante =
 * trockene helle Kante `erde.3` mit Krümeln davor, Seiten mit Saum `erde.1`.
 * Kantenstücke: `GEOMETRIE_SCHOLLE` (kurze Stufen, ausgebrochene Brocken).
 */
import { blobTileset } from '../../lib/blob';
import bodenErde from '../gruenhain_basis/boden_erde';
import { GEOMETRIE_SCHOLLE, GRUPPE_TERRAIN, bandFaerbung, streuung, ueberstand } from './_quelle';

export default blobTileset({
  id: 'tileset_erde',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_SCHOLLE,
  varianten: bodenErde.frames,
  ruhig: [0, 1, 2],
  basis: 'erde.2',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['erde.0', 'erde.1'], n: ['erde.3'], w: ['erde.1'], o: ['erde.1'] },
    breiter: {
      s: [0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0],
      w: [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0],
      o: [0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    },
  }),
  deko: (k, feld, maske) => {
    // Krümel: kleine Schollen, die vor der Nordkante liegen geblieben sind.
    ueberstand(k, feld, maske, 'n', ['erde.3', 'erde.2'], streuung(5, 2), 'erde.3');
  },
});
