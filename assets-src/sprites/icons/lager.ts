/**
 * Item-Icons der Lagerung (M4-21, docs/SPIEL.md §8): `icon_kiste_holz`, `icon_truhe`, `icon_lagerregal`
 * (16×16, Konvention in `_icon.ts`) – dieselben Formen wie die Welt-Sprites `obj_<id>` im Kleinen:
 * Brettkiste mit Eckleisten, gewölbte Truhe mit Bronzebändern und Schloss, Regal mit Scheiten, Steinen
 * und Faserbündeln.
 */
import { icon } from './_icon';

export default [
  icon(
    'kiste_holz',
    `................
     ................
     ................
     .kkkkkkkkkkkkkk.
     .keeeddeeeeddek.
     .kddddcdddddddk.
     .kkkkkkkkkkkkkk.
     .kbddddddddddbk.
     .kbccccccccccbk.
     .kbbbbbbbbbbbbk.
     .kbddddddddddbk.
     .kbccccccccccbk.
     .kbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkk.
     ................
     ................`,
  ),
  icon(
    'truhe',
    `................
     ................
     ....kkkkkkkk....
     ..kkddmddddmkk..
     .kdddemeeeemddk.
     .kddddmddddmddk.
     .kcccclccccmcck.
     .kkkkkkkooklkkk.
     .kdddcldoodmcdk.
     .kddddmdkkdmddk.
     .kccccmcccclcck.
     .kccccmccccmcck.
     .klllllllllllk..
     .kkkkkkkkkkkkkk.
     ................
     ................`,
    { material: { metall: 'lmo' } },
  ),
  icon(
    'lagerregal',
    `................
     .kkkkkkkkkkkkkk.
     .kdkkkkkkkkkkdk.
     .kdkkdekkdekkdk.
     .kdkbcdkbcdkkdk.
     .kdkkkkkkkkkkdk.
     .kdeeeeeeeeeedk.
     .kdk.kkk.kkk.dk.
     .kdkk553k5533dk.
     .kdeeeeeeeeeedk.
     .kdk.kk..kk..dk.
     .kdkkDEkkEDk.dk.
     .kdeeeeeeeeeedk.
     .kbk........kbk.
     .kkk........kkk.
     ................`,
  ),
];
