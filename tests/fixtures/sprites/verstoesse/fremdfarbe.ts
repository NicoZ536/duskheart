/** Verstoß: `#ff00ff` ist keine Palettenfarbe, `moor.2` keine Rampe. */
import { sprite } from '../../../../assets-src/lib/sprite';

export default sprite({
  id: 'fx_fremdfarbe',
  size: [3, 3],
  anchor: [1, 3],
  hoehe: 'flach',
  legende: { '.': null, a: 'stein.2', p: '#ff00ff', m: 'moor.2' },
  frames: [
    `.a.
     apa
     ama`,
  ],
});
