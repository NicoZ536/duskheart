/**
 * Felsen (M1-22, docs/ART.md §3): klein (16×16) und groß (32×32), Höhen-Hinweis `block`, Occluder-Ellipse
 * über der Standfläche. Weiche Form-Schattierung ohne Richtungslicht: Oberseite hell (Himmel), Front
 * mittel, Fuß dunkel (AO); Kontur `stein.0`, Bodenkontakt `nacht.1`. Moos (`gras`) auf der Kuppe
 * verankert die Felsen im Grünhain; Biomzeilen tönen `stein` und `gras` mit (paletteRows.ts).
 */
import { sprite } from '../../lib/sprite';

/** Gemeinsame Legende: Stein dunkel → hell, Moos, Bodenkontakt. */
const LEGENDE = {
  '.': null,
  o: 'stein.0',
  a: 'stein.1',
  b: 'stein.2',
  c: 'stein.3',
  C: 'stein.4',
  h: 'stein.5',
  m: 'gras.2',
  M: 'gras.3',
  L: 'gras.4',
  n: 'nacht.1',
} as const;

const felsKlein = sprite({
  id: 'fels_klein',
  group: 'gruenhain_basis',
  size: [16, 16],
  anchor: [8, 14],
  hoehe: 'block',
  legende: LEGENDE,
  frames: [
    `................
     ................
     ................
     ................
     ................
     ................
     ......ooooo.....
     ....ooCChLLoo...
     ...oCChhCMMmMo..
     ..oCCCCCCCmmCco.
     ..obcCCCCcCCcbo.
     .obbcccccccbbbo.
     .oabbbbbbabbbao.
     ..oaabbbaabbaao.
     ...nnoooooooon..
     ................`,
  ],
  hitbox: [2, 10, 13, 5],
  occluder: { kind: 'ellipse', x: 8, y: 12, rx: 6, ry: 2.5 },
});

const felsGross = sprite({
  id: 'fels_gross',
  group: 'gruenhain_basis',
  size: [32, 32],
  anchor: [16, 28],
  hoehe: 'block',
  legende: LEGENDE,
  frames: [
    `................................
     ................................
     ................................
     ................................
     ................................
     ................................
     ................................
     ................................
     .............oooooo.............
     ..........oooMLLMCCoo...........
     ........ooLMMMMMMChhCoo.........
     .......oLMMmmmmMCChhhhCCo.......
     ......oMMmmCCmmCChhhhCCCCoo.....
     .....oMmmCCCCCCCCChhCCCCCCCo....
     ....oMmCCCCCCCCCCCCCCCCCccCCo...
     ....omCCCCCCCccCCCCCCCCCCcccCo..
     ...omCCCCCCCCCCccCCCCCCCCCCCCo..
     ...ocCCCCCCCCCCCCCCCCCCCCCCCcco.
     ..obcccCCCCCCCCCCCCCCCCCCCccbbo.
     ..obbcccccccCCCCCCCCCcccccbbbbo.
     ..obbbbbccccccccccccccccbbbbbao.
     ..obbbbbbbbbbbbbocccbbbbbbbbbao.
     ..oabbbbbbbbbbbbobbbbbbbbbbooo..
     ..oabbbbbbbbbbbboabbbbbbbboCCo..
     ..oaabbbbbbbbbbbbobbbbbbaoCChco.
     ...oaaabbbbbbbbbbbbbbbbaaocccbo.
     ....ooaaaaabbbbbbbbbbaaaaobbbao.
     ......ooaaaaaaaaaaaaaaaaoaaaaon.
     ........nnoooooooooooooooooonn..
     ................................
     ................................
     ................................`,
  ],
  hitbox: [3, 20, 27, 9],
  occluder: { kind: 'ellipse', x: 16, y: 24, rx: 13, ry: 4 },
});

export default [felsKlein, felsGross];
