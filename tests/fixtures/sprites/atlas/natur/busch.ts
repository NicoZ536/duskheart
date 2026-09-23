/** Runder Busch mit Hinweis `kugel` und Wind-Biegung für die Blätter. */
import { sprite } from '../../../../../assets-src/lib/sprite';

export default sprite({
  id: 'fx_busch',
  size: [10, 8],
  anchor: [5, 7],
  hoehe: 'kugel',
  legende: { '.': null, k: 'gras.0', a: 'gras.1', b: 'gras.2', c: 'gras.3', d: 'gras.4' },
  material: { wind: 'abcd' },
  frames: [
    `...kkkk...
     ..kcddck..
     .kcdddcbk.
     .kbccccbk.
     .kbbccbak.
     ..kabbak..
     ...kaak...
     ....kk....`,
  ],
  occluder: { kind: 'sprite' },
});
