/**
 * Tileset Sand (M2-17, docs/ART.md §3/§5, docs/WORLD.md §7): Strand und Düne, direkt in Sandtönen
 * gezeichnet (keine Biom-Tönung). Vollfeld: Grundton `sand.3`, kurze Rippelstücke (Kamm `sand.4`
 * über Tal `sand.2`) in verschiedener Länge und Lage, dazu ein Sandsteinkiesel (Kuppe `sand.4`, Fuß
 * `sand.1`) und selten eine Herzmuschel.
 * Rand über Wasser, Eis, Pflaster und Schlamm: Front `sand.1`/`sand.2` (nasser Strandsaum über dem
 * Meeresgrund), helle Oberkante `sand.4`, Seiten `sand.2`. Kantenstücke: `GEOMETRIE_WEICH`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_WEICH, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { s: 'sand.3', d: 'sand.2', h: 'sand.4', D: 'sand.1' } as const;

const VARIANTEN = varianten('sand', LEGENDE, [
  // 0 ruhig: zwei kurze Rippel weit auseinander.
  `ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssshhhssssssssss
   ssddddhhhsssssss
   sssssssdddssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   sssssssssshhssss
   ssssssssshddhhss
   ssssssssssssddss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss`,
  // 1 Rippelfeld oben: zwei versetzte Rippelzüge verschiedener Länge.
  `ssssssssssssssss
   sssssssssshhhsss
   ssssshhhhhdddhss
   sssshdddddsssdds
   ssssssssssssssss
   sssssssshhhsssss
   sshhhhhhdddhhsss
   sdddddddsssddsss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   sssssshhssssssss
   sssssdddhsssssss
   ssssssssssssssss`,
  // 2 Sandsteinkiesel oben rechts (Kontakt `sand.1`), Rippel unten.
  `ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssshhsss
   sssssssssshhhdss
   sssssssssDdddDss
   ssssssssssDDDsss
   ssssssssssssssss
   ssssssssssssssss
   sssshhhhssssssss
   sshhddddhhssssss
   sddsssssddhhhsss
   ssssssssssdddsss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss`,
  // 3 selten: Herzmuschel (Rippen `sand.1`) und ein Rippelpaar.
  `ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssshhhhsssss
   sssssshDhDhhssss
   sssssshDhDhDssss
   ssssssddddddssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   ssssssssssssssss
   sssssssssshhhsss
   sssssssshhdddsss
   ssssssssddssssss
   ssssssssssssssss
   ssssssssssssssss`,
]);

export default blobTileset({
  id: 'tileset_sand',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_WEICH,
  varianten: VARIANTEN,
  ruhig: [0, 1, 2],
  basis: 'sand.3',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['sand.1', 'sand.2'], n: ['sand.4'], w: ['sand.2'], o: ['sand.2'] },
    breiter: {
      s: [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0],
      n: [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    },
  }),
});
