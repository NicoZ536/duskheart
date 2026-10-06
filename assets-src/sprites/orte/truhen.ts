/**
 * Truhen der Orte (M7-07, docs/SPIEL.md §18 "Truhen `ort_truhe_1…3`, `ort_truhe_offen`"): drei Stufen, an Form und Material
 * unterscheidbar, nicht nur an der Farbe.
 * - **`ort_truhe_1` Alte Holztruhe:** verwitterte Bretter, gewölbter Deckel mit Moospolster, rostige Überfalle.
 * - **`ort_truhe_2` Beschlagene Truhe:** dunkles Eichenholz mit zwei Eisenbändern und Eckbeschlägen, schweres Vorhängeschloss.
 * - **`ort_truhe_3` Erbauer-Truhe:** ein Kasten aus geschliffenem Erbauer-Stein mit goldenem Band und einer Lumen-Rune, die
 *   kalt glimmt (emissiv) – sichtbar auch bei Nacht, ein Versprechen für den Weg dorthin.
 * - **`ort_truhe_offen`:** der Deckel steht hinten auf, das Innere ist leer und dunkel.
 * Zelle 16×20, Anker auf der Vorderkante (Zeile 18), Stellfläche 1×1, Höhen-Hinweis `block`.
 */
import { ort } from './_ort';

/** Zelle und Anker aller Truhen. */
const ZELLE: [number, number] = [16, 20];
const ANKER: [number, number] = [8, 18];
const STANDFLAECHE = { kind: 'rect', x: 1, y: 12, w: 14, h: 7 } as const;

const HOLZ = `................
              ................
              ................
              ................
              ................
              ................
              ....aaaaaaaa....
              ..aaddeeeeddaa..
              .acddhiiiedddca.
              .acdhiijjiddeca.
              .abccciicccccba.
              .aaaaaa33aaaaaa.
              .acddca43acddca.
              .acdcda22adcdca.
              .abbbbbbbbbbbba.
              .acdddcddcdddca.
              .acccdcccdcccca.
              .abbbbbbbbbbbba.
              .kaaaaaaaaaaaak.
              ................`;

const BESCHLAGEN = `................
                    ................
                    ................
                    ................
                    ................
                    ................
                    ....2222222222..
                    ..22bcc2ccc2c22.
                    .2bcccc4ccc4cc2.
                    .2bbccc4ccc4cc2.
                    .2abbbb3bbb3bb2.
                    .22222222222222.
                    .23bbb3n44nb332.
                    .2bccb3n55nbcb2.
                    .2bccb3nnnnbcb2.
                    .2abbb3bbbb3bb2.
                    .2bccb3bccb3cb2.
                    .23aaa3aaaa3a32.
                    .k222222222222k.
                    ................`;

const ERBAUER = `................
                 ................
                 ................
                 ................
                 ................
                 ................
                 ...1111111111...
                 ..156666666651..
                 .15555555555551.
                 .14455555555441.
                 .1DDDDDDDDDDDD1.
                 .1EEEEEEEEEEEE1.
                 .133334>>433331.
                 .13334>^^>43331.
                 .133334>>433331.
                 .12223333332221.
                 .1DDDDDDDDDDDD1.
                 .12222222222221.
                 .k111111111111k.
                 ................`;

const OFFEN = `................
               ................
               ....aaaaaaaa....
               ..aacddddddcaa..
               .acdcccccccccca.
               .acbbbbbbbbbbca.
               .abbbbbbbbbbbba.
               .aaaaaaaaaaaaaa.
               .acKKKKKKKKKKca.
               .abKKKKKKKKKKba.
               .aaaaaa33aaaaaa.
               .acddca43acddca.
               .acdcda22adcdca.
               .abbbbbbbbbbbba.
               .acdddcddcdddca.
               .acccdcccdcccca.
               .abbbbbbbbbbbba.
               .kaaaaaaaaaaaak.
               ................
               ................`;

export default [
  ort({ id: 'truhe_1', size: ZELLE, anchor: ANKER, hoehe: 'block', frames: [HOLZ], occluder: STANDFLAECHE, material: { metall: '34' }, einzelpixel: 'Schlüsselloch der Überfalle' }),
  ort({ id: 'truhe_2', size: ZELLE, anchor: ANKER, hoehe: 'block', frames: [BESCHLAGEN], occluder: STANDFLAECHE, material: { metall: '2345n' } }),
  ort({ id: 'truhe_3', size: ZELLE, anchor: ANKER, hoehe: 'block', frames: [ERBAUER], occluder: STANDFLAECHE, material: { metall: 'DE' } }),
  ort({ id: 'truhe_offen', size: ZELLE, anchor: ANKER, hoehe: 'block', frames: [OFFEN], occluder: STANDFLAECHE, material: { metall: '34' }, einzelpixel: 'Schlüsselloch der Überfalle' }),
];
