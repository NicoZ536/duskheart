/**
 * Tische T0–T1 (M4-19; docs/SPIEL.md §8 `tisch_holz`, `schreibpult`). Platten aus Bohlen mit gewellten
 * Fugen (wie die Werkbank), Vorderkante und Zarge, Vorderbeine voll, Hinterbeine kürzer dazwischen.
 * Sockel `ablage` = Mitte der Platte (Lampe, Vase, Tischdecke stehen dort).
 */
import { moebel, ueberlagere } from './_moebel';

/** Holztisch (auch Grundbild des gedeckten Tischs). */
const TISCH = `................................
     ................................
     ..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..
     .keeeeeeeeeeeeeeeeeeeeeeeeeeeek.
     .kddddddccccdddddddddddddcddddk.
     .kdddddddddddddddcccddddddddddk.
     .kccccccccbccccccccccccccbcccck.
     .kddddcddddddddddddddcccddddddk.
     .kdddddddddddcccddddddddddddddk.
     .kcccccbcccccccccccccbcccccccck.
     .kddddddddddddcddddddddddcccddk.
     .kdcccddddddddddddddddddddddddk.
     .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     ..kdbkcccccccccccccccccccckbdk..
     ..kdbkbbbbbbbbbbbbbbbbbbbbkbdk..
     ..kdbkkkkkkkkkkkkkkkkkkkkkkbdk..
     ..kdbk.kbk............kbk.kbdk..
     ..kdbk.kbk............kbk.kbdk..
     ..kdbk.kkk............kkk.kbdk..
     ..kdbk....................kbdk..
     ..kdbk....................kbdk..
     ..kkkk....................kkkk..
     ................................`;

/**
 * Tischdecke über dem Holztisch: rot-weißes Karo aus Garn (Stofframpe `laub`), Saum und Fransen hängen
 * vorn über die Kante; `.` lässt den Tisch stehen.
 */
const TUCH = `................................
     ................................
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     .kmmllllmmmmllllmmmmllllmmmmllk.
     .kmmllllmmmmllllmmmmllllmmmmllk.
     .kmmllllmmmmllllmmmmllllmmmmllk.
     .kEEmmmmEEEEmmmmEEEEmmmmEEEEmmk.
     .kEEmmmmEEEEmmmmEEEEmmmmEEEEmmk.
     .kEEmmmmEEEEmmmmEEEEmmmmEEEEmmk.
     .kmmllllmmmmllllmmmmllllmmmmllk.
     .kmmllllmmmmllllmmmmllllmmmmllk.
     .kmmllllmmmmllllmmmmllllmmmmllk.
     .kEEEEmmmmEEEEmmmmEEEEmmmmEEEEk.
     .kEEEEmmmmEEEEmmmmEEEEmmmmEEEEk.
     .kCCCCllllCCCCllllCCCCllllCCCCk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     ................................
     ................................
     ................................
     ................................
     ................................
     ................................
     ................................
     ................................`;

/** Holztisch: drei Bohlen, Zarge, vier Beine mit Fußstrebe. 2×1. */
const tisch = moebel({
  item: 'tisch_holz',
  size: [32, 24],
  anchor: [16, 22],
  hoehe: 'block',
  frames: [
    TISCH,
  ],
  sockets: { ablage: [[16, 7]] },
  hitbox: [1, 2, 30, 21],
  occluder: { kind: 'rect', x: 2, y: 14, w: 26, h: 8 },
  spiegelbar: true,
});

/** Tisch mit Tischdecke: derselbe Holztisch, darüber das karierte Tuch. 2×1. */
const tischdecke = moebel({
  item: 'tischdecke',
  size: [32, 24],
  anchor: [16, 22],
  hoehe: 'block',
  frames: [ueberlagere(TISCH, TUCH)],
  sockets: { ablage: [[16, 7]] },
  hitbox: [1, 2, 30, 21],
  occluder: { kind: 'rect', x: 2, y: 14, w: 26, h: 8 },
  spiegelbar: true,
});

/**
 * Schreibpult: Platte mit einem beschriebenen Blatt, Tintenfass mit Feder, zwei Schubladen mit
 * Bronzeknäufen (Metallflag), vier Beine. 2×1.
 */
const schreibpult = moebel({
  item: 'schreibpult',
  spiegelbar: true,
  size: [32, 24],
  anchor: [16, 22],
  hoehe: 'block',
  metall: true,
  frames: [
    `................................
     ........................kk......
     .......................kEEk.....
     ......................kEEk......
     ..kkkkkkkkkkkkkkkkkkkkEDkkkkkk..
     .keeeeeeeeeeeeeeeeekkkDkkeeeeek.
     .kdddEEEEEEEEEEddddkNNNNkdddddk.
     .kdddECCCCCCCEEddddkNnnNkdddddk.
     .kdddEEEEEEEEEEddddkNNNNkdddddk.
     .kdddECCCCCEEEEddddkkkkkkdddddk.
     .kdddEEEEEEEEEEccccccccccccdddk.
     .kdcccddddddddddddddddddddddddk.
     .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     .kkcccccccccccckkcccccccccccckk.
     .kkcddddTTdddddkkcdddddTTddddkk.
     .kkcdddddddddddkkcdddddddddddkk.
     .kkbbbbbbbbbbbbkkbbbbbbbbbbbbkk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     ..kdbk....................kbdk..
     ..kdbk....................kbdk..
     ..kdbk....................kbdk..
     ..kkkk....................kkkk..
     ................................`,
  ],
  sockets: { ablage: [[10, 8]] },
  hitbox: [1, 1, 30, 22],
  occluder: { kind: 'rect', x: 2, y: 14, w: 28, h: 9 },
});

export default [tisch, tischdecke, schreibpult];
