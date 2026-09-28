/**
 * Lagermöbel und Deko-Behälter T0–T1 (M4-19; docs/SPIEL.md §8 `schrank_holz`, `kiste_deko`,
 * `truhe_deko`, `fass_holz`, `weinregal`, `buecherregal`). Reine Einrichtung: Sie zählen für die
 * Behaglichkeit (Kategorie Stauraum), sind aber keine Kisten – die Lagerung (Holzkiste, Truhe,
 * Lagerregal) ist M4-21. Hohe Möbel zeigen vor allem ihre Front, oben einen schmalen Streifen Deckel.
 */
import { moebel } from './_moebel';

/** Kleiderschrank: Gesims, zwei Türen mit je zwei vertieften Füllungen, Bronzeknäufe, Sockel. 2×1. */
const schrank = moebel({
  item: 'schrank_holz',
  spiegelbar: true,
  size: [32, 32],
  anchor: [16, 30],
  hoehe: 'block',
  metall: true,
  frames: [
    `................................
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     .keeeeeeeeeeeeeeeeeeeeeeeeeeeek.
     .kddddddddddddddddddddddddddddk.
     .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     ..kddddddddddddkkddddddddddddk..
     ..kdbbbbbbbbbbdkkdbbbbbbbbbbdk..
     ..kdccccccccccdkkdccccccccccdk..
     ..kdccccccccccdkkdccccccccccdk..
     ..kdccccccccccdkkdccccccccccdk..
     ..kdccccccccccdkkdccccccccccdk..
     ..kdccccccccccdkkdccccccccccdk..
     ..kdccccccccccdkkdccccccccccdk..
     ..kddddddddddddkkddddddddddddk..
     ..kddddddddddTdkkdTddddddddddk..
     ..kddddddddddTdkkdTddddddddddk..
     ..kddddddddddddkkddddddddddddk..
     ..kdbbbbbbbbbbdkkdbbbbbbbbbbdk..
     ..kdccccccccccdkkdccccccccccdk..
     ..kdccccccccccdkkdccccccccccdk..
     ..kdccccccccccdkkdccccccccccdk..
     ..kdccccccccccdkkdccccccccccdk..
     ..kdccccccccccdkkdccccccccccdk..
     ..kddddddddddddkkddddddddddddk..
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     .kcccccccccccccccccccccccccccck.
     .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     ..kbak....................kabk..
     ..kkkk....................kkkk..
     ................................`,
  ],
  hitbox: [1, 1, 30, 30],
  occluder: { kind: 'rect', x: 1, y: 6, w: 30, h: 24 },
});

/** Reisetruhe (Deko): gewölbter Deckel, zwei Bronzebänder, Schloss mit Überfall. 1×1. */
const truhe = moebel({
  item: 'truhe_deko',
  spiegelbar: true,
  size: [16, 16],
  anchor: [8, 14],
  hoehe: 'block',
  metall: true,
  frames: [
    `................
     ................
     ...kkkkkkkkkk...
     ..kTTeeeeeeTTk..
     .kdTTddddddTTdk.
     .kdWWddddddWWdk.
     .kcWWccTTccWWck.
     .kkkkkkWWkkkkkk.
     .kdWWdkQQkdWWdk.
     .kdWWdkkkkdWWdk.
     .kcWWccccccWWck.
     .kcWWccccccWWck.
     .kbQQbbbbbbQQbk.
     .kkkkkkkkkkkkkk.
     ..kbk......kbk..
     ................`,
  ],
  hitbox: [1, 2, 14, 13],
  occluder: { kind: 'rect', x: 1, y: 7, w: 14, h: 7 },
});

/** Apfelkiste (Deko): Lattenkiste mit Eckpfosten, darauf ein Haufen roter Äpfel mit Blatt. 1×1. */
const kiste = moebel({
  item: 'kiste_deko',
  spiegelbar: true,
  size: [16, 16],
  anchor: [8, 14],
  hoehe: 'block',
  frames: [
    `................
     ................
     ....kkk.hikk....
     ...kMMmkihMmk...
     ..kkmmlkkmmlkk..
     .kMMmkMMmkMMmkk.
     .kmmlkmmlkmmlkk.
     .kkkkkkkkkkkkkk.
     .kceeeeeeeeeeck.
     .kcddddddddddck.
     .kbbbbbbbbbbbbk.
     .kceeeeeeeeeeck.
     .kcddddddddddck.
     .kbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkk.
     ................`,
  ],
  hitbox: [1, 2, 14, 13],
  occluder: { kind: 'rect', x: 1, y: 7, w: 14, h: 7 },
});

/** Fass: Deckel aus drei Brettern im Rand, bauchige Dauben, zwei Reifen aus gespaltenen Weidenruten. 1×1. */
const fass = moebel({
  item: 'fass_holz',
  size: [16, 20],
  anchor: [8, 18],
  hoehe: 'zylinder',
  frames: [
    `................
     ................
     ....kkkkkkkk....
     ..kkeeeeeeeekk..
     .keccccccccccek.
     .kedddcdddcddek.
     .keddddcdddcdek.
     ..kkeeeeeeeekk..
     .kbbbbbbbbbbbbk.
     .kaaaaaaaaaaaak.
     .kdddcdddcddddk.
     .kdddcdddcddddk.
     .kdddcdddcddddk.
     .kdddcdddcddddk.
     .kbbbbbbbbbbbbk.
     .kaaaaaaaaaaaak.
     ..kddcdddcdddk..
     ..kbbcbbbcbbbk..
     ...kkkkkkkkkk...
     ................`,
  ],
  hitbox: [1, 2, 14, 17],
  occluder: { kind: 'ellipse', x: 8, y: 15, rx: 6, ry: 3 },
  spiegelbar: true,
});

/** Weinregal: Gitter aus 6 × 5 Fächern, in den meisten eine Flasche aus grünem Glas mit Korken. 2×1. */
const weinregal = moebel({
  item: 'weinregal',
  spiegelbar: true,
  size: [32, 26],
  anchor: [16, 24],
  hoehe: 'block',
  frames: [
    `................................
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     .keeeeeeeeeeeeeeeeeeeeeeeeeeeek.
     .kddddddddddddddddddddddddddddk.
     .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     .kdcnhncnnncnhnccnhncnnncnhncdk.
     .kdchChcnnnchChcchChcnnnchChcdk.
     .kdcngncnnncngnccngncnnncngncdk.
     .kdccccccccccccccccccccccccccdk.
     .kdcnhncnhncnnnccnhncnhncnhncdk.
     .kdchChchChcnnncchChchChchChcdk.
     .kdcngncngncnnnccngncngncngncdk.
     .kdccccccccccccccccccccccccccdk.
     .kdcnhncnhncnhnccnnncnhncnhncdk.
     .kdchChchChchChccnnnchChchChcdk.
     .kdcngncngncngnccnnncngncngncdk.
     .kdccccccccccccccccccccccccccdk.
     .kdcnhncnnncnhnccnhncnhncnnncdk.
     .kdchChcnnnchChcchChchChcnnncdk.
     .kdcngncnnncngnccngncngncnnncdk.
     .kdcbbbbbbbbbbbbbbbbbbbbbbbbcdk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     ..kbak....................kabk..
     ..kkkk....................kkkk..
     ................................`,
  ],
  hitbox: [1, 1, 30, 24],
  occluder: { kind: 'rect', x: 1, y: 5, w: 30, h: 19 },
});

/** Bücherregal: drei Böden mit Büchern verschiedener Höhe und Farbe (Rindeneinbände, Leinen), Lücken. 2×1. */
const buecherregal = moebel({
  item: 'buecherregal',
  spiegelbar: true,
  size: [32, 30],
  anchor: [16, 28],
  hoehe: 'block',
  frames: [
    `................................
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     .kddddddddddddddddddddddddddddk.
     .kcccccccccccccccccccccccccccck.
     .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     .kdcnnxxnnnnnnggnnnnnllnnnnncdk.
     .kdcyyxxnnnnhhggnnnnnllmmnnncdk.
     .kdcyyxxmmmnhhggnnnnnllmmyyycdk.
     .kdcxxxxmmmnggggCCCnnllllyyycdk.
     .kdcyyxxlllnhhggCCCnnllmmxxxcdk.
     .kdcyyxxmmmnhhggcccnnllmmyyycdk.
     .kdcxxxxlllnggggcccnnllllxxxcdk.
     .kdcyyxxmmmnhhggCCCnnllmmyyycdk.
     .kdcddddddddddddddddddddddddcdk.
     .kdcbbbbbbbbbbbbbbbbbbbbbbbbcdk.
     .kdcnngggnnnnllnnnxxnnnnnnnncdk.
     .kdcnngggnnmmllyyyxxnnnnnhhncdk.
     .kdchhgggnnmmllyyyxxCCCnnhhncdk.
     .kdchhgggnnllllxxxxxCCCnnggncdk.
     .kdcgggggnnmmllyyyxxcccnnhhncdk.
     .kdchhgggnnmmllyyyxxCCCnnhhncdk.
     .kdcgggggnnllllxxxxxcccnnggncdk.
     .kdchhgggnnmmllyyyxxCCCnnhhncdk.
     .kdcddddddddddddddddddddddddcdk.
     .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     ..kbbk....................kbbk..
     ..kkkk....................kkkk..
     ................................`,
  ],
  hitbox: [1, 1, 30, 28],
  occluder: { kind: 'rect', x: 1, y: 5, w: 30, h: 23 },
});

/** Nachttisch: Schränkchen mit Schublade und Holzknauf, darunter ein offenes Fach mit zwei Büchern. 1×1. */
const nachttisch = moebel({
  item: 'nachttisch',
  size: [16, 20],
  anchor: [8, 18],
  hoehe: 'block',
  frames: [
    `................
     ..kkkkkkkkkkkk..
     .keeeeeeeeeeeek.
     .kddddcccdddddk.
     .kbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkk.
     .kdkcccccccckdk.
     .kdkcddddddckdk.
     .kdkcddkkddckdk.
     .kdkcddddddckdk.
     .kdkbbbbbbbbkdk.
     .kdkkkkkkkkkkdk.
     .kdkKKKKKKKKkdk.
     .kdkKKmmKKKKkdk.
     .kdkKKyyKKKKkdk.
     .kdkbbbbbbbbkdk.
     .kbkkkkkkkkkkbk.
     .kbk........kbk.
     .kkk........kkk.
     ................`,
  ],
  occluder: { kind: 'rect', x: 2, y: 12, w: 12, h: 6 },
  spiegelbar: true,
});

/** Kommode: sechs Schubladen in drei Reihen mit Bronzegriffen (Metallflag), Sockel und Füße. 2×1. */
const kommode = moebel({
  item: 'kommode',
  spiegelbar: true,
  size: [32, 24],
  anchor: [16, 22],
  hoehe: 'block',
  metall: true,
  frames: [
    `................................
     ..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..
     .keeeeeeeeeeeeeeeeeeeeeeeeeeeek.
     .kdddddcccddddddddddddcccdddddk.
     .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     .kdkccccccccccckkccccccccccckdk.
     .kdkddddTTdddddkkdddddTTddddkdk.
     .kdkbbbbbbbbbbbkkbbbbbbbbbbbkdk.
     .kdkkkkkkkkkkkkkkkkkkkkkkkkkkdk.
     .kdkccccccccccckkccccccccccckdk.
     .kdkddddTTdddddkkdddddTTddddkdk.
     .kdkbbbbbbbbbbbkkbbbbbbbbbbbkdk.
     .kdkkkkkkkkkkkkkkkkkkkkkkkkkkdk.
     .kdkccccccccccckkccccccccccckdk.
     .kdkddddTTdddddkkdddddTTddddkdk.
     .kdkbbbbbbbbbbbkkbbbbbbbbbbbkdk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     .kcccccccccccccccccccccccccccck.
     .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
     ..kbbk....................kbbk..
     ..kkkk....................kkkk..
     ................................`,
  ],
  occluder: { kind: 'rect', x: 1, y: 6, w: 30, h: 16 },
});

export default [schrank, truhe, kiste, fass, weinregal, buecherregal, nachttisch, kommode];
