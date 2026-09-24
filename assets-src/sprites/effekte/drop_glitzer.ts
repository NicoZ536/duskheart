/**
 * Glitzern liegender Gegenstände im Dunkeln (M3-39, MASTERPROMPT §4.6 Lesbarkeit: „Aufhebbares im Dunkeln
 * durch Rim-/Glint-Hervorhebung erkennbar, ohne Licht zu verraten“). Die Präsentation (`src/render/game/
 * drops.ts`) setzt es auf einen Drop, der außerhalb der Lichtinseln liegt:
 * - Frame 0: ein einzelner schwach glimmender Punkt an der Kante des Gegenstands (bleibt stehen).
 * - Clip `funkeln` (Frames 1–3): in unregelmäßigem Takt blitzt ein kleiner Stern auf und erlischt wieder.
 *
 * Emissiv, damit es in der Nacht sichtbar ist – es beleuchtet aber nichts (kein Licht in der Lichtliste,
 * §12.1), und die Farben bleiben kühl und klein, damit es nicht wie eine Lichtquelle wirkt.
 */
import { sprite } from '../../lib/sprite';

export default sprite({
  id: 'drop_glitzer',
  group: 'effekte',
  size: [5, 5],
  anchor: [2, 2],
  hoehe: 'flach',
  legende: { '.': null, W: 'eis.4*', c: 'eis.3*', d: 'eis.1*' },
  frames: [
    `.....
     .....
     ..d..
     .....
     .....`,
    `.....
     ..d..
     .dcd.
     ..d..
     .....`,
    `..d..
     ..c..
     dcWcd
     ..c..
     ..d..`,
    `.....
     ..d..
     .dWd.
     ..d..
     .....`,
  ],
  clips: { glimmen: { frames: [0], fps: 8, loop: true }, funkeln: { frames: [1, 2, 2, 3], fps: 12, loop: false } },
  schatten: 'none',
  occluder: { kind: 'none' },
  einzelpixel: 'Ein Glimmpunkt und die Spitzen des Sterns sind einzelne Pixel',
});
