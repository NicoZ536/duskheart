/**
 * Geschosse im Flug (M6-07, M6-08; MASTERPROMPT §19.2 „Munition“, §6.2 „Kampf“; docs/SPIEL.md §13 „Projektile im Flug,
 * geworfene Stücke“). Jedes Geschoss ist einmal waagerecht nach rechts gezeichnet – Spitze vorn, Anker in der Mitte – und
 * wird von der Präsentation (`src/render/game/projectiles.ts`) frei im Low-Res-Puffer gedreht: Pfeile und Bolzen nach
 * ihrer Flugrichtung, Wurfmesser und Brandflasche überschlagen sich. Die Clips tragen die Item-Id der Munition bzw. der
 * Wurfwaffe (`pfeil_feuerstein`, `wurfmesser_bronze` …); ein Item ohne eigenen Clip fliegt als das Geschoss seiner Klasse.
 *
 * - `geschoss_pfeil`: Schaft `holz.2`, Federn `laub`, Spitze je Pfeil – Feuerstein (`stein`), Bronze (Metall), Stumpf
 *   (Harzknauf `sand`), Gift (triefend grün `gras`).
 * - `geschoss_brandpfeil`: der brennende Lappen hinter der Spitze, Flammen wehen nach hinten (emissiv `feuer`, 2 Bilder).
 * - `geschoss_leuchtpfeil`: Spitze aus Leuchtpilz (emissiv `eis`, wie `icon_pfeil_leucht`).
 * - `geschoss_bolzen`: kurz, Lederfahnen, Bronzespitze.
 * - `geschoss_stein`: ein Schleuderstein.
 * - `geschoss_messer`: Wurfmesser (Feuerstein, Bronze) mit umwickeltem Griff.
 * - `geschoss_flasche`: Tonflasche mit brennendem Lappen im Hals (2 Bilder Flackern).
 */
import { sprite } from '../../lib/sprite';

const GRUPPE = 'kampf';
/** Flackern brennender Geschosse (Effekte laufen schneller als Figuren, §4.5). */
const FLACKERN_FPS = 12;
const OHNE = { schatten: 'none', occluder: { kind: 'none' } } as const;

export default [
  sprite({
    id: 'geschoss_pfeil',
    group: GRUPPE,
    size: [13, 5],
    anchor: [6, 2],
    hoehe: 'zylinder',
    legende: {
      '.': null,
      k: 'nacht.1',
      c: 'holz.2',
      F: 'laub.1',
      f: 'laub.0',
      '5': 'stein.4',
      '3': 'stein.2',
      T: 'laub.4',
      X: 'holz.3',
      D: 'sand.3',
      B: 'sand.1',
      J: 'gras.4',
      h: 'gras.2',
    },
    frames: [
      `.............
       Ff........3..
       .Fcccccccc55k
       Ff........3..
       .............`,
      `.............
       Ff........X..
       .FccccccccTTk
       Ff........X..
       .............`,
      `.............
       Ff........D..
       .FccccccccDDB
       Ff........B..
       .............`,
      `.............
       Ff........h..
       .FccccccccJJh
       Ff........hJ.
       .............`,
    ],
    clips: {
      pfeil_feuerstein: { frames: [0], fps: 1, loop: true },
      pfeil_bronze: { frames: [1], fps: 1, loop: true },
      pfeil_stumpf: { frames: [2], fps: 1, loop: true },
      pfeil_gift: { frames: [3], fps: 1, loop: true },
    },
    material: { metall: 'TX' },
    ...OHNE,
    einzelpixel: 'Widerhaken der Spitze und Federenden sind einzelne Pixel eines 1-px-Schafts',
  }),
  sprite({
    id: 'geschoss_brandpfeil',
    group: GRUPPE,
    size: [13, 5],
    anchor: [6, 2],
    hoehe: 'zylinder',
    legende: { '.': null, k: 'nacht.1', c: 'holz.2', F: 'laub.1', f: 'laub.0', '2': 'feuer.2*', '3': 'feuer.3*', '4': 'feuer.4*', '5': 'feuer.5*' },
    frames: [
      `.......23....
       Ff....2345...
       .Fcccc44554k.
       Ff.....23....
       .............`,
      `........2....
       Ff...23455...
       .Fcccc34554k.
       Ff....2344...
       .............`,
    ],
    clips: { pfeil_feuer: { frames: [0, 1], fps: FLACKERN_FPS, loop: true } },
    ...OHNE,
    einzelpixel: 'Flammenzungen und Federenden sind einzelne Pixel',
  }),
  sprite({
    id: 'geschoss_leuchtpfeil',
    group: GRUPPE,
    size: [13, 5],
    anchor: [6, 2],
    hoehe: 'zylinder',
    legende: { '.': null, k: 'nacht.1', c: 'holz.2', F: 'laub.1', f: 'laub.0', '0': 'eis.3*', '#': 'eis.4*' },
    frames: [
      `.............
       Ff........0..
       .Fcccccccc#0k
       Ff........0..
       .............`,
    ],
    clips: { pfeil_leucht: { frames: [0], fps: 1, loop: true } },
    ...OHNE,
    einzelpixel: 'Leuchtende Widerhaken und Federenden sind einzelne Pixel',
  }),
  sprite({
    id: 'geschoss_bolzen',
    group: GRUPPE,
    size: [10, 5],
    anchor: [5, 2],
    hoehe: 'zylinder',
    legende: { '.': null, k: 'nacht.1', c: 'holz.2', q: 'erde.1', r: 'erde.2', T: 'laub.4', X: 'holz.3' },
    frames: [
      `..........
       rq.....Xk.
       .rcccccTTk
       rq.....Xk.
       ..........`,
    ],
    clips: { bolzen_bronze: { frames: [0], fps: 1, loop: true } },
    material: { metall: 'TX' },
    ...OHNE,
    einzelpixel: 'Fahnenenden und Widerhaken sind einzelne Pixel',
  }),
  sprite({
    id: 'geschoss_stein',
    group: GRUPPE,
    size: [4, 4],
    anchor: [2, 2],
    hoehe: 'kugel',
    legende: { '.': null, k: 'nacht.1', '5': 'stein.4', '4': 'stein.3', '3': 'stein.2' },
    frames: [
      `.55.
       5443
       k433
       .kk.`,
    ],
    clips: { schleuderstein: { frames: [0], fps: 1, loop: true } },
    ...OHNE,
  }),
  sprite({
    id: 'geschoss_messer',
    group: GRUPPE,
    size: [10, 5],
    anchor: [5, 2],
    hoehe: 'flach',
    legende: { '.': null, k: 'nacht.1', q: 'erde.1', r: 'erde.2', '6': 'stein.5', '5': 'stein.4', '4': 'stein.3', '3': 'stein.2', P: 'sand.4', T: 'laub.4', X: 'holz.3' },
    frames: [
      `..........
       .....k66k.
       qrrqk5543k
       .....kkk..
       ..........`,
      `..........
       .....kPPk.
       qrrqkTTXXk
       .....kkk..
       ..........`,
    ],
    clips: { wurfmesser_feuerstein: { frames: [0], fps: 1, loop: true }, wurfmesser_bronze: { frames: [1], fps: 1, loop: true } },
    material: { metall: 'PTX' },
    einzelpixel: 'Griffende und Schliffstufen der Klinge sind einzelne Pixel einer 1-px-Klinge',
    ...OHNE,
  }),
  sprite({
    id: 'geschoss_flasche',
    group: GRUPPE,
    size: [7, 9],
    anchor: [3, 5],
    hoehe: 'kugel',
    legende: { '.': null, k: 'nacht.1', C: 'sand.2', B: 'sand.1', q: 'erde.1', r: 'erde.2', s: 'erde.3', '3': 'feuer.3*', '4': 'feuer.4*', '5': 'feuer.5*' },
    frames: [
      `...4...
       ..453..
       ...C...
       ..kCk..
       .krssk.
       krsBsrk
       krssrqk
       .kqqqk.
       ..kkk..`,
      `..4....
       ..54...
       ..3C...
       ..kCk..
       .krssk.
       krsBsrk
       krssrqk
       .kqqqk.
       ..kkk..`,
    ],
    clips: { brandflasche: { frames: [0, 1], fps: FLACKERN_FPS, loop: true } },
    ...OHNE,
    einzelpixel: 'Flammenspitze und Glanzpunkt der Flasche sind einzelne Pixel',
  }),
];
