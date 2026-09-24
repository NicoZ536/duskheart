/**
 * Tileset Höhlenboden (M2-18, docs/ART.md §5, docs/WORLD.md §7): Felsboden des Untergrunds in `stein`
 * (die Biomzeilen Wurzelhöhlen, Tiefgrund und Glutadern tönen ihn erdig, blaugrau bzw. glutrot).
 * Vollfeld: Grundton `stein.2` mit großen Ruheflächen, flache Platten mit heller Oberseite `stein.3`,
 * Risse `stein.1` mit tiefem Kern `stein.0`, Geröll (Kuppe `stein.4`, Fuß `stein.1`); selten eine Sickerpfütze
 * (`wasser`, Materialflag `nass`). Rand über Wasser, Lava und Schlamm: Front `stein.0`/`stein.1`,
 * Oberkante `stein.3`. Kantenstücke: `GEOMETRIE_SCHOLLE`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_SCHOLLE, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { s: 'stein.2', S: 'stein.3', p: 'stein.4', d: 'stein.1', D: 'stein.0', w: 'wasser.1', W: 'wasser.2' } as const;

const VARIANTEN = varianten('hoehlenboden', LEGENDE, [
  // 0 ruhig: eine feine Kerbe `stein.1`.
  `ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   sssssssssddsssss
   ssssssssssddssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss`,
  // 1 Geröll: ein Stein mit Fuß.
  `ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   sssssssssssppsss
   ssssssssssppSSss
   sssssssssdddddss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss`,
  // 2 flache Platte: helle Oberkante, verdeckte Unterkante, Randriss.
  `ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssSSSSSsssssss
   sssSSsssssSdssss
   ssssssssssssdsss
   sssssddddddddsss
   ssssssssssssssss
   sssssssssssssdss
   sssssssssssdDDss
   sssssssssssddsss
   ssssssssssssssss
   ssssssssssssssss`,
  // 3 selten: Sickerpfütze.
  `ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   sssssssddddsssss
   ssssssdwwWWdssss
   sssssdwwwwWdssss
   ssssssddwwddssss
   ssssssssddssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss`,
]);

export default blobTileset({
  id: 'tileset_hoehlenboden',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_SCHOLLE,
  varianten: VARIANTEN,
  ruhig: [0, 1],
  basis: 'stein.2',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['stein.0', 'stein.1'], n: ['stein.3'], w: ['stein.1'], o: ['stein.1'] },
    breiter: { s: [0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0] },
  }),
  material: { nass: ['wasser.1', 'wasser.2'] },
});
