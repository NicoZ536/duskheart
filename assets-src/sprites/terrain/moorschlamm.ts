/**
 * Tileset Moorschlamm (M2-17, docs/ART.md §3/§5, docs/WORLD.md §7): nasser, tief liegender Schlamm des
 * Nebelmoors in `erde` und `gras` (die Biomzeile tönt ihn nebelgrau-petrol). Vollfeld: Grundton
 * `erde.1`, nasse Mulden `erde.0` mit stehendem Moorwasser `gras.0` (Materialflag `nass` – glänzt unter
 * Licht), trockene Buckel `erde.2` an der Oberseite der Mulden (Himmelsöffnung), Algenfäden `gras.1`.
 * Liegt fast immer unten (über Meeresgrund, Lava und Eis): Front `erde.0`, helle Oberkante `erde.2`.
 * Kantenstücke: `GEOMETRIE_WEICH`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_WEICH, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { m: 'erde.1', M: 'erde.0', r: 'erde.2', p: 'gras.0', a: 'gras.1', b: 'gras.2' } as const;

const VARIANTEN = varianten('moorschlamm', LEGENDE, [
  // 0 ruhig: ein flacher Buckel.
  `mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmrrmmm
   mmmmmmmmmmrrrrmm
   mmmmmmmmmmmMMmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm`,
  // 1 kleine nasse Mulde mit Algenfaden.
  `mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmrrrmmmmmmmm
   mmmmrrMMMmmmmmmm
   mmmmMppaMMmmmmmm
   mmmmmMMaMmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm`,
  // 2 großer Moortümpel mit Algenrand.
  `mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmrrrrrmmmmmm
   mmmmrMMMMMrrmmmm
   mmmMMppppMMMmmmm
   mmmMppbbppMMmmmm
   mmmMMppppppMmmmm
   mmmmMMMMpMMMmmmm
   mmmmmmMMMMmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm`,
  // 3 selten: Blasen im Schlamm (Ringe `erde.2` um nasse Kerne).
  `mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmrrmmmmmmmm
   mmmmmrppMmmmmmmm
   mmmmmrppMmmmmmmm
   mmmmmmMMmmmmmmmm
   mmmmmmmmmmrrmmmm
   mmmmmmmmmrppMmmm
   mmmmmmmmmmMMmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmrrmmmmmmmmmmm
   mmmMMMmmmmmmmmmm
   mmmmmmmmmmmmmmmm
   mmmmmmmmmmmmmmmm`,
]);

export default blobTileset({
  id: 'tileset_moorschlamm',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_WEICH,
  varianten: VARIANTEN,
  ruhig: [0, 1],
  basis: 'erde.1',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['erde.0', 'erde.0'], n: ['erde.2'], w: ['erde.0'], o: ['erde.0'] },
    breiter: { n: [0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0] },
  }),
  material: { nass: ['gras.0', 'erde.0'] },
});
