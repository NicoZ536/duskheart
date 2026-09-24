/**
 * Tileset Eis (M2-18, docs/ART.md §3/§5, docs/WORLD.md §7): gefrorene Seen und Gletscherflächen in
 * `eis` (ungetönt). Kein gemaltes Glanzlicht – der Glanz kommt über das Materialflag `eis` aus dem
 * Licht (§4.5). Vollfeld: Grundton `eis.2` mit großen Ruheflächen, ein feiner Sprung `eis.1`,
 * eine eingeschlossene Luftblase (Ring `eis.3`) über einer Tiefenstelle; selten ein langer Sprung mit dunklem Kern `eis.0`.
 * Liegt unter Schnee, Torf und Erde; über Wasser und Schlamm zeigt es seine Dicke als Front `eis.0`
 * und eine helle Oberkante `eis.4`. Kantenstücke: `GEOMETRIE_WEICH`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_WEICH, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { i: 'eis.2', I: 'eis.1', c: 'eis.0', h: 'eis.3', H: 'eis.4' } as const;

const VARIANTEN = varianten('eis', LEGENDE, [
  // 0 ruhig: nur eine feine Kerbe `eis.1`.
  `iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiIIiiiiiiii
   iiiiiiiIIiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii`,
  // 1 feiner Sprung, schräg in Stufen.
  `iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiIIiiiiiiiii
   iiiiiiIIIiiiiiii
   iiiiiiiiIIiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii`,
  // 2 eingeschlossene Luftblase (Ring `eis.3`), darunter eine Tiefenstelle.
  `iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiihhiii
   iiiiiiiiiihIhhii
   iiiiiiiiiiihhiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiIIIiiiiiiiiii
   iiIIIIIIiiiiiiii
   iiiIIIIIiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii`,
  // 3 selten: langer Sprung mit dunklem Kern `eis.0`.
  `iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiIIiiiiiiiiiiii
   iiiIccIiiiiiiiii
   iiiiIIccIiiiiiii
   iiiiiiIIcIiiiiii
   iiiiiiiiIccIiiii
   iiiiiiiiiIIcIiii
   iiiiiiiiiiiIcIii
   iiiiiiiiiiiiIIii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiIIiiiiiiiii
   iiiiiiIIIiiiiiii
   iiiiiiiiiiiiiiii
   iiiiiiiiiiiiiiii`,
]);

export default blobTileset({
  id: 'tileset_eis',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_WEICH,
  varianten: VARIANTEN,
  ruhig: [0, 1, 2],
  basis: 'eis.2',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['eis.0', 'eis.1'], n: ['eis.4'], w: ['eis.1'], o: ['eis.1'] },
    breiter: { s: [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0] },
  }),
  material: { eis: ['eis.0', 'eis.1', 'eis.2', 'eis.3', 'eis.4'] },
});
