/**
 * Sitzmöbel T0–T1 (M4-19; docs/SPIEL.md §8): Hocker, Stuhl, Bank, Schaukelstuhl, Truhenbank, Gartenbank.
 * Alle blicken nach Süden (zur Kamera): Lehne oben, Sitzfläche von oben, Vorderkante und Vorderbeine
 * voll. Sockel `sitzen` (bzw. `sitzen_1`/`sitzen_2` auf Bänken) = Sitzpunkt der Figur auf der Sitzfläche.
 */
import { moebel } from './_moebel';

/** Hocker: runde Sitzscheibe mit Maserung, gespreizte Beine. 1×1. */
const hocker = moebel({
  item: 'hocker_holz',
  size: [16, 16],
  anchor: [8, 14],
  hoehe: 'zylinder',
  frames: [
    `................
     ................
     ................
     ................
     .....kkkkkk.....
     ....keeeeeek....
     ...keddddddek...
     ...kddcccdddk...
     ...kcdddddcck...
     ....kbbbbbbk....
     ....kakkkkak....
     ...kdbk..kdbk...
     ...kdbk..kdbk...
     ..kdbk....kdbk..
     ..kkkk....kkkk..
     ................`,
  ],
  sockets: { sitzen: [[8, 7]] },
  hitbox: [2, 4, 12, 11],
  occluder: { kind: 'ellipse', x: 8, y: 13, rx: 4, ry: 2 },
  spiegelbar: true,
});

/** Stuhl mit Sprossenlehne: zwei Pfosten, zwei Querriegel mit Durchblick, Sitz, Vorderbeine mit Strebe. 1×1. */
const stuhl = moebel({
  item: 'stuhl_holz',
  size: [16, 22],
  anchor: [8, 20],
  hoehe: 'block',
  frames: [
    `................
     ..kkk......kkk..
     ..kekkkkkkkkek..
     ..kdeeeeeeeedk..
     ..kdddccddddek..
     ..kdkkkkkkkkdk..
     ..kdk......kdk..
     ..kdkkkkkkkkdk..
     ..kdeeeeeeeedk..
     ..kbbbbbbbbbbk..
     ..kddeeeeeeddk..
     ..kdddcccddddk..
     ..kddddddcccdk..
     ..kbbbbbbbbbbk..
     ..kakkkkkkkkak..
     ..kdbk....kdbk..
     ..kdbkkkkkkdbk..
     ..kdbkcccckdbk..
     ..kdbkkkkkkdbk..
     ..kdbk....kdbk..
     ..kkkk....kkkk..
     ................`,
  ],
  sockets: { sitzen: [[8, 11]] },
  hitbox: [2, 1, 12, 20],
  occluder: { kind: 'rect', x: 3, y: 14, w: 10, h: 6 },
  spiegelbar: true,
});

/** Bank: dicke Sitzbohle ohne Lehne auf vier gespreizten Beinen. 2×1. */
const bank = moebel({
  item: 'bank_holz',
  size: [32, 16],
  anchor: [16, 14],
  hoehe: 'block',
  frames: [
    `................................
     ................................
     ................................
     ................................
     ..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..
     .keeeeeeeeeeeeeeeeeeeeeeeeeeeek.
     .kddddddcccdddddddddddcccddddek.
     .kdddcccdddddddddccccdddddddddk.
     .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
     .kkaakkkkkkkkkkkkkkkkkkkkkkaakk.
     ..kdbk..................kdbk....
     ..kdbk..................kdbk....
     .kdbk....................kdbk...
     .kdbk....................kdbk...
     .kkkk....................kkkk...
     ................................`,
  ],
  sockets: { sitzen_1: [[10, 6]], sitzen_2: [[22, 6]] },
  hitbox: [1, 4, 30, 11],
  occluder: { kind: 'rect', x: 2, y: 10, w: 28, h: 4 },
});

/** Gartenbank: Lattensitz und Lattenlehne auf zwei gemauerten Steinwangen. 2×1. */
const gartenbank = moebel({
  item: 'gartenbank',
  size: [32, 24],
  anchor: [16, 22],
  hoehe: 'block',
  frames: [
    `................................
     ...kkkkkkkkkkkkkkkkkkkkkkkkkk...
     ...keeeeeeeeeeeeeeeeeeeeeeeek...
     ...kbbbbbbbbbbbbbbbbbbbbbbbbk...
     ...kddddddddddddddddddddddddk...
     ...kbbbbbbbbbbbbbbbbbbbbbbbbk...
     ...kkkdkkkkkkkkkkkkkkkkkkdkkk...
     .....kdk................kdk.....
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     .k5555keeeeeeeeeeeeeeeeeek5555k.
     .k4444kbbbbbbbbbbbbbbbbbbk4444k.
     .k4444keeeeeeeeeeeeeeeeeek4444k.
     .k3443kbbbbbbbbbbbbbbbbbbk3443k.
     .k4444kddddddddddddddddddk4444k.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     .k5554k..................k5545k.
     .k4433k..................k3344k.
     .k3444k..................k4443k.
     .kkkkkk..................kkkkkk.
     .k5545k..................k5455k.
     .k4344k..................k4434k.
     .k3333k..................k3333k.
     .kkkkkk..................kkkkkk.
     ................................`,
  ],
  sockets: { sitzen_1: [[11, 11]], sitzen_2: [[21, 11]] },
  hitbox: [1, 1, 30, 22],
  occluder: { kind: 'rect', x: 1, y: 14, w: 30, h: 8 },
  spiegelbar: true,
});

/** Schaukelstuhl: hohe Lehne mit Kopfbrett, Armlehnen, Kufen mit eingerollten Spitzen. 1×1. */
const schaukelstuhl = moebel({
  item: 'schaukelstuhl',
  size: [16, 24],
  anchor: [8, 22],
  hoehe: 'block',
  frames: [
    `................
     .kkk............
     .kedk...........
     .kdck...........
     ..kdck..........
     ..kdck..........
     ..kdck..........
     ..kdck..........
     ..kdck..........
     ...kdckkkkkkkk..
     ...kdceeeeeeedk.
     ...kdckkkkkkkdk.
     ...kdck.....kbk.
     ...kdeeeeeeeeek.
     ...kddddcccdddk.
     ...kbbbbbbbbbbk.
     ....kakkkkkkak..
     ....kbk....kbk..
     .kk.kbk....kbk.k
     kdek.kbk..kbk.ke
     .kddkkbkkkkbkkdk
     ..kkddddddddddk.
     ....kkkkkkkkkk..
     ................`,
  ],
  sockets: { sitzen: [[9, 13]] },
  hitbox: [0, 1, 16, 22],
  occluder: { kind: 'rect', x: 2, y: 17, w: 12, h: 5 },
  spiegelbar: true,
});

/**
 * Truhenbank: Kastenbank mit Sitzdeckel und Lehne, vorn zwei Füllungen und ein Bronzeschloss
 * (Metallflag). 2×1.
 */
const truhenbank = moebel({
  item: 'truhenbank',
  size: [32, 25],
  anchor: [16, 23],
  hoehe: 'block',
  metall: true,
  frames: [
    `................................
     ..kkk......................kkk..
     ..kekkkkkkkkkkkkkkkkkkkkkkkkek..
     ..kdeeeeeeeeeeeeeeeeeeeeeeeedk..
     ..kdcddddddcddddddddcdddddddck..
     ..kdcddddddcddddddddcdddddddck..
     ..kdcddddddcddddddddcdddddddck..
     ..kdbbbbbbbbbbbbbbbbbbbbbbbbbk..
     ..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..
     .keeeeeeeeeeeeeeeeeeeeeeeeeeeek.
     .kdddddcccddddddddddcccdddddddk.
     .kddddddddddddcccdddddddddddddk.
     .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkkQQkkkkkkkkkkkkkk.
     .kdkcccccccccckTTkcccccccccckdk.
     .kdkcdddddddddkWWkcdddddddddkdk.
     .kdkcdddddddddkkkkcdddddddddkdk.
     .kdkcdddddddddkddkcdddddddddkdk.
     .kdkbbbbbbbbbbkddkbbbbbbbbbbkdk.
     .kdkkkkkkkkkkkkkkkkkkkkkkkkkkdk.
     .kbccccccccccccccccccccccccccbk.
     .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
     .kabk......................kbak.
     .kkkk......................kkkk.
     ................................`,
  ],
  sockets: { sitzen_1: [[11, 10]], sitzen_2: [[21, 10]] },
  hitbox: [1, 1, 30, 23],
  occluder: { kind: 'rect', x: 1, y: 13, w: 30, h: 10 },
});

/** Sitzkissen: prall gestopftes Kissen aus rotem Garn (Varianten über `STOFF_VARIANTEN`) mit geknöpfter Mitte. Begehbar. 1×1. */
const sitzkissen = moebel({
  item: 'sitzkissen',
  size: [16, 16],
  anchor: [8, 13],
  hoehe: 'kugel',
  frames: [
    `................
     ................
     ................
     ................
     ...kkkkkkkkkk...
     ..kMooMMMMooMk..
     .kMMMMMMMMMMMMk.
     .kmMMMMkkMMMMmk.
     .kmMMMkLLkMMMmk.
     .kmmMMMkkMMMmmk.
     .kmmmMMMMMMmmmk.
     .klmmmmmmmmmmlk.
     ..kllllllllllk..
     ...kkkkkkkkkk...
     ................
     ................`,
  ],
  sockets: { sitzen: [[8, 8]] },
  occluder: { kind: 'none' },
  spiegelbar: true,
});

export default [hocker, stuhl, bank, gartenbank, schaukelstuhl, truhenbank, sitzkissen];
