/**
 * Handfackel als Nebenhand-Layer (M3-07, §12.2 „Die Lichtquelle sitzt in der Nebenhand“): Holzstiel mit
 * Pechkopf, Flamme emissiv mit hellerem Kern (`feuer.5`) als Rand (`feuer.1`). Griffpixel = Anker, er
 * liegt auf dem Sockel `nebenhand` jedes Körper-Frames; die Fackel bleibt aufrecht (Flammen steigen
 * immer nach oben), nur die Hand trägt sie mit. Vier Flammenformen wie die Wandfackel, aber auf
 * Figurenmaß verkleinert: aufrecht, nach rechts mit Zunge, geduckt, nach links mit abreißender Spitze;
 * Clip aufrecht → links → geduckt → rechts, 10 fps (Effekt, läuft mit der Item-Zeit unabhängig vom
 * Körper). Sockel `licht` im Flammenkern: dort setzt die Präsentation das Handlicht (6 Tiles).
 */
import { sprite } from '../../lib/sprite';

const FLAMMEN = [
  [`..r..`, `.rfr.`, `rfFfr`, `fFyFf`, `FyWyF`, `.yWy.`],
  [`...r.`, `..rfr`, `.rfFr`, `rfFyf`, `fFyWF`, `.yWy.`],
  [`.....`, `..r..`, `.rfFr`, `rfFyf`, `fyWyF`, `.yWy.`],
  [`.r...`, `.rr..`, `rfFr.`, `fFyfr`, `FyWyf`, `.yWy.`],
] as const;

/** Pechkopf (Glut oben), Stiel, Griff (`+` = Anker) und Knauf unter der Flamme. */
const STIEL = [`.kpFpk.`, `.khphk.`, `..kok..`, `..kok..`, `..kok..`, `..kok..`, `..kok..`, `...k...`];
/** Griffpixel (Anker) in der Zelle: Stiel-Zeile 5 unter der Flamme. */
const GRIFF: [number, number] = [3, 11];

const frames = FLAMMEN.map((flamme) => [...flamme.map((z) => `.${z}.`), ...STIEL].join('\n'));

const richtung = { frames: [0, 3, 2, 1], fps: 10, loop: true };

export default sprite({
  id: 'ausruestung_fackel',
  group: 'ausruestung',
  size: [7, 14],
  anchor: GRIFF,
  hoehe: 'zylinder',
  legende: {
    '.': null,
    k: 'nacht.1',
    p: 'holz.0',
    h: 'holz.1',
    o: 'holz.2',
    r: 'feuer.1*',
    f: 'feuer.2*',
    F: 'feuer.3*',
    y: 'feuer.4*',
    W: 'feuer.5*',
  },
  frames,
  clips: { down: richtung, up: richtung, right: richtung, left: richtung },
  sockets: { licht: [[3, 3]] },
  occluder: { kind: 'none' },
  schatten: 'silhouette',
  spiegelbar: true,
});
