/**
 * Zugänge T0 (M4-11/M4-12/M4-13, docs/SPIEL.md §8, MASTERPROMPT §16.1 „Wasserbauten auf Pfählen“):
 * `bau_steg_holz`, `bau_treppe_holz`, `bau_leiter_holz` – Bodenstücke (Vertrag in `_bau.ts`).
 * - **Steg:** Deck aus quer liegenden, verwitterten Bohlen mit dunklen Fugen; an offener Südseite
 *   ragen Stirnbalken und zwei Pfähle ins Wasser darunter, der Schatten des Stegs liegt dunkel auf dem
 *   Wasser. Frames = Nachbarmaske (verbindet mit Stegen).
 * - **Treppe:** Holztreppe auf dem Wand-Tile einer Höhenstufe (16 px), Wangen links und rechts; Frames
 *   Aufstieg nach Nord (Setzstufen zur Kamera, jede Trittfläche heller als die Stufe darunter), Ost,
 *   Süd (Trittflächen von oben, die Setzstufen zeigen weg) und West.
 * - **Leiter:** zwei Holme mit fünf Sprossen an einer 16-px-Wand, oben ragen die Holmenden 4 px über
 *   die Kante (Halt beim Umsteigen).
 */
import { bauSprite, rasterFrame, stegSprite, tabellenClips, type Stil } from './_bau';

const steg = stegSprite({
  id: 'bau_steg_holz',
  stil: { kontur: 'a', fuss: 'x' },
  deck: `dddcdddddddddddd
         ddddddcddeddddcd
         bbbbbbbbbbbbbbbb
         ccccccccbccccccc
         cdcccccccccdcccc
         bbbbbbbbbbbbbbbb
         ddddddddddddcddd
         dcdddeeddddddddd
         bbbbbbbbbbbbbbbb
         cccccbcccccccccc
         cccccccccccdcccc
         bbbbbbbbbbbbbbbb
         dddddddddcdddddd
         ddcddddddddddedd
         bbbbbbbbbbbbbbbb
         cccccccccccccccc`,
  stirn: `cdcccccccdcccccc
          bbbbbbbbbbbbbbbb
          .bcb........bcb.
          .bcb........bcb.
          .bbb........bbb.
          .xbx........xbx.
          .xxx........xxx.
          ................`,
});

const HOLZ: Stil = { kontur: 'a' };

/** Treppe Nord: vier Stufen, Setzstufe 2 px, Trittfläche 2 px; Wangen 2 px. */
const TREPPE_NORD = `acbeeeedeeeeebca
                     acbdddddddcddbca
                     acbccbcccccccbca
                     acbaaaaaaaaaabca
                     acbeeeeeeedeebca
                     acbddcdddddddbca
                     acbcccccccbccbca
                     acbaaaaaaaaaabca
                     acbedeeeeeeeebca
                     acbddddddcdddbca
                     acbccccbcccccbca
                     acbaaaaaaaaaabca
                     acbeeeeeedeeebca
                     acbdddcddddddbca
                     acbccccccccccbca
                     aaaaaaaaaaaaaaaa`;

/** Treppe Süd: Trittflächen von oben mit dunklen Stoßkanten, zur Kamera hin tiefer. */
const TREPPE_SUED = `aaaaaaaaaaaaaaaa
                     acbddddddcdddbca
                     acbdddcddddddbca
                     acbeeeeeeeeeebca
                     acbaaaaaaaaaabca
                     acbddddddddddbca
                     acbddcdddddddbca
                     acbeeeedeeeeebca
                     acbaaaaaaaaaabca
                     acbddddddddcdbca
                     acbdcddddddddbca
                     acbeeeeeeeeeebca
                     acbaaaaaaaaaabca
                     acbdddddcddddbca
                     acbeeeeeeeeeebca
                     aaaaaaaaaaaaaaaa`;

/** Treppe Ost: Stufen steigen nach rechts, Setzstufen als senkrechte Kanten. */
const TREPPE_OST = `aaaaaaaaaaaaaaaa
                    accccccccccccdca
                    abbbbbbbbbbbbbba
                    aaccaacdaaddaade
                    abccabcdabddabde
                    abccabcdabddabde
                    abccabcdabddabde
                    abccabcdabddabde
                    abccabcdabddabde
                    abccabcdabddabde
                    abccabcdabddabde
                    abccabcdabddabde
                    abccabcdabddabde
                    accccccccccccdca
                    abbbbbbbbbbbbbba
                    aaaaaaaaaaaaaaaa`;

/** Treppe West: Ost gespiegelt (die Stufen steigen nach links). */
function spiegeln(raster: string): string {
  return raster
    .split('\n')
    .map((z) => [...z.trim()].reverse().join(''))
    .join('\n');
}

const treppe = bauSprite(
  {
    id: 'bau_treppe_holz',
    size: [16, 16],
    anchor: [0, 0],
    hoehe: 'flach',
    clips: tabellenClips({ nord: [0], ost: [1], sued: [2], west: [3] }),
  },
  [TREPPE_NORD, TREPPE_OST, TREPPE_SUED, spiegeln(TREPPE_OST)].map((r) => rasterFrame(HOLZ, r, [16, 16])),
);

const leiter = bauSprite(
  { id: 'bau_leiter_holz', size: [16, 20], anchor: [0, 4], hoehe: 'flach', clips: tabellenClips({ wand: [0] }) },
  [
    rasterFrame(
      HOLZ,
      `...aa......aa...
       ...ad......da...
       ...ac......ca...
       ...ac......ca...
       ...acaaaaaaca...
       ...acddeeddca...
       ...acbbbbbbca...
       ...ac......ca...
       ...acaaaaaaca...
       ...acdeeddcca...
       ...acbbbbbbca...
       ...ac......ca...
       ...acaaaaaaca...
       ...acddddedca...
       ...acbbbbbbca...
       ...ac......ca...
       ...acaaaaaaca...
       ...acdeedddca...
       ...acbbbbbbca...
       ...kk......kk...`,
      [16, 20],
    ),
  ],
);

export default [steg, treppe, leiter];
