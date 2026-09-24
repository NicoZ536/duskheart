/**
 * Gelöschte Handfackel als Nebenhand-Layer (M3-07, §12.2 „F Licht an/aus“): dieselbe Form wie
 * `ausruestung_fackel` ohne Flamme – der Pechkopf ist erkaltet (dunkles Holz statt Glut). Gleicher Anker
 * (Griffpixel auf dem Sockel `nebenhand`) und gleiche Zellgröße, damit die Fackel beim Löschen und
 * Anzünden nicht springt. Die Figur zeigt sie, solange die Fackel in der Nebenhand steckt, aber nicht brennt.
 */
import { sprite } from '../../lib/sprite';

/** Griffpixel (Anker) wie bei der brennenden Fackel. */
const GRIFF: [number, number] = [3, 11];

const bild = `.......
  .......
  .......
  .......
  .......
  .......
  .kpppk.
  .khphk.
  ..kok..
  ..kok..
  ..kok..
  ..kok..
  ..kok..
  ...k...`;

const halten = { frames: [0], fps: 8, loop: true };

export default sprite({
  id: 'ausruestung_fackel_aus',
  group: 'ausruestung',
  size: [7, 14],
  anchor: GRIFF,
  hoehe: 'zylinder',
  legende: { '.': null, k: 'nacht.1', p: 'holz.0', h: 'holz.1', o: 'holz.2' },
  frames: [bild],
  clips: { down: halten, up: halten, right: halten, left: halten },
  occluder: { kind: 'none' },
  schatten: 'silhouette',
  spiegelbar: true,
});
