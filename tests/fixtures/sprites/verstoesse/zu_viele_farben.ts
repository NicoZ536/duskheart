/** Verstoß: 13 Palettenfarben ohne `ausnahmeFarben`-Begründung. */
import { sprite } from '../../../../assets-src/lib/sprite';

export default sprite({
  id: 'fx_zu_viele_farben',
  size: [13, 2],
  anchor: [6, 2],
  hoehe: 'flach',
  legende: {
    a: 'nacht.0', b: 'nacht.1', c: 'stein.0', d: 'stein.1', e: 'stein.2', f: 'stein.3', g: 'stein.4',
    h: 'stein.5', i: 'erde.0', j: 'erde.1', k: 'erde.2', l: 'erde.3', m: 'erde.4',
  },
  frames: [
    `abcdefghijklm
     abcdefghijklm`,
  ],
});
