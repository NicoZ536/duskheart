/** Erlaubt: 13 Farben mit Begründung, Funken-Einzelpixel mit Begründung, Hexfarbe exakt aus der Palette. */
import { sprite } from '../../../../assets-src/lib/sprite';

export default [
  sprite({
    id: 'fx_verlauf',
    size: [13, 2],
    anchor: [6, 2],
    hoehe: 'flach',
    ausnahmeFarben: 'Palettenverlauf für den Kontaktbogen der Palette',
    legende: {
      a: 'nacht.0', b: 'nacht.1', c: 'stein.0', d: 'stein.1', e: 'stein.2', f: 'stein.3', g: 'stein.4',
      h: 'stein.5', i: 'erde.0', j: 'erde.1', k: 'erde.2', l: 'erde.3', m: 'erde.4',
    },
    frames: [
      `abcdefghijklm
       abcdefghijklm`,
    ],
  }),
  sprite({
    id: 'fx_funken',
    size: [5, 5],
    anchor: [2, 5],
    hoehe: 'flach',
    einzelpixel: 'Funken fliegen einzeln über der Glut',
    legende: { '.': null, s: 'feuer.4*', g: '#d4471e*' },
    frames: [
      `s...s
       .....
       ..s..
       .ggg.
       ggggg`,
    ],
  }),
];
