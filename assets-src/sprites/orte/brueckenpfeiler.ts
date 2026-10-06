/**
 * Brückenpfeiler der Brückenruine (M7-09; docs/SPIEL.md §18): ein gemauerter Pfeiler, oben schräg abgebrochen (die helle
 * Bruchfläche), am Fuß die dunkle Wasserlinie mit Algen, Moos in den Fugen. Zelle 16×38, Anker Zeile 35, Höhen-Hinweis `block`.
 */
import { ort } from './_ort';

const PFEILER = `................
                 ................
                 ................
                 ................
                 ................
                 .....11.........
                 ....1661........
                 ...165561.......
                 ..16544561......
                 .1652222561.....
                 .15525555561....
                 .1542444445611..
                 .15424444425661.
                 .15222222222551.
                 .155555255hh531.
                 .154444244h4431.
                 .15444424444431.
                 .15222222222231.
                 .15525555255531.
                 .15424444244431.
                 .15h24444244431.
                 .15hh2222222231.
                 .151h5255555231.
                 .15444244444231.
                 .15444244444231.
                 .15222222222231.
                 .15255552555531.
                 .15244442444431.
                 .1g24g44g44g431.
                 .152g22g22g22g1.
                 .15g55g25g55g31.
                 .1gggggggggggg1.
                 .1gggggggggggg1.
                 .1GGGGGGGGGGGG1.
                 .1GGGGGGGGGGGG1.
                 ..kkkkkkkkkkkk..
                 ................
                 ................`;

export default [
  ort({ id: 'brueckenpfeiler', size: [16, 38], anchor: [8, 35], hoehe: 'block', frames: [PFEILER], occluder: { kind: 'rect', x: 2, y: 6, w: 12, h: 29 } }),
];
