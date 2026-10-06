/**
 * Krone des Borkenvaters als Wandmöbel (`obj_trophaee_borkenvater`; M7-32/M7-34, Strang F; Item und Bauteil
 * src/content/items/borkenvater.ts): ein Kranz aus Borkenzacken mit den drei erloschenen Glutknoten (`feuer.1`, nicht
 * emissiv – die Glut ist aus ihnen gewichen) auf einem genagelten Brett, wie das Trophäenbrett (moebel/wand.ts) an der
 * 16-px-Wandfront: Anker unten Mitte, höchstens 15 px hoch, kein Bodenschatten. Nicht spiegelbar: die Knoten sitzen
 * ungleich wie am Boss selbst. Im Kontaktbogen des Bosses.
 */
import { moebel } from '../moebel/_moebel';

const trophaee = moebel({
  item: 'trophaee_borkenvater',
  size: [16, 15],
  anchor: [8, 14],
  hoehe: 'block',
  frames: [
    `..k....kk....k..
     .kck..kcck..kck.
     .kcbk.kcbk.kbck.
     ..kbbkbbbbkbbk..
     .kbuFbbuFbbuFbk.
     .kaFFbaFFabFFak.
     .kkaabbaabbaakk.
     .kdeeeeeeeeeedk.
     .kdddddddddddck.
     .kcdddd4ddddcck.
     .kcccccccccccbk.
     .kbcccccccccbbk.
     .kbbbbbbbbbbbak.
     ..kkkkkkkkkkkk..
     ................`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
  einzelpixel: 'Nagelkopf mitten im Brett und die Lichtkante je Glutknoten',
});

export default { ...trophaee, group: 'boss_borkenvater' };
