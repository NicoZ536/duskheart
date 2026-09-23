/** Animierte Flamme auf Eisenschale: 3 Frames (Frame 2 = Frame 0, teilt sich ein Atlas-Rechteck). */
import { sprite } from '../../../../../assets-src/lib/sprite';
import { FLAMME } from '../_legende';

const hoch = `........
              ...rr...
              ..rffr..
              ..fWWf..
              ..fWWf..
              .kmmmmk.
              ..kmmk..
              ...kk...`;

export default sprite({
  id: 'fx_flamme',
  size: [8, 8],
  anchor: [4, 7],
  hoehe: 'zylinder',
  legende: FLAMME,
  material: { metall: 'm' },
  frames: [
    hoch,
    `........
     ........
     ..rrr...
     .rfWfr..
     ..fWWf..
     .kmmmmk.
     ..kmmk..
     ...kk...`,
    hoch,
  ],
  clips: { idle: { frames: [0, 1, 2, 1], fps: 12, loop: true, events: [{ frame: 1, name: 'knistern' }] } },
  sockets: { licht: [[4, 3], [4, 4], [4, 3]] },
  hitbox: [2, 5, 4, 3],
  occluder: { kind: 'ellipse', x: 4, y: 7, rx: 2, ry: 1 },
});
