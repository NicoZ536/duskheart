/** Verstoß (Warnung): ein frei schwebendes Pixel oben links und ein einzelner Fremdton mitten im Cluster. */
import { sprite } from '../../../../assets-src/lib/sprite';

export default sprite({
  id: 'fx_einzelpixel',
  size: [6, 6],
  anchor: [3, 6],
  hoehe: 'kugel',
  legende: { '.': null, a: 'gras.2', b: 'gras.3', x: 'laub.4' },
  frames: [
    `a.....
     ......
     ..bb..
     .bbxb.
     .bbbb.
     ..bb..`,
  ],
});
