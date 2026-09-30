/**
 * Schneidertisch (M6-12; Station `schneidertisch`, src/content/stations.ts; MASTERPROMPT §15.2): `obj_schneidertisch`
 * und `icon_schneidertisch`. Stellfläche 2×1 (Zelle 32×29, Anker = Mitte der Vorderkante, Zeile 27).
 *
 * Breiter Holztisch (Plattenfugen, helle Vorderkante, Zarge mit Schatten, vier Beine) mit dem, was hier genäht wird:
 * links ein Stück Fasergewebe (Schachbrett in `sand`), daneben zugeschnittenes Leder mit Stichen, hinten rechts eine
 * Garnrolle mit rotem Faden; auf dem Gewebe liegt die Schere. `arbeitet` (6 fps): die Schere schneidet (geschlossen,
 * offen); `aus`: sie liegt geschlossen.
 */
import { icon } from "../icons/_icon";
import { station } from "./_stationen";

const ZU = `................................
  ................................
  ................................
  ................................
  .........................kkkkk..
  .....54k.................kccck..
  ...kkk54kkkkkkk..........kMMMk..
  ...kDCk54kDCDCk..........kMMMk..
  ...kCDCk54kDCDkkkkkkkkkk.kMMMk..
  kkkkDCDCk54kDCkktttttttkkkMMMkkk
  keekCDCDCk54kDkkssssssskekccckek
  kddkDCDCDCkCDCkkCsCsCsCkdkkkkkdk
  kcckDDDDDDDDDDkkssssssskccccccck
  kddkkkkkkkkkkkkkssssssskdddddddk
  kddddddddddddddkkkkkkkkkdddddddk
  kcccccccccccccccccccccccccccccck
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  kcccccccccbccccccccccbccccccccck
  kcccccccccbccccccccccbccccccccck
  kbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbk
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kkkk....................kkkk..
  ................................`;

const OFFEN = `................................
  ................................
  ................................
  ................................
  ......5.....4............kkkkk..
  ......k5...4k............kccck..
  ...kkkkk5k4kkkk..........kMMMk..
  ...kDCDCk4kCDCk..........kMMMk..
  ...kCDCD4k5DCDkkkkkkkkkk.kMMMk..
  kkkkDCDCkkkCDCkktttttttkkkMMMkkk
  keekCDCDkkkDCDkkssssssskekccckek
  kddkDCDCkkkCDCkkCsCsCsCkdkkkkkdk
  kcckDDDDDDDDDDkkssssssskccccccck
  kddkkkkkkkkkkkkkssssssskdddddddk
  kddddddddddddddkkkkkkkkkdddddddk
  kcccccccccccccccccccccccccccccck
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  kcccccccccbccccccccccbccccccccck
  kcccccccccbccccccccccbccccccccck
  kbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbk
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kkkk....................kkkk..
  ................................`;

export default [
  station({
    item: "schneidertisch",
    size: [32, 29],
    anchor: [16, 27],
    hoehe: "block",
    frames: [ZU, OFFEN],
    clips: {
      aus: { frames: [0], fps: 1, loop: true },
      arbeitet: { frames: [0, 1], fps: 6, loop: true },
    },
    sockets: { arbeit: [[10, 10]] },
    hitbox: [0, 4, 32, 24],
    occluder: { kind: "rect", x: 1, y: 16, w: 30, h: 11 },
  }),
  icon(
    "schneidertisch",
    `................
     ................
     ..........kk....
     ....kkkk.k55k...
     ...kDCDCkk54k...
     ..kCDCDCDkk4k...
     .kkkkkkkkkkkkkk.
     .keddeddeddeddk.
     .kcccccccccccck.
     .kkkkkkkkkkkkkk.
     ..kbk......kbk..
     ..kbk......kbk..
     ..kbk......kbk..
     ..kkk......kkk..
     ................
     ................`,
  ),
];
