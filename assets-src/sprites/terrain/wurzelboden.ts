/**
 * Tileset Wurzelboden (M2-18, docs/ART.md §5, docs/WORLD.md §7): Boden der Wurzelhöhlen – Erde in
 * `erde.2`/`erde.3` (die Biomzeile Wurzelhöhlen tönt sie in das dunkle Wurzelbraun `erde.0`/`erde.1`),
 * darüber Wurzeln in `holz` (ungetönt: Oberseite `holz.3`, Flanke `holz.2`, Schatten `holz.1` am Fuß)
 * und Moosspitzen in `gras`. Jede Wurzel beginnt und endet in der Kachel (nahtlos); die Motive liegen
 * je Variante in einem anderen Viertel, damit im Fackellicht kein 16-px-Raster entsteht.
 * Rand über Höhlenboden, Erde, Wasser und Lava: Front `erde.0`/`erde.1`, Oberkante `erde.3`, an Nord-
 * und Seitenkanten ragen Wurzelspitzen über den Rand. Kantenstücke: `GEOMETRIE_SCHOLLE`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_SCHOLLE, GRUPPE_TERRAIN, bandFaerbung, streuung, ueberstand, varianten } from './_quelle';

const LEGENDE = { e: 'erde.2', E: 'erde.3', d: 'erde.1', R: 'holz.3', r: 'holz.2', o: 'holz.1', m: 'gras.3', M: 'gras.4' } as const;

const VARIANTEN = varianten('wurzelboden', LEGENDE, [
  // 0 ruhig: nackte Erde, nur ein heller und ein dunkler Erdkrümel (ruhige Flächen zwischen den Wurzeln).
  `eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeEEeeee
   eeeeeddeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee`,
  // 1 ruhig: eine kurze, flache Wurzel links oben, ein Moosbüschel.
  `eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeRRReeeeeeeeee
   eeoorrRReeeeeeee
   eeeeeoorreeeeeee
   eeeeeeeooeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeMMeee
   eeeeeeeeeemMmmee
   eeeeeeeeeeemmeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee`,
  // 2 zwei Wurzeln (oben links, unten rechts), dazwischen eine Mulde.
  `eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeRReeeeeeeeeeee
   eerrRReeeeeeeeee
   eeoorrReeeeeeeee
   eeeeoorreeeeeeee
   eeeeeeooeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeEEEeeee
   eeeeeeeeEddddeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeRRRRee
   eeeeeeeeeRrrrroe
   eeeeeeeeeooooooe
   eeeeeeeeeeeeeeee`,
  // 3 selten: Wurzelknoten mit Moospolster unten links.
  `eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeMMMeeeeeeee
   eeeeMMmMMeeeeeee
   eeRRmmmmRReeeeee
   errrRRRRrrreeeee
   eoorrrrrroooeeee
   eeeoooooooeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee
   eeeeeeeeeeeeeeee`,
]);

export default blobTileset({
  id: 'tileset_wurzelboden',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_SCHOLLE,
  varianten: VARIANTEN,
  ruhig: [0, 1],
  basis: 'erde.2',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['erde.0', 'erde.1'], n: ['erde.3'], w: ['erde.1'], o: ['erde.1'] },
    breiter: { s: [0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0] },
  }),
  deko: (k, feld, maske) => {
    // Wurzelspitzen ragen über Nord- und Seitenkanten.
    ueberstand(k, feld, maske, 'n', ['holz.2', 'holz.2'], streuung(6, 3), 'holz.2');
    ueberstand(k, feld, maske, 'w', ['holz.2', 'holz.2'], streuung(7, 1), 'holz.2');
    ueberstand(k, feld, maske, 'o', ['holz.2', 'holz.2'], streuung(7, 4), 'holz.2');
  },
});
