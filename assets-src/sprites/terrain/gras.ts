/**
 * Tileset Gras (M2-17, docs/ART.md §3, docs/WORLD.md §7): 47 Blob-Frames + die vier handgezeichneten
 * Grasvarianten aus M1 (`boden_gras`, Streuung 3 : 3 : 3 : 1) als Vollfeld.
 * Die Grasnarbe liegt über Erde, Sand, Pflaster und Wasser und zeichnet deshalb den Rand:
 * - Nordkante (Oberkante der Narbe): helle Kante `gras.4` in kurzen Läufen, darüber stechen
 *   Halmspitzen in das tiefere Terrain; keine Kontur – die Kante sieht den Himmel.
 * - Südkante (Front der Narbe, zum Betrachter): Kontur `gras.1`, darüber die dunkle Lippe `gras.2`,
 *   stellenweise zwei Reihen tief – die Dicke der Narbe.
 * - Seiten: Saum `gras.2`, stellenweise doppelt in Läufen von 3 px.
 * Kantenstücke: `GEOMETRIE_NARBE` (Zungen und Buchten, runde Ecken).
 */
import { blobTileset } from '../../lib/blob';
import bodenGras from '../gruenhain_basis/boden_gras';
import { GEOMETRIE_NARBE, GRUPPE_TERRAIN, bandFaerbung, streuung, ueberstand } from './_quelle';

export default blobTileset({
  id: 'tileset_gras',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_NARBE,
  varianten: bodenGras.frames,
  ruhig: [0, 1, 2],
  basis: 'gras.3',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['gras.1', 'gras.2'], n: [undefined], w: ['gras.2'], o: ['gras.2'] },
    breiter: {
      s: [0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0],
      n: [0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0],
      w: [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0],
      o: [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0],
    },
  }, (p) => (p.innen && p.seite === 'n' && p.tiefe === 0 && [3, 4, 8, 9, 10].includes(p.entlang) ? 'gras.4' : undefined)),
  deko: (k, feld, maske) => {
    // Halmspitzen stechen über die Nordkante ins tiefere Terrain.
    ueberstand(k, feld, maske, 'n', ['gras.4', 'gras.4'], streuung(4), 'gras.3');
  },
});
