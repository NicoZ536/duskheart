/**
 * Lagerung T0 (M4-21, docs/SPIEL.md §8, MASTERPROMPT §16.7): `obj_kiste_holz` (16 Plätze), `obj_truhe`
 * (24), `obj_lagerregal` (48, nur Rohstoffe) – Clips `zu` und `offen` (die UI öffnet die Kiste, der
 * Renderer zeigt den Zustand; Kontaktbogen `stationen.png`). Stellflächen: Kiste 1×1, Truhe 1×1,
 * Lagerregal 2×1; Anker = Mitte der Vorderkante.
 * - **Holzkiste:** Brettkiste mit Eckleisten und Deckel; offen steht der Deckel hinten auf und der
 *   Blick fällt ins Dunkel mit Stein und Apfel.
 * - **Truhe:** gewölbter Deckel mit zwei Bronzebändern und Schloss (Materialflag `metall`); offen die
 *   Deckelinnenseite und Münzgold im Dunkel.
 * - **Lagerregal:** Pfostenregal mit drei Böden – Holzscheite (Hirnholz zur Kamera), Feldsteine,
 *   Faserbündel; `zu` hängt ein Tuch davor (Faltenwurf, gewellter Saum), `offen` ist es aufgerollt.
 */
import { BRONZE, station, ueber } from '../stationen/_stationen';

const KISTE_ZU = `................
                  ................
                  ................
                  ................
                  ................
                  ................
                  ................
                  ................
                  .kkkkkkkkkkkkkk.
                  .keeeddeeeedeek.
                  .kdddcdddddddck.
                  .kcddddddcddddk.
                  .kbbbbbbbbbbbbk.
                  .kbddddddddddbk.
                  .kbccccccccccbk.
                  .kbbbbbbbbbbbbk.
                  .kbddddddddddbk.
                  .kbccccccccccbk.
                  .kbbbbbbbbbbbbk.
                  .kbddddddddddbk.
                  .kbccccccccccbk.
                  .kbbbbbbbbbbbbk.
                  .kkkkkkkkkkkkkk.
                  ................`;

const KISTE_OFFEN = `................
                     .kkkkkkkkkkkkkk.
                     .kbcccccccccbbk.
                     .kbddddddddddbk.
                     .kbcccccccccbbk.
                     .kbddddddddddbk.
                     .kbbbbbbbbbbbbk.
                     .kkkkkkkkkkkkkk.
                     .kddddddddddddk.
                     .kdKKKKKKKKKKck.
                     .kdKK45KKmmKKck.
                     .kdK4554KmmmKck.
                     .kbbbbbbbbbbbbk.
                     .kbddddddddddbk.
                     .kbccccccccccbk.
                     .kbbbbbbbbbbbbk.
                     .kbddddddddddbk.
                     .kbccccccccccbk.
                     .kbbbbbbbbbbbbk.
                     .kbddddddddddbk.
                     .kbccccccccccbk.
                     .kbbbbbbbbbbbbk.
                     .kkkkkkkkkkkkkk.
                     ................`;

const kiste_holz = station({
  item: 'kiste_holz',
  size: [16, 24],
  anchor: [8, 22],
  hoehe: 'block',
  frames: [KISTE_ZU, KISTE_OFFEN],
  clips: {
    zu: { frames: [0], fps: 1, loop: true },
    offen: { frames: [1], fps: 1, loop: true },
  },
  hitbox: [1, 8, 14, 15],
  occluder: { kind: 'rect', x: 1, y: 12, w: 14, h: 10 },
});

const TRUHE_ZU = `................
                  ................
                  ................
                  ................
                  ................
                  ................
                  ....kkkkkkkk....
                  ..kkddTddddTdkk.
                  .kdddeTeeeeTeddk
                  .kddddTddddTdddk
                  .kcccdWcccdWccck
                  .kbbbbWbbbbWbbbk
                  .kkkkkkkPPkkkkkk
                  .kdddcWdPPdWcddk
                  .kddddWdkkdWdddk
                  .kcdddWddddWdcdk
                  .kccccWccccWcccK
                  .kcdccWccccWccck
                  .kccccWcdccWcdck
                  .kbcccWccccWcccK
                  .kbbbbWbbbbWbbbk
                  .kQQQQQQQQQQQQQk
                  .kkkkkkkkkkkkkkk
                  ................`;

const TRUHE_OFFEN = `....kkkkkkkk....
                     ..kkbbWbbbbWbkk.
                     .kbbcbWbcccWcbbk
                     .kbcccWccccWccbk
                     .kbcccWccccWccbk
                     .kbcccWccccWccbk
                     .kkbbbWbbbbWbbkk
                     .kkkkkkkkkkkkkkk
                     .kddddddddddddck
                     .kdKKKoKKoKKKKck
                     .kdKoooKooKoKKck
                     .kdooooooooooKck
                     .kkkkkkkPPkkkkkk
                     .kdddcWdPPdWcddk
                     .kddddWdkkdWdddk
                     .kcdddWddddWdcdk
                     .kccccWccccWcccK
                     .kcdccWccccWccck
                     .kccccWcdccWcdck
                     .kbcccWccccWcccK
                     .kbbbbWbbbbWbbbk
                     .kQQQQQQQQQQQQQk
                     .kkkkkkkkkkkkkkk
                     ................`;

const truhe = station({
  item: 'truhe',
  size: [16, 24],
  anchor: [8, 22],
  hoehe: 'block',
  frames: [TRUHE_ZU, TRUHE_OFFEN],
  clips: {
    zu: { frames: [0], fps: 1, loop: true },
    offen: { frames: [1], fps: 1, loop: true },
  },
  material: { metall: BRONZE },
  hitbox: [1, 6, 15, 17],
  occluder: { kind: 'rect', x: 1, y: 12, w: 14, h: 10 },
});

/** Regal mit Waren: Scheite (oben), Feldsteine (Mitte), Faserbündel (unten). */
const REGAL_OFFEN = `................................
                     ................................
                     ..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..
                     ..kdceeeeeeeeeeeeeeeeeeeeeecdk..
                     ..kdkbbbbbbbbbbbbbbbbbbbbbbkdk..
                     ..kdknkbbbbkkbbbbkkbbbbknnnkdk..
                     ..kdknbdeedbbdeedbbdeedbknnkdk..
                     ..kdknbdecdbbdecdbbdecdbknnkdk..
                     ..kdknkbddbkkbddbkkbddbkknnkdk..
                     ..kdkbbbbbkbbbbbkbbbbbkbbbbkdk..
                     ..kdkbdeedbbdeedbbdeedbbdebkdk..
                     ..kdkbdecdbbdecdbbdecdbbdcbkdk..
                     ..kdkkbddbkkbddbkkbddbkkbdkkdk..
                     ..kdkkkkkkkkkkkkkkkkkkkkkkkkkdk.
                     ..kdceeeeeeeeeeeeeeeeeeeeeecdk..
                     ..kdbbbbbbbbbbbbbbbbbbbbbbbbdk..
                     ..kdknnnnnnnnnnnnnnnnnnnnnnkdk..
                     ..kdknnnnkkkknnnnnnkkkknnnnkdk..
                     ..kdknnnk5553knnnnk55553kkkkdk..
                     ..kdknkk555533kkkk55555335kkdk..
                     ..kdkkk55553333k55k5553335kkdk..
                     ..kdk5555533333k55533333555kdk..
                     ..kdkkkkkkkkkkkkkkkkkkkkkkkkdk..
                     ..kdceeeeeeeeeeeeeeeeeeeeeecdk..
                     ..kdbbbbbbbbbbbbbbbbbbbbbbbbdk..
                     ..kdknnnnnnnnnnnnnnnnnnnnnnkdk..
                     ..kdknnkkkknnnnkkkknnnnkkkkkdk..
                     ..kdknkDEEDknnkDEEDknnkDEEDkdk..
                     ..kdknkDEDDknnkDDEDknnkDEDDkdk..
                     ..kdknkDDEDknnkDEDDknnkDDEDkdk..
                     ..kdknkbbbbknnkbbbbknnkbbbbkdk..
                     ..kdknkDEDDknnkDDEDknnkDEEDkdk..
                     ..kdkkkDDDDkkkkDEDDkkkkDDDDkdk..
                     ..kdceeeeeeeeeeeeeeeeeeeeeecdk..
                     ..kdbbbbbbbbbbbbbbbbbbbbbbbbdk..
                     ..kdkkkkkkkkkkkkkkkkkkkkkkkkdk..
                     ..kdk......................kdk..
                     ..kbk......................kbk..
                     ..kkk......................kkk..
                     ................................`;

/** Tuch vor dem Regal: Falten senkrecht, Saum gewellt; oben die Stange. */
const TUCH = `................................
                ................................
                ................................
                ................................
                ...kkkkkkkkkkkkkkkkkkkkkkkkkk...
                ...kMMmMMMmMMMMmMMMmMMMMmMMk....
                ...kMMmMMMmMMMMmMMMmMMMMmMMk....
                ...kMmmMMmmMMMmmMMmmMMMmmMMk....
                ...kMmMMMmMMMMmMMMmMMMMmMMMk....
                ...kMmMMMmMMMMmMMMmMMMMmMMMk....
                ...kMmMMmmMMMmmMMmmMMMmmMMMk....
                ...kMmMMmMMMMmMMMmMMMMmMMMmk....
                ...kMmMMmMMMMmMMMmMMMMmMMMmk....
                ...kmmMMmMMMmmMMMmMMMmmMMMmk....
                ...kmMMMmMMMmMMMMmMMMmMMMMmk....
                ...kmMMMmMMMmMMMMmMMMmMMMMmk....
                ...kmMMmmMMMmMMMmmMMMmMMMmmk....
                ...kmMMmMMMMmMMMmMMMMmMMMmMk....
                ...kmMMmMMMMmMMMmMMMMmMMMmMk....
                ...kmMmmMMMmmMMMmMMMmmMMMmMk....
                ...kmMmMMMMmMMMMmMMMmMMMMmMk....
                ...kmMmMMMMmMMMMmMMMmMMMMmMk....
                ...kmmmMMMmmMMMmmMMMmMMMmmMk....
                ...kkmMMMMmMMMMmMMMmmMMMmMkk....
                ....kkmMMmmMMMmmMMmkkMMmmkk.....
                .....kkkmkkkMmkkkmkk.kkmkk......
                ........k...kk...k....kk........
                ................................
                ................................
                ................................
                ................................
                ................................
                ................................
                ................................
                ................................
                ................................
                ................................
                ................................
                ................................
                ................................`;

const lagerregal = station({
  item: 'lagerregal',
  size: [32, 40],
  anchor: [16, 38],
  hoehe: 'block',
  frames: [ueber(REGAL_OFFEN, TUCH), REGAL_OFFEN],
  clips: {
    zu: { frames: [0], fps: 1, loop: true },
    offen: { frames: [1], fps: 1, loop: true },
  },
  material: { wind: 'mM' },
  hitbox: [2, 2, 28, 37],
  occluder: { kind: 'rect', x: 2, y: 30, w: 28, h: 8 },
});

export default [kiste_holz, truhe, lagerregal];
