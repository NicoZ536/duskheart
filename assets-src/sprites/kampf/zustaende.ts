/**
 * Zustandszeichen über Kreaturen (M6-80; MASTERPROMPT §4.6 Lesbarkeit, §19.3 „Zustände über Waffen und Munition
 * (… Frost-Verlangsamung, … Betäubung)“, §11.3 „sichtbare Wirkung“; docs/ART.md §8). Die Präsentation
 * (`src/render/game/statusMarks.ts`, `creatures.ts`) setzt sie über den Kopf einer Kreatur, solange der Zustand wirkt:
 * - Clip `stern` / `stern_fern`: die Sterne einer Betäubung (`sichtbar: 'sterne'`), die um den Kopf kreisen – vorn ein
 *   großer Stern, der zwischen langem und kurzem Kreuz funkelt, hinten ein kleinerer, matter (vorn Kern `eis.4*`, Arme
 *   `feuer.5*`, Spitzen `feuer.4*`; hinten Kern `feuer.5*`, Arme `feuer.4*`: der Kern heller als der Rand, ART §9.9). Das
 *   helle Gelb ist weder der kalte Glint der Telegraphs noch das Warnrot, und es hebt sich von den orangen Blüten ab.
 * - Clip `blendung`: die Blendfunken einer Blendung (`sichtbar: 'blendung'`) – ein schräges Funkenkreuz in `eis.2*`–`eis.4*`,
 *   anders als das gerade Kreuz des Glints, das einen Angriff ankündigt.
 * Emissiv wie Glint und Bodenmarkierung (ART §8): Kampfzeichen lesen sich auch nachts, wo vom Gegner nur die Augen bleiben.
 */
import { sprite } from '../../lib/sprite';

const GRUPPE = 'kampf';
/** Takt des Funkelns [fps]: zwei Bilder, viermal je Sekunde hin und her. */
const FUNKEL_FPS = 8;
/** Takt der Blendfunken [fps]: schneller als die Sterne, ein Flimmern. */
const BLEND_FPS = 12;

export default sprite({
  id: 'kampf_zustand',
  group: GRUPPE,
  size: [5, 5],
  anchor: [2, 2],
  hoehe: 'flach',
  legende: { '.': null, a: 'feuer.4*', b: 'feuer.5*', W: 'eis.4*', c: 'eis.2*', d: 'eis.3*' },
  frames: [
    // 0: Stern vorn, langes Kreuz.
    `..a..
     ..b..
     abWba
     ..b..
     ..a..`,
    // 1: Stern vorn, kurzes Kreuz (Funkeln).
    `.....
     ..b..
     .bWb.
     ..b..
     .....`,
    // 2: Stern hinten, klein und matt.
    `.....
     ..a..
     .aba.
     ..a..
     .....`,
    // 3: Stern hinten, Funkeln auf den Kern.
    `.....
     .....
     ..b..
     .....
     .....`,
    // 4: Blendfunke, schräges Kreuz.
    `c...c
     .d.d.
     ..W..
     .d.d.
     c...c`,
    // 5: Blendfunke, kurz.
    `.....
     .d.d.
     ..W..
     .d.d.
     .....`,
  ],
  clips: {
    stern: { frames: [0, 1], fps: FUNKEL_FPS, loop: true },
    stern_fern: { frames: [2, 3], fps: FUNKEL_FPS, loop: true },
    blendung: { frames: [4, 5], fps: BLEND_FPS, loop: true },
  },
  schatten: 'none',
  occluder: { kind: 'none' },
  spiegelbar: true,
  einzelpixel: 'Sternspitzen, Funkelkern und die Arme des schrägen Funkenkreuzes sind einzelne Pixel',
});
