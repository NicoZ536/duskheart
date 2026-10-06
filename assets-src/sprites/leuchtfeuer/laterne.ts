/**
 * Lumen-Laterne als Nebenhand-Layer (`ausruestung_lumen_laterne`, gelöscht `ausruestung_lumen_laterne_aus`; MASTERPROMPT
 * §12.2 „Lumen-Laterne (ab Leuchtfeuer 1) | 8 | Lumen-Ladung“, „Die Lichtquelle sitzt in der Nebenhand“; Item
 * src/content/items/lumen.ts; M7-36, Strang F). Anders als die Fackel hängt sie: die Hand hält den Bügel (Griffpixel `+` =
 * Anker auf dem Sockel `nebenhand`), darunter Kappe, Glas und Fuß aus Bronze (Töne wie die Bronzewerkzeuge, Metallflag).
 * Hinter dem Glas der Lumen-Kern – kalt-weiß, kein Flammengelb: sie brennt nicht, sie leuchtet (`eis.3*`, Kern `eis.4*`),
 * und atmet in zwei Formen (8 fps). Gelöscht ist das Glas dunkel (`eis.1`/`eis.0`), Anker und Zelle bleiben gleich, damit
 * sie beim Ein- und Ausschalten nicht springt. Sockel `licht` im Kern (dort setzt die Präsentation das Handlicht, 8 Tiles).
 */
import { sprite } from '../../lib/sprite';

const LEGENDE = {
  '.': null,
  k: 'nacht.1',
  q: 'erde.1',
  w: 'holz.3',
  x: 'laub.4',
  t: 'sand.4',
  '@': 'eis.3*',
  '=': 'eis.4*',
  '8': 'eis.0',
  '9': 'eis.1',
} as const;

/** Griffpixel (Anker): der Scheitel des Bügels. */
const GRIFF: [number, number] = [3, 0];

const AN = [
  `..kxk..
   .kx.xk.
   .ktttk.
   kwxxxwk
   kq@=@qk
   kx===xk
   kq@=@qk
   kwxxxwk
   .kqwqk.
   ..kkk..`,
  `..kxk..
   .kx.xk.
   .ktttk.
   kwxxxwk
   kq@=@qk
   kx@=@xk
   kq@@@qk
   kwxxxwk
   .kqwqk.
   ..kkk..`,
];

const AUS = `..kxk..
             .kx.xk.
             .ktttk.
             kwxxxwk
             kq999qk
             kx998xk
             kq888qk
             kwxxxwk
             .kqwqk.
             ..kkk..`;

const leuchten = { frames: [0, 1], fps: 8, loop: true };
const halten = { frames: [0], fps: 8, loop: true };

const an = sprite({
  id: 'ausruestung_lumen_laterne',
  group: 'leuchtfeuer',
  size: [7, 10],
  anchor: GRIFF,
  hoehe: 'zylinder',
  legende: LEGENDE,
  frames: AN,
  clips: { down: leuchten, up: leuchten, right: leuchten, left: leuchten },
  sockets: { licht: [[3, 5]] },
  material: { metall: 'qwxt' },
  occluder: { kind: 'none' },
  schatten: 'silhouette',
  spiegelbar: true,
});

const aus = sprite({
  id: 'ausruestung_lumen_laterne_aus',
  group: 'leuchtfeuer',
  size: [7, 10],
  anchor: GRIFF,
  hoehe: 'zylinder',
  legende: LEGENDE,
  frames: [AUS],
  clips: { down: halten, up: halten, right: halten, left: halten },
  sockets: { licht: [[3, 5]] },
  material: { metall: 'qwxt' },
  occluder: { kind: 'none' },
  schatten: 'silhouette',
  spiegelbar: true,
});

export default [an, aus];
