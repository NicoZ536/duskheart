/**
 * Grasbett als platziertes Welt-Objekt (docs/SPIEL.md §6 `grasbett`, MASTERPROMPT §11.5, M3-16, M3-24):
 * eine Matratze aus getrocknetem Gras zwischen zwei Ästen, oben eine gebundene Strohrolle als Kissen.
 * Längs laufende Halmzüge (nie im Raster), vereinzelt noch grüne Halme, seitlich stehen Halme heraus;
 * unten die Dicke der Matratze. 24×32, Kopf oben: die Figur liegt mit dem Kopf auf dem Kissen (Sockel
 * `kopf`), Sockel `liegen` = Körpermitte.
 *
 * Seit M4-34 ist das Grasbett ein Bauteil der Art `moebel` (src/content/buildParts.ts `EARLY_PLACEABLES`); die
 * Spielansicht zeichnet Möbel als `obj_<id>` (`buildPartSpriteId`, docs/SPIEL.md §8), deshalb heißt das Sprite
 * `obj_grasbett` (M4-41; tests/unit/assets/platzierbar.test.ts vergleicht mit `buildPartSpriteId`). Es bleibt im
 * Kontaktbogen `platzierbar` neben Lagerfeuer, Werkbank und Grab.
 */
import { sprite } from '../../lib/sprite';

export default sprite({
  id: 'obj_grasbett',
  group: 'platzierbar',
  size: [24, 32],
  anchor: [12, 29],
  hoehe: 'kugel',
  legende: {
    '.': null,
    k: 'nacht.1',
    A: 'sand.0',
    B: 'sand.1',
    C: 'sand.2',
    D: 'sand.3',
    E: 'sand.4',
    h: 'gras.2',
    i: 'gras.3',
    b: 'holz.1',
    c: 'holz.2',
    d: 'holz.3',
  },
  frames: [
    `........................
     ........................
     .......kkkkkkkkkk.......
     ..kk..kDkkkkkkkkDk..kk..
     .kdb.kkkDbDDDDbDkkk.dbk.
     .kdbkCkEEbEEEEbEEkCkdbk.
     .kdbkCkDDbDDDDbDDkCkdbk.
     .kdbkCkDDbDDDDbDDkCkdbk.
     .kdbkCkkCbCCCCbCkkCkdbk.
     .kdbDCDDkkkkkkkkDDCkdck.
     .kdbkCDDDDDDCDDDDDCkdbk.
     .kdbkCDEDDDDCDDDiDCkdbk.
     .kcbkCDEDDDDDEDDhDCkdbk.
     .kdbkCDEDDEDDEDDDDCkdbk.
     .kdbkCiEDCEDDEDDEDCkdbk.
     .kdbkChDECEDDEDDEDCDdbk.
     .kdbkCDCDCDEDDCDEDCkdbk.
     .kdbkCDCDDDDEDCDDECkdbk.
     .kdbkCDDEDDDEDCDDDCkdbk.
     .kdckCDDEDiDEDDDDCCkdbk.
     .kdbDCDDEDhDEDDEDCCkdbk.
     .kdbkCEDDECDDEDEDCCkdbk.
     .kdbkCEDDDCDDDDEDiCkcbk.
     .kdbkCEDDDCDDDDDDhCDdbk.
     .kdbkCDDDDDDDDDDDDCkdbk.
     .kdbkCCCCCCCCCCCCCCkdbk.
     .kdb.BBBBBBBBBBBBBB.dbk.
     .kdb..AAAAAAAAAAAA..dbk.
     .kdb...kkkkkkkkkk...dbk.
     ..kk................kk..
     ........................
     ........................`,
  ],
  sockets: { kopf: [[12, 6]], liegen: [[12, 16]] },
  hitbox: [1, 2, 22, 27],
  occluder: { kind: 'none' },
  schatten: 'none',
});
