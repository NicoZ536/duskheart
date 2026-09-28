/**
 * Glühwürmchen (M5-23, MASTERPROMPT §6.2 „Nacht: … Glühwürmchen“): ein Leuchtpunkt, der über den Wiesen der
 * Sommernächte schwebt und pulsiert (`src/render/surface/fireflies.ts` wählt je Pulsphase den Frame):
 * - `hell`: gelblicher Kern (`feuer.5`) mit grüngelbem Schein ringsum (`gras.5`),
 * - `mittel`: grüngelber Kern mit schwachem Schein (`gras.4`),
 * - `glimm`: ein einzelner glimmender Punkt,
 * - `dunkel`: nur der dunkle Körper (nicht emissiv).
 * Emissiv, aber ohne Eintrag in der Lichtliste (§12.1): es erhellt nichts, der Schein kommt vom Bloom.
 */
import { sprite } from '../../lib/sprite';

export default sprite({
  id: 'gluehwuermchen',
  group: 'effekte',
  size: [3, 3],
  anchor: [1, 2],
  hoehe: 'flach',
  legende: { '.': null, K: 'feuer.5*', G: 'gras.5*', g: 'gras.4*', d: 'laub.0' },
  frames: [
    `.G.
     GKG
     .G.`,
    `.g.
     gGg
     .g.`,
    `...
     .G.
     ...`,
    `...
     .d.
     ...`,
  ],
  clips: { hell: { frames: [0], fps: 1, loop: true }, mittel: { frames: [1], fps: 1, loop: true }, glimm: { frames: [2], fps: 1, loop: true }, dunkel: { frames: [3], fps: 1, loop: true } },
  schatten: 'none',
  occluder: { kind: 'none' },
  einzelpixel: 'Ein Glühwürmchen ist ein einzelner Leuchtpunkt; im glimmenden und im dunklen Frame bleibt nur der Kern',
});
