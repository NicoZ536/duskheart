/** Flache Bodenfliese: Hinweis `flach`, kein Sonnenschatten (Standard für `flach`). */
import { sprite } from '../../../../../assets-src/lib/sprite';

export default sprite({
  id: 'fx_fliese',
  size: [4, 4],
  anchor: [2, 4],
  hoehe: 'flach',
  legende: { a: 'erde.2', b: 'erde.3' },
  material: { nass: 'b' },
  frames: [
    `abba
     bbab
     abbb
     bbba`,
  ],
});
