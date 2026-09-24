/**
 * Tileset Schnee (M2-18, docs/ART.md §3/§5, docs/WORLD.md §7): Schnee liegt immer oben. In `eis`
 * gezeichnet (ungetönt): Grundton `eis.3`, schmale Verwehungen mit hellem Kamm `eis.4` über kurzem
 * blauem Schatten `eis.2` (Himmelsöffnung: oben hell, darunter verdeckt), ein weicher Hügel, selten
 * durchstechende Halme (`gras`, von der Biomzeile getönt).
 * Rand: dicke, weiche Decke – Front `eis.1` über `eis.2` (die Schneedecke hat Höhe), helle Oberkante
 * `eis.4`, Seiten `eis.2`; große runde Ecken. Kantenstücke: `GEOMETRIE_WEICH`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_WEICH, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { n: 'eis.3', h: 'eis.4', s: 'eis.2', S: 'eis.1', g: 'gras.2' } as const;

const VARIANTEN = varianten('schnee', LEGENDE, [
  // 0 ruhig: eine schmale Verwehung – heller Kamm, kurzer Schatten darunter.
  `nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnhhhhnnnnn
   nnnnnnnnnsssnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn`,
  // 1 zwei Verwehungen verschiedener Länge.
  `nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnhhhhhn
   nnnnnnnnnnnnssnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnhhhhhhnnnnnnnn
   nnnnnssssnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn`,
  // 2 weicher Schneehügel mit verdecktem Fuß.
  `nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnhhhnnnnnnnn
   nnnnhhhhhnnnnnnn
   nnnnnssssSnnnnnn
   nnnnnnnSSnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnhhnnn
   nnnnnnnnnnnnssnn
   nnnnnnnnnnnnnnnn`,
  // 3 selten: Halmspitzen stechen durch den Schnee.
  `nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnhhhnnnn
   nnnnnnnnnnnssnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnngnnnnnnnnnnnn
   nnngngnnnnnnnnnn
   nnsgsgsnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn
   nnnnnnnnnnnnnnnn`,
]);

export default blobTileset({
  id: 'tileset_schnee',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_WEICH,
  varianten: VARIANTEN,
  ruhig: [0, 1],
  basis: 'eis.3',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['eis.1', 'eis.2'], n: ['eis.4'], w: ['eis.2'], o: ['eis.2'] },
    breiter: {
      s: [0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
      n: [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0],
    },
  }),
});
