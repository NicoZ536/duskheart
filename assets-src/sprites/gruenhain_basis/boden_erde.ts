/**
 * Erdboden des Grünhains (M1-22, docs/ART.md §3): 16×16, vier Varianten als Frames (2 ist die ruhige
 * Grundkachel). Grundton `erde.2`, trockene Schollen `erde.3`, Dellen `erde.1`, ein Kiesel aus `stein`
 * mit dunklem Fuß. Motive liegen vollständig in der Kachel – nahtlos in jeder Anordnung.
 */
import { sprite } from '../../lib/sprite';

export default sprite({
  id: 'boden_erde',
  group: 'gruenhain_basis',
  size: [16, 16],
  anchor: [0, 0],
  hoehe: 'flach',
  legende: { e: 'erde.2', E: 'erde.3', f: 'erde.1', s: 'stein.3', S: 'stein.4', t: 'stein.2' },
  frames: [
    `eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeEEEeeeeeeee
     eeeEEEEEEEeeeeee
     eeEEEEEEEEEeeeee
     eeeEEEeEEeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeffeee
     eeeEEeeeeeeeffee
     eeeeEeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee`,
    `eeeeeeeeeeeeeeee
     eeeeeeeeeeEEEeee
     eeeeeeeeeEEEEEee
     eeeffeeeeeeEEeee
     eeeeffeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeEEEeeeeeeeeeee
     eEEEEEeeeeeeeeee
     eeeEEeeeeeeeeeee
     eeeeeeeeeeefffee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee`,
    `eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeffeeeeeeee
     eeeeeeeffeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeEEee
     eeeeeeeeeeeeeEee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee`,
    `eeeeeeeeeeeeeeee
     eeefeeeeeeeeeeee
     eeffeeeeeeeeeeee
     eefeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeSSeeeee
     eeeeeeeesSSseeee
     eeeeeeeefttfeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeEEeeeeeeeeeeee
     eeeEeeeeeeeeeeee
     eeeeeeeeeeeefffe
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee`,
  ],
});
