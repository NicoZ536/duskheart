/**
 * Partikel der sichtbaren Zustandswirkungen am Spieler (MASTERPROMPT §11.3 „sichtbare Wirkung“, M3-20) und
 * der Lichtereignisse (§6.2 „Feuer: … Funken, Rauch“, M3-22). Die Präsentation (`src/render/game/
 * figureFx.ts`) setzt sie als Funktion der Zeit: jedes Teilchen hat Startzeit, Bahn und Lebensdauer aus
 * seinem Index – ein eingefrorenes Bild zeigt immer dieselben Teilchen.
 * - `partikel_tropfen` (Durchnässt, Schweiß): fallender Tropfen (Frame 0) und kleiner Spritzer beim
 *   Aufschlag (Frame 1), Wasser mit hellem Glanzpixel, als nass markiert (glänzt im Licht).
 * - `partikel_blutstropfen` (Blutung): derselbe Tropfen in dunklem Rot.
 * - `partikel_flamme` (Brennen): kleine emissive Flammenzunge, die flackert (Clip `flackern`); hell im
 *   Kern, dunkelrot am Rand.
 * - `partikel_atem` (Frierend, Unterkühlt): Atemwölkchen in Eisweiß, das aufquillt und zerfasert (Clip
 *   `hauch`, einmal über die Lebensdauer).
 * - `partikel_rauch` (erlöschende Fackel, Lagerfeuer): grauer Rauchballen, der wächst und zerfasert
 *   (Clip `aufsteigen`).
 * - `partikel_zittern` (Frierend, Unterkühlt): kurze Zickzack-Striche in kaltem Blau links und rechts der
 *   Figur – das Zittern bleibt auch im Standbild lesbar; zwei Frames wechseln im Takt des Zitterns.
 */
import { sprite } from '../../lib/sprite';

const GRUPPE = 'effekte';
const EINZEL = 'Tropfen, Spritzer und Wölkchen sind einzelne Pixel in Bewegung';

/** Tropfen im Fall und Spritzer (gleiche Form für Wasser und Blut, nur die Legende wechselt). */
const TROPFEN = [
  `........
   ........
   ...h....
   ...m....
   ...d....
   ........
   ........
   ........`,
  `........
   ........
   ........
   ........
   ........
   ..m.m...
   .d.h.d..
   ........`,
];

export default [
  sprite({
    id: 'partikel_tropfen',
    group: GRUPPE,
    size: [8, 8],
    anchor: [4, 6],
    hoehe: 'flach',
    legende: { '.': null, h: 'wasser.5', m: 'wasser.4', d: 'wasser.3' },
    frames: TROPFEN,
    clips: { fallen: { frames: [0], fps: 10, loop: true }, spritzen: { frames: [1], fps: 10, loop: false } },
    schatten: 'none',
    occluder: { kind: 'none' },
    material: { nass: true },
    einzelpixel: EINZEL,
  }),
  sprite({
    id: 'partikel_blutstropfen',
    group: GRUPPE,
    size: [8, 8],
    anchor: [4, 6],
    hoehe: 'flach',
    legende: { '.': null, h: 'feuer.2', m: 'feuer.1', d: 'feuer.0' },
    frames: TROPFEN,
    clips: { fallen: { frames: [0], fps: 10, loop: true }, spritzen: { frames: [1], fps: 10, loop: false } },
    schatten: 'none',
    occluder: { kind: 'none' },
    material: { nass: true },
    einzelpixel: EINZEL,
  }),
  sprite({
    id: 'partikel_flamme',
    group: GRUPPE,
    size: [8, 8],
    anchor: [4, 7],
    hoehe: 'flach',
    legende: { '.': null, W: 'feuer.5*', y: 'feuer.4*', F: 'feuer.3*', f: 'feuer.2*', r: 'feuer.1*' },
    frames: [
      `........
       ....r...
       ...rf...
       ...fFf..
       ..rFyF..
       ..fyWy..
       ...yWF..
       ....F...`,
      `........
       ........
       ...r....
       ...fr...
       ..fFf...
       ..FyFr..
       ..yWyf..
       ...WF...`,
      `........
       .....r..
       ....fr..
       ...fF...
       ..rFyf..
       ..fyWF..
       ...yWy..
       ...FF...`,
      `........
       ........
       ....r...
       ...ff...
       ..rFFf..
       ..FyWF..
       ..fWyF..
       ...FW...`,
    ],
    clips: { flackern: { frames: [0, 1, 2, 3], fps: 14, loop: true } },
    schatten: 'none',
    occluder: { kind: 'none' },
    einzelpixel: 'Flammenspitzen sind einzelne Pixel',
  }),
  sprite({
    id: 'partikel_atem',
    group: GRUPPE,
    size: [8, 8],
    anchor: [4, 4],
    hoehe: 'flach',
    // Heller Kern mit kühlblauem Saum: liest sich auf dunklem Grund und auf Schnee.
    legende: { '.': null, E: 'eis.4', e: 'eis.3', c: 'eis.1' },
    frames: [
      `........
       ........
       ........
       ...cc...
       ..cEec..
       ...cc...
       ........
       ........`,
      `........
       ........
       ...cc...
       ..cEEc..
       ..cEec..
       ...cc...
       ........
       ........`,
      `........
       ...cc...
       ..cEEcc.
       .cEeeEc.
       ..ceEc..
       ...cc...
       ........
       ........`,
      `........
       ..c..c..
       .ce..ec.
       ..c.ce..
       ...c.c..
       ........
       ........
       ........`,
    ],
    clips: { hauch: { frames: [0, 1, 2, 2, 3], fps: 8, loop: false } },
    schatten: 'none',
    occluder: { kind: 'none' },
    einzelpixel: EINZEL,
  }),
  sprite({
    id: 'partikel_zittern',
    group: GRUPPE,
    size: [4, 7],
    anchor: [2, 6],
    hoehe: 'flach',
    // Dunkles Eisblau mit hellem Saum: liest sich auf Schnee, Sand und dunklem Boden.
    legende: { '.': null, a: 'eis.0', b: 'eis.2' },
    frames: [
      `....
       .a..
       ..a.
       .ab.
       ..a.
       .a..
       ....`,
      `....
       ..a.
       .a..
       .ba.
       .a..
       ..a.
       ....`,
    ],
    clips: { zittern: { frames: [0, 1], fps: 12, loop: true } },
    schatten: 'none',
    occluder: { kind: 'none' },
    einzelpixel: 'Zitterstriche sind diagonale Einzelpixel',
  }),
  sprite({
    id: 'partikel_rauch',
    group: GRUPPE,
    size: [8, 8],
    anchor: [4, 6],
    hoehe: 'kugel',
    legende: { '.': null, H: 'stein.4', m: 'stein.3', d: 'stein.2' },
    frames: [
      `........
       ........
       ........
       ........
       ...mH...
       ...dm...
       ........
       ........`,
      `........
       ........
       ........
       ...mH...
       ..mHHm..
       ..dmmd..
       ...dd...
       ........`,
      `........
       ........
       ..mH.H..
       .mHHmHm.
       .dmHHmd.
       ..dmmd..
       ...d....
       ........`,
      `........
       .m...H..
       ..H.m...
       .d..Hm.m
       ..m..d..
       ...d....
       ........
       ........`,
    ],
    clips: { aufsteigen: { frames: [0, 1, 2, 3], fps: 6, loop: false } },
    schatten: 'none',
    occluder: { kind: 'none' },
    einzelpixel: EINZEL,
  }),
];
