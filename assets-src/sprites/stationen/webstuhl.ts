/**
 * Webstuhl (M6-12; Station `webstuhl`, src/content/stations.ts; MASTERPROMPT §15.2): `obj_webstuhl` und `icon_webstuhl`.
 * Stellfläche 2×1 (Zelle 32×36, Anker = Mitte der Vorderkante, Zeile 34).
 *
 * Aufrechter Rahmenwebstuhl: zwei Pfosten (Licht links, Schatten rechts) unter einem Querbalken, dazwischen die
 * Kettfäden, der Litzenstab, die Lade und darunter das fertige Gewebe (Kette und Schuss im Schachbrett) bis zum
 * Brustbaum; unten der Warenbaum mit aufgerolltem Tuch und zwei Tritte. Holz `holz`, Faser `sand` wie das Fasergewebe.
 * `arbeitet` (8 fps): das Schiffchen fährt durch das Fach (links, Mitte, rechts, Mitte), die Lade schlägt den Schuss
 * an; `aus`: das Schiffchen ruht links.
 */
import { icon } from "../icons/_icon";
import { station } from "./_stationen";

const LINKS = `................................
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  keeeeeeeeeeeeeeeeeeeeeeeeeeeeeek
  kddddddddddddddddddddddddddddddk
  kcccccccccccccccccccccccccccccck
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  ..keckEDEDEDEDEDEDEDEDEDEDkeck..
  ..keckE.E.E.E.E.E.E.E.E.E.keck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckbbcbbbcbbbcbbbcbbbcbkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckkkkkk.E.E.E.E.E.E.E.keck..
  ..keckkdedkDEDEDEDEDEDEDEDkeck..
  ..keckkkkkk.E.E.E.E.E.E.E.keck..
  ..keckddddddddddddddddddddkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckCDCDCDCDCDCDCDCDCDCDkeck..
  ..keckDCDCDCDCDCDCDCDCDCDCkeck..
  ..keckCDCDCDCDCDCDCDCDCDCDkeck..
  ..keckDCDCDCDCDCDCDCDCDCDCkeck..
  ..keckCDCDCDCDCDCDCDCDCDCDkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckddddddddddddddddddddkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckcDDDDDDDDDDDDDDDDDDckeck..
  ..keckbCCCCCCCCCCCCCCCCCCbkeck..
  ..keckcBBBBBBBBBBBBBBBBBBckeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keck...kkkkkk..kkkkkk...keck..
  ..keck...kcccck..kcccck...keck..
  ..keck...kkkkkk..kkkkkk...keck..
  kkkkkkkk................kkkkkkkk
  kddddddk................kddddddk
  kkkkkkkk................kkkkkkkk
  ................................`;

const MITTE = `................................
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  keeeeeeeeeeeeeeeeeeeeeeeeeeeeeek
  kddddddddddddddddddddddddddddddk
  kcccccccccccccccccccccccccccccck
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  ..keckEDEDEDEDEDEDEDEDEDEDkeck..
  ..keckE.E.E.E.E.E.E.E.E.E.keck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckbbcbbbcbbbcbbbcbbbcbkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckE.E.E.E.kkkkk.E.E.E.keck..
  ..keckEDEDEDEDkdedkDEDEDEDkeck..
  ..keckE.E.E.E.kkkkk.E.E.E.keck..
  ..keckddddddddddddddddddddkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckCDCDCDCDCDCDCDCDCDCDkeck..
  ..keckDCDCDCDCDCDCDCDCDCDCkeck..
  ..keckCDCDCDCDCDCDCDCDCDCDkeck..
  ..keckDCDCDCDCDCDCDCDCDCDCkeck..
  ..keckCDCDCDCDCDCDCDCDCDCDkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckddddddddddddddddddddkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckcDDDDDDDDDDDDDDDDDDckeck..
  ..keckbCCCCCCCCCCCCCCCCCCbkeck..
  ..keckcBBBBBBBBBBBBBBBBBBckeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keck...kkkkkk..kkkkkk...keck..
  ..keck...kcccck..kcccck...keck..
  ..keck...kkkkkk..kkkkkk...keck..
  kkkkkkkk................kkkkkkkk
  kddddddk................kddddddk
  kkkkkkkk................kkkkkkkk
  ................................`;

const RECHTS = `................................
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  keeeeeeeeeeeeeeeeeeeeeeeeeeeeeek
  kddddddddddddddddddddddddddddddk
  kcccccccccccccccccccccccccccccck
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  ..keckEDEDEDEDEDEDEDEDEDEDkeck..
  ..keckE.E.E.E.E.E.E.E.E.E.keck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckbbcbbbcbbbcbbbcbbbcbkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckE.E.E.E.E.E.E.Ekkkkkkeck..
  ..keckEDEDEDEDEDEDEDEkdedkkeck..
  ..keckE.E.E.E.E.E.E.Ekkkkkkeck..
  ..keckE.E.E.E.E.E.E.E.E.E.keck..
  ..keckddddddddddddddddddddkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckDCDCDCDCDCDCDCDCDCDCkeck..
  ..keckCDCDCDCDCDCDCDCDCDCDkeck..
  ..keckDCDCDCDCDCDCDCDCDCDCkeck..
  ..keckCDCDCDCDCDCDCDCDCDCDkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckddddddddddddddddddddkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keckcDDDDDDDDDDDDDDDDDDckeck..
  ..keckbCCCCCCCCCCCCCCCCCCbkeck..
  ..keckcBBBBBBBBBBBBBBBBBBckeck..
  ..keckkkkkkkkkkkkkkkkkkkkkkeck..
  ..keck...kkkkkk..kkkkkk...keck..
  ..keck...kcccck..kcccck...keck..
  ..keck...kkkkkk..kkkkkk...keck..
  kkkkkkkk................kkkkkkkk
  kddddddk................kddddddk
  kkkkkkkk................kkkkkkkk
  ................................`;

export default [
  station({
    item: "webstuhl",
    size: [32, 36],
    anchor: [16, 34],
    hoehe: "block",
    frames: [LINKS, MITTE, RECHTS],
    clips: {
      aus: { frames: [0], fps: 1, loop: true },
      arbeitet: { frames: [0, 1, 2, 1], fps: 8, loop: true },
    },
    sockets: { arbeit: [[16, 16]] },
    hitbox: [0, 1, 32, 34],
    occluder: { kind: "rect", x: 2, y: 20, w: 28, h: 14 },
  }),
  icon(
    "webstuhl",
    `................
     .kkkkkkkkkkkkkk.
     .kecdddddddddck.
     .kkkkkkkkkkkkkk.
     .kekEDEDEDEDkek.
     .kckEDEDEDEDkck.
     .kekkkkkkkkkkek.
     .kckCDCDCDCDkck.
     .kekDCDCDCDCkek.
     .kckCDCDCDCDkck.
     .kekkkkkkkkkkek.
     .kckCCCCCCCCkck.
     .kekBBBBBBBBkek.
     .kckkkkkkkkkkck.
     .kkk........kkk.
     ................`,
  ),
];
