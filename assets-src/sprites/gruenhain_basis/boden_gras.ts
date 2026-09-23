/**
 * Grasboden des Grünhains (M1-22, docs/ART.md §3): 16×16, vier Varianten als Frames (0–2 ruhig, 3 mit
 * dichtem Grasbüschel – die Weltgenerierung streut 3 seltener). Grundton `gras.3`, Halme `gras.2` mit
 * hellen Spitzen `gras.4`, Tiefe im Büschel `gras.1`. Alle Motive liegen vollständig in der Kachel,
 * daher passen die Varianten in jeder Anordnung nahtlos aneinander (tests/unit/assets/gruenhain-basis.test.ts).
 */
import { sprite } from '../../lib/sprite';

export default sprite({
  id: 'boden_gras',
  group: 'gruenhain_basis',
  size: [16, 16],
  anchor: [0, 0],
  hoehe: 'flach',
  legende: { g: 'gras.3', d: 'gras.2', D: 'gras.1', l: 'gras.4' },
  frames: [
    `gggggggggggggggg
     ggglgggggggggggg
     glgdglgggggggggg
     gdgdgdggggglgggg
     gggggggggggdglgg
     gggggggggggdgdgg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg
     ggggggggglgggggg
     ggggggglgdgggggg
     ggglgggdgdgggggg
     glgdglggggggglgg
     gdgdgdgggggggdgg
     gggggggggggggggg
     gggggggggggggggg`,
    `glgggggggggglggg
     gdgggggggglgdggg
     ggggggggggdgdggg
     gggggggggggggggg
     gggggggggggggggg
     ggggglgggggggggg
     ggglgdglgggggggg
     gggdgdgdggggglgg
     gggggggggggggdgg
     gggggggggggggggg
     gggggggggggggggg
     ggggggggglgggggg
     gggggggggdglgggg
     gggggggggdgdgggg
     gggggggggggggggg
     gggggggggggggggg`,
    `gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg
     gggglggggggggggg
     ggggdglggggggggg
     ggggdgdggggggggg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggglggg
     ggggggggggggdggg
     gggggggggggggggg
     ggggglgggggggggg
     ggglgdgggggggggg
     gggdgdgggggggggg
     gggggggggggggggg`,
    `gggggggggggggggg
     gggggggggggglggg
     ggggggggggggdglg
     ggggggggggggdgdg
     ggggglglgglggggg
     ggggldldlgdlgggg
     ggggdddddlddgggg
     gggddDddDddddggg
     ggggdddddddggggg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg
     glggggggggggglgg
     gdgggglgggglgdgg
     ggggggdggggdgdgg
     gggggggggggggggg`,
  ],
});
