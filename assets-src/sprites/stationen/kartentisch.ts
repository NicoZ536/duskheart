/**
 * Kartentisch (M7-18, Strang C; Station `kartentisch`, src/content/stations.ts; freigeschaltet durch den Bauplan
 * `bauplan_kartentisch`, Freischaltung `bp_kartentisch`; MASTERPROMPT §15.2 „Kartentisch“, §25 „Karte“):
 * `obj_kartentisch` und `icon_kartentisch`. Stellfläche 2×1 (Zelle 32×29, Anker = Mitte der Vorderkante, Zeile 27).
 *
 * Ein tiefer Eichentisch, auf der Platte eine ausgebreitete Karte (Pergament `sand`, Küstenlinien und Wege in Tinte
 * `wasser.2`, rote Routenpunkte `laub.1`), in der Mitte der eingelassene Erbauer-Kompass (Bronzering der Stationen, Nadel
 * rot/grau), hinten rechts ein Tintenfass. Zwölf Farben mit Kontur. `arbeitet` (4 fps): eine Feder zeichnet über die Karte; `aus`: sie steckt im Fass.
 */
import { icon } from '../icons/_icon';
import { station } from './_stationen';

const RUHE = `................................
  ................................
  ................................
  ...........................k....
  ..........................kE....
  .........................kkkk...
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  kekkkkkkkkkkkkkkkkkkkkkkkkkkkkek
  kdkEEEEEEEEEEkkkkkkEEEEEEEEEDkdk
  kdkEEyyEEEEEkTTTTTWkyyEEEEEEDkdk
  kdkEyEEyEEyEkTElDEWkEEyEEyyEDkdk
  kdkEEEEEyyEEkTElDEWkEEEyyEEEDkdk
  kdkEEEElEEElkWEDDEQklElEEEEEDkdk
  kdkEyyEEElEEkWWQQQQkEEyEyEEEDkdk
  kdkEEEyEEEEEEkkkkkkEEEEyEEEEDkdk
  kdkDDDDDDDDDDDDDDDDDDDDDDDDDDkdk
  kdkkkkkkkkkkkkkkkkkkkkkkkkkkkkdk
  kddddddddddddddddddddddddddddddk
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  kcccccccccbccccccccccbccccccccck
  kbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbk
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kkkk....................kkkk..
  ................................`;

const ZEICHNET_1 = `................................
  ................................
  ................................
  ...........................k....
  ..........................kE....
  .........................kkkk...
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  kekkkkkkkkkkkkkkkkkkkkkkkkkkkkek
  kdkEEEEEEEEEEkkkkkkEEEEEEEEEDkdk
  kdkEEyyEEEEEkTTTTTWkyyEEEEEEDkdk
  kdkEyEEyEEyEkTElDEWkEEyEEyyEDkdk
  kdkEEEEEyyEEkTElDEkEEEEyyEEEDkdk
  kdkEEEElEEElkWEDDkEklElEEEEEDkdk
  kdkEyyEEElEEkWWQkEkkEEyEyEEEDkdk
  kdkEEEyEEEEEEkkkkkkEEEEyEEEEDkdk
  kdkDDDDDDDDDDDDDDDDDDDDDDDDDDkdk
  kdkkkkkkkkkkkkkkkkkkkkkkkkkkkkdk
  kddddddddddddddddddddddddddddddk
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  kcccccccccbccccccccccbccccccccck
  kbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbk
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kkkk....................kkkk..
  ................................`;

const ZEICHNET_2 = `................................
  ................................
  ................................
  ...........................k....
  ..........................kE....
  .........................kkkk...
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  kekkkkkkkkkkkkkkkkkkkkkkkkkkkkek
  kdkEEEEEEEEEEkkkkkkEEEEEEEEEDkdk
  kdkEEyyEEEEEkTTTTTWkyykEEEEEDkdk
  kdkEyEEyEEyEkTElDEWkEkEEEyyEDkdk
  kdkEEEEEyyEEkTElDEWkkEkyyEEEDkdk
  kdkEEEElEEElkWEDDEQkEklEEEEEDkdk
  kdkEyyEEElEEkWWQQQQkkEyEyEEEDkdk
  kdkEEEyEEEEEEkkkkkkEEEEyEEEEDkdk
  kdkDDDDDDDDDDDDDDDDDDDDDDDDDDkdk
  kdkkkkkkkkkkkkkkkkkkkkkkkkkkkkdk
  kddddddddddddddddddddddddddddddk
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  kcccccccccbccccccccccbccccccccck
  kbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbk
  kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kdck....................kdck..
  ..kkkk....................kkkk..
  ................................`;

export default [
  station({
    item: 'kartentisch',
    size: [32, 29],
    anchor: [16, 27],
    hoehe: 'block',
    frames: [RUHE, ZEICHNET_1, ZEICHNET_2],
    clips: {
      aus: { frames: [0], fps: 1, loop: true },
      arbeitet: { frames: [1, 2], fps: 4, loop: true },
    },
    sockets: { arbeit: [[16, 12]] },
    hitbox: [0, 4, 32, 24],
    occluder: { kind: 'rect', x: 1, y: 17, w: 30, h: 10 },
  }),
  icon(
    'kartentisch',
    `................
     ................
     ................
     .kkkkkkkkkkkkkk.
     .kdEEEEEEEEEEdk.
     .kdEyykkkkEEdk..
     .kdEEkTlWkyEdk..
     .kdElkW3QkEEdk..
     .kdEEEkkkkylEdk.
     .kdDDDDDDDDDDdk.
     .kkkkkkkkkkkkkk.
     .kccccccccccccck
     .kkkkkkkkkkkkkk.
     ..kdk......kdk..
     ..kkk......kkk..
     ................`,
    { legende: { T: 'laub.3', W: 'laub.2', Q: 'erde.1' }, material: { metall: 'TWQ' } },
  ),
];
