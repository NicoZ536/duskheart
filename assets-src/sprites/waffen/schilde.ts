/**
 * Schilde in der Nebenhand (M6-09; Items src/content/items/schilde.ts): `ausruestung_holzschild` und
 * `ausruestung_bronzeschild`, gehalten am Sockel `nebenhand` (Anker = Griff hinter dem Buckel).
 *
 * Rundschild, 11 px Durchmesser (knapp halb so hoch wie die Figur). Frames je Richtung, Halte-Clips `down`/`up`/
 * `right`/`left`:
 * - von vorn (`down`): die Schildfläche zum Betrachter – senkrechte Bretter mit Fugen, Rand, Buckel in der Mitte;
 * - von hinten (`up`): die Innenseite (dunkleres Holz, Lederriemen quer über den Griff);
 * - im Profil (`right` fern hinter dem Körper, `left` nah vor ihm): schmal von der Seite, der Buckel steht nach vorn vor;
 * - im Block mit Schild (`block_schild_<richtung>`, M6-Gate): von vorn und hinten wie gehalten, im Profil die Schrägansicht –
 *   der zum Angreifer gedrehte Schild zeigt dem Betrachter seine Fläche als 7 px breites Oval (Bretter, Rand, Licht oben
 *   links) mit dem Buckel zum Gegner. Der Körper streckt die Nebenhand vor die Brust; der Schild folgt dem Sockel. Schmal von
 *   der Seite stand er im Block als 3-px-Streifen über dem Helm und las sich als Helmkamm, nicht als Rundschild.
 *
 * Holzschild: Bretter `holz`, Lederrand `erde`, Holzbuckel. Bronzeschild: dieselben Bretter mit Rand und Buckel aus
 * Metall – in der Rampe `stein` gezeichnet und über die Materialstufe zu Bronze umgefärbt (Metallflag).
 */
import { sprite, type Sprite, type SpriteSource } from '../../lib/sprite';
import { stufenSprites, WAFFEN_GRUPPE } from './_waffe';

const LEGENDE = {
  '.': null,
  k: 'nacht.1',
  h: 'holz.1',
  o: 'holz.2',
  O: 'holz.3',
  H: 'holz.4',
  W: 'erde.2',
  w: 'erde.1',
  // Rand und Buckel des Bronzeschilds (Rampe `stein`).
  b: 'stein.1',
  c: 'stein.2',
  d: 'stein.3',
  e: 'stein.4',
} as const;

/**
 * Frames: vorn, hinten, Profil rechts, Profil links, Schrägansicht im Block nach rechts und links (Zeichen des Rands, seines
 * Lichts, des Buckels und seines Glanzes).
 */
function frames(rand: string, randHell: string, buckel: string, buckelHell: string): string[] {
  const f = (s: string): string => s.replaceAll('R', rand).replaceAll('L', randHell).replaceAll('B', buckel).replaceAll('G', buckelHell);
  return [
    f(`...kkkkk...
       .kkLLLLRkk.
       .kLHOhOoRk.
       kLHOOhOOoRk
       kLHOkkkOoRk
       kLOhkGBkhRk
       kLOOkBBkoRk
       kROOhkkhoRk
       .kROOhOoRk.
       .kkRRRRRkk.
       ...kkkkk...`),
    f(`...kkkkk...
       .kkRRRRRkk.
       .kRohohhRk.
       kRoohohhhRk
       kRoohohhhRk
       kWWWWWWWWWk
       kRwwwwwwwRk
       kRoohohhhRk
       .kRohohhRk.
       .kkRRRRRkk.
       ...kkkkk...`),
    f(`....kkk....
       ...kLRk....
       ...kLOk....
       ...kOoRk...
       ...kOokk...
       ...kOoBBk..
       ...kOokk...
       ...kOoRk...
       ...kOok....
       ...kLRk....
       ....kkk....`),
    f(`....kkk....
       ....kRLk...
       ....kOOk...
       ...kRoOk...
       ...kkoOk...
       ..kBBoOk...
       ...kkoOk...
       ...kRoOk...
       ....koOk...
       ....kRLk...
       ....kkk....`),
    f(`...kkkkk...
       ..kLLLLRk..
       .kLHOhOoRk.
       .kLHOhOORk.
       .kLOhkkkRk.
       .kLhOkGBkk.
       .kLOokBBkk.
       .kROohkkRk.
       .kROOhOoRk.
       ..kRRRRRk..
       ...kkkkk...`),
    f(`...kkkkk...
       ..kRLLLLk..
       .kRoOhOHLk.
       .kROOhOHLk.
       .kRkkkhOLk.
       .kkBGkOhLk.
       .kkBBkoOLk.
       .kRkkhoORk.
       .kRoOhOORk.
       ..kRRRRRk..
       ...kkkkk...`),
  ];
}

function schild(id: string, legende: SpriteSource['legende'], bilder: string[], material?: SpriteSource['material']): Sprite {
  return sprite({
    id,
    group: WAFFEN_GRUPPE,
    size: [11, 11],
    anchor: [5, 5],
    hoehe: 'zylinder',
    legende,
    frames: bilder,
    clips: {
      down: { frames: [0], fps: 8, loop: true },
      up: { frames: [1], fps: 8, loop: true },
      right: { frames: [2], fps: 8, loop: true },
      left: { frames: [3], fps: 8, loop: true },
      block_schild_down: { frames: [0], fps: 8, loop: true },
      block_schild_up: { frames: [1], fps: 8, loop: true },
      block_schild_right: { frames: [4], fps: 8, loop: true },
      block_schild_left: { frames: [5], fps: 8, loop: true },
    },
    occluder: { kind: 'none' },
    ...(material === undefined ? {} : { material }),
  });
}

const holzschild = schild('ausruestung_holzschild', LEGENDE, frames('w', 'W', 'o', 'H'));
const bronzeschildForm = schild('form_bronzeschild', LEGENDE, frames('c', 'e', 'd', 'e'));

export default [holzschild, ...stufenSprites({ metall: bronzeschildForm, bronze: 'bronzeschild' }, 'ausruestung_')];
