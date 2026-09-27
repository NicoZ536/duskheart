/**
 * Betten T0–T1 (M4-19; docs/SPIEL.md §8 `holzbett`, `strohbett`, `wiege`). Kopf oben (Norden): die
 * Figur liegt mit dem Kopf auf dem Kissen (Sockel `kopf`), Sockel `liegen` = Körpermitte – wie beim
 * Grasbett (M3-24). Stoffe in `laub` (Rot, Varianten über `STOFF_VARIANTEN`), Leinen und Stroh in `sand`.
 */
import { moebel } from './_moebel';

/**
 * Holzbett: Kopfteil mit Pfosten und Füllung, Leinenkissen, umgeschlagenes Laken, rote Wolldecke mit
 * Falten, die an den Seiten über die Bettkante fällt; Fußteil vorn. 1×2.
 */
const holzbett = moebel({
  item: 'holzbett',
  size: [16, 40],
  anchor: [8, 38],
  hoehe: 'kugel',
  frames: [
    `................
     .kkk........kkk.
     .kek........kek.
     .kdkkkkkkkkkkdk.
     .kdeeeeeeeeeedk.
     .kddcddddddcddk.
     .kddcddddddcddk.
     .kbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkk.
     .kckDEEEEEEDkck.
     .kckEEEEEEEEkck.
     .kckDEEEEEEDkck.
     .kckkDDDDDDkkck.
     .kcEEEEEEEEEEck.
     .kcDDDDDDDDDDck.
     .kcMMMMMMMMMMck.
     .kcmmmmmmmmmmck.
     .kclmmmMmmmmlck.
     .kclmmmMmmmmlck.
     .kclmmmlMmmmlck.
     .kclmmmlMmmmlck.
     .kclmmmmlMmmlck.
     .kclmmmmlMmmlck.
     .kclmmmmmmmmlck.
     .kclmmmmmlMmlck.
     .kclmmmmmmmmlck.
     .kclmMmmmmmmlck.
     .kclmlMmmmmmlck.
     .kclmmlmmmmmlck.
     .kclmmmmmmmmlck.
     .kclmmmmmmmmlck.
     .kcllllllllllck.
     .kkkkkkkkkkkkkk.
     .kdeeeeeeeeeedk.
     .kddddddddddddk.
     .kbbbbbbbbbbbbk.
     .kakkkkkkkkkkak.
     .kdbk......kdbk.
     .kkkk......kkkk.
     ................`,
  ],
  sockets: { kopf: [[8, 11]], liegen: [[8, 22]] },
  hitbox: [1, 1, 14, 38],
  occluder: { kind: 'rect', x: 1, y: 8, w: 14, h: 30 },
  spiegelbar: true,
});

/**
 * Strohbett: niedriger Rahmen aus Rundhölzern, darin ein Strohsack mit längs laufenden Halmen,
 * oben eine gebundene Strohrolle, am Fußende eine gefaltete rote Wolldecke. 1×2.
 */
const strohbett = moebel({
  item: 'strohbett',
  size: [16, 35],
  anchor: [8, 33],
  hoehe: 'kugel',
  frames: [
    `................
     ................
     .kkkkkkkkkkkkkk.
     .kddddddddddddk.
     .kbbbbbbbbbbbbk.
     .kckkkkkkkkkkck.
     .kckDEEDEEEDkck.
     .kckCDDCDDDCkck.
     .kckkBkkkkBkkck.
     .kcDDEDDDCDDDck.
     .kcDCEDDDCDEDck.
     .kcDCDDEDCDEDck.
     .kcDCDDEDDDDDck.
     .kcDDDDEDDCDDck.
     .kcDDCDDDDCDEck.
     .kcEDCDDEDCDEck.
     .kcEDCDDEDDDDck.
     .kcDDDDDEDDCDck.
     .kcDCDDDDDDCDck.
     .kcDCDEDDCDCDck.
     .kcDDDEDDCDDDck.
     .kcDDDDDDCDDDck.
     .kckkkkkkkkkkck.
     .kckMMMMMMMMkck.
     .kckmmMmmmMmkck.
     .kckmmmmmmmmkck.
     .kckllllllllkck.
     .kcBkkkkkkkkBck.
     .kcBBBBBBBBBBck.
     .kkkkkkkkkkkkkk.
     .kddddddddddddk.
     .kbbbbbbbbbbbbk.
     .kbkkkkkkkkkkbk.
     .kkk........kkk.
     ................`,
  ],
  sockets: { kopf: [[8, 7]], liegen: [[8, 17]] },
  hitbox: [1, 2, 14, 32],
  occluder: { kind: 'rect', x: 1, y: 5, w: 14, h: 28 },
  spiegelbar: true,
});

/** Wiege: kleiner Kasten mit hohem Kopfbrett, rotes Deckchen, gebogene Kufen. 1×1. */
const wiege = moebel({
  item: 'wiege',
  size: [16, 20],
  anchor: [8, 19],
  hoehe: 'kugel',
  frames: [
    `................
     ...kkkkkkkkkk...
     ..kdeeeeeeeedk..
     ..kdddcddcdddk..
     ..kbbbbbbbbbbk..
     ..kkkkkkkkkkkk..
     ..kckDEEEEDkck..
     ..kckEEEEEEkck..
     ..kckooooookck..
     ..kckMMmMMMkck..
     ..kckMMMMmMkck..
     ..kckmmmmmmkck..
     ..kckkkkkkkkck..
     ..kdeeeeeeeedk..
     ..kddddddddddk..
     ..kbbbbbbbbbbk..
     .kkakkkkkkkkakk.
     kdddk......kdddk
     .kkkddddddddkkk.
     ....kkkkkkkk....`,
  ],
  hitbox: [0, 1, 16, 18],
  occluder: { kind: 'rect', x: 2, y: 12, w: 12, h: 6 },
  spiegelbar: true,
});

export default [holzbett, strohbett, wiege];
