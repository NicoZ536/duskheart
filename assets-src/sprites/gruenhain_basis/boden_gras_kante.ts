/**
 * Übergang Gras ↔ Erde als Stilmuster für das spätere 47er-Blob-Set (M1-22 → M2-17, docs/ART.md §3):
 * Frame = Seite, auf der das Gras liegt – 0 oben, 1 unten, 2 links, 3 rechts. Die Grasnarbe liegt höher
 * als die Erde: ihr Rand ist ein dunkler Saum `gras.2`, darunter ein AO-Streifen `erde.1`; liegt das Gras
 * unten, stechen helle Halmspitzen in die Erde. Der Saumverlauf endet links/rechts (oben/unten) auf
 * derselben Höhe, damit gleiche Kanten nahtlos aneinanderstoßen.
 */
import { sprite } from '../../lib/sprite';

export default sprite({
  id: 'boden_gras_kante',
  group: 'gruenhain_basis',
  size: [16, 16],
  anchor: [0, 0],
  hoehe: 'flach',
  legende: { g: 'gras.3', d: 'gras.2', l: 'gras.4', e: 'erde.2', E: 'erde.3', f: 'erde.1' },
  frames: [
    `gggggggggggggggg
     ggggggggggglgggg
     ggglgggggggdglgg
     glgdglgggggdgdgg
     gdgdgdgggggggggg
     gggggggggggggggg
     ggggggggdddggggg
     dddgggddfffgdggd
     fffdgdffeeedfddf
     eeefdfeeeeefeffe
     eeeefeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeEEeeeeeffeeeee
     eeeEeeeeeeffeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee`,
    `eeeeeeeeeeeeeeee
     eeeeeeeeeeeeeeee
     eeeeeeeeeeeffeee
     eeeEEeeeeeeeffee
     eeeeEeeeeeeeeeee
     eeeleeeeeeeeelee
     elegeeleeeleegee
     eggggegeeegeggee
     ggggggggeegggggg
     gggggggggggggggg
     gggggggggggggggg
     ggglgggggggggggg
     gggdglggggglgggg
     gggdgdggglgdglgg
     gggggggggdgdgdgg
     gggggggggggggggg`,
    `gggggggdfeeeeeee
     gggggggdfeeeeeee
     gggggggdfeeeeeee
     glggggggdfeeeeee
     gdglggggdfeeeeee
     gdgdggggddfeeeee
     ggggggggdfeffeee
     gggggggdfeeeffee
     gggggggdfeeeeeee
     gggggggdfeeeeeee
     ggggggdfeeeeeeee
     gggglgddfeeeeeee
     ggggdgdfeeeeeeee
     gggggggdfeeeeeee
     gggggggdfeeeeeee
     gggggggdfeeeeeee`,
    `eeeeeeefdggggggg
     eeeeeeefdggggggg
     eeeeeefddgggglgg
     eeeeeefdgggggdgg
     eeEEeefdgggggggg
     eeeEeefdgggggggg
     eeeeeeefdggggggg
     eeeeeeefdggggggg
     eeeeeeefdggggggg
     eeeeeeefddggglgg
     eeeeeeeefdglgdgg
     eeeeeeeefdgdgdgg
     eeeeeeefdggggggg
     eeeeeeefdggggggg
     eeeeeeefdggggggg
     eeeeeeefdggggggg`,
  ],
});
