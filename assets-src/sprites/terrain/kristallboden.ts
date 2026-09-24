/**
 * Tileset Kristallboden (M2-18, docs/ART.md §5, docs/WORLD.md §7): gläserner Grund des Scherbenhains,
 * direkt in `eis`/`wasser`/`verderb` gezeichnet (ungetönt). Die Wiese des Scherbenhains ist türkis
 * (`gras.3` → `wasser.3`); der Kristallboden hebt sich davon als blasses Kristallblau ab: Grundton
 * `eis.1`, Plattenfugen `eis.0`, Plattenoberseiten `eis.2` (sehen den Himmel), Prismenviolett `verderb.3`
 * als seltener Farbsaum, kleine Scherben mit leuchtender Kante `wasser.5*` (Kristallkanten sind echte
 * Lichtquellen, §9 Emissiv). Materialflag `eis` für den Glanz. Liegt über der Wiese: kantige
 * Bruchkanten, Front `wasser.2`/`eis.0`, helle Oberkante `eis.3`. Kantenstücke: `GEOMETRIE_KANTIG`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_KANTIG, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { k: 'eis.1', K: 'eis.2', d: 'eis.0', D: 'wasser.2', h: 'eis.3', v: 'verderb.3', s: 'wasser.5*' } as const;

const VARIANTEN = varianten('kristallboden', LEGENDE, [
  // 0 ruhig: eine Plattenfuge mit Abzweig.
  `kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkKKkkkkkk
   kkkkKKKKKKKdkkkk
   kkkkkkkkkkdkkkkk
   kkkkkkkkkdkkkkkk
   kkkkkkkkkdkkkkkk
   kkkkkkkkkkddkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk`,
  // 1 Scherbenbüschel: drei kleine Kristalle mit leuchtender Kante.
  `kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkskkkkkkkk
   kkkkkksKkksKkkkk
   kkkkkssKkksKkkkk
   kkkkkKhKhkKhkkkk
   kkkkkKhKDkKhDkkk
   kkkkkkDDDkkDDkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk`,
  // 2 Platten mit Prismensaum.
  `kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkKKKKdkkkkkkkk
   kkkKKKKdkkkkkkkk
   kkkvvddkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkKKKKdk
   kkkkkkkkkKKKKKdk
   kkkkkkkkkvvvddkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk`,
  // 3 selten: großer Kristall mit Prismenkante.
  `kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkssskkkkkk
   kkkkkkssKhskkkkk
   kkkkkksKKhhskkkk
   kkkkkkKKKhhhkkkk
   kkkkkkKKKhhhkkkk
   kkkkkkdKKhhvkkkk
   kkkkkkddKhvvkkkk
   kkkkkkkDDDDkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk
   kkkkkkkkkkkkkkkk`,
]);

export default blobTileset({
  id: 'tileset_kristallboden',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_KANTIG,
  varianten: VARIANTEN,
  ruhig: [0, 2],
  basis: 'eis.1',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['wasser.2', 'eis.0'], n: ['eis.3'], w: ['eis.0'], o: ['eis.0'] },
  }),
  material: { eis: ['eis.1', 'eis.2', 'eis.3', 'wasser.5', 'verderb.3'] },
});
