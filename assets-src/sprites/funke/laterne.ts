/**
 * Funke in seiner Laterne (MASTERPROMPT §8 „Funke: ein Flammengeist in der Laterne“; docs/SPIEL.md §23 „Funke“; M7-44): das
 * HUD-Bild neben Funkes Einwurf, 24×24, vier Bilder, die die HUD-Komponente reihum zeigt (`FUNKE_LATERNE_FRAMES`; bei
 * reduzierter Bewegung steht Bild 0).
 *
 * - Laterne: Ring und Haken oben, eiserne Haube und Fuß (`stein.1`–`stein.3`, Lichtkante oben links), vier Streben um das
 *   dunkle Glas (`nacht.2`/`nacht.3`), in dem ein roter Schein (`feuer.1`) um die Flamme liegt.
 * - Funke: ein tropfenförmiger Flammengeist (`feuer.3` außen, `feuer.4` innen, `feuer.5` Kern, emissiv – er leuchtet im
 *   HUD wie in der Welt) mit zwei dunklen Augen. Die Spitze neigt sich je Bild ein Pixel nach links oder rechts und hebt sich;
 *   in Bild 3 blinzelt er (die Augen als Strich).
 */
import { sprite } from '../../lib/sprite';

const GRUPPE = 'funke';

/** Die Laterne ohne Flamme (24×24); `,` = Glas, auf dem die Flamme liegt. */
const LATERNE = `
..........kkkk..........
.........k4..2k.........
.........k3..2k.........
..........kkkk..........
.........kk22kk.........
.......kk343322kk.......
......k4333333322k......
......kkkkkkkkkkkk......
......k3,,,,,,,,2k......
......k3,,,,,,,,2k......
......k3,,,,,,,,2k......
......k3,,,,,,,,2k......
......k3,,,,,,,,2k......
......k3,,,,,,,,2k......
......k3,,,,,,,,2k......
......k3,,,,,,,,2k......
......k3,,,,,,,,2k......
......k3,,,,,,,,2k......
......k3,,,,,,,,2k......
......kkkkkkkkkkkk......
.......k43333322k.......
........kkkkkkkk........
........................
........................`;

/**
 * Die Flamme je Bild im Glas (8×11, Spalten 8–15, Zeilen 8–18): `.` = dunkles Glas, `F` = roter Schein, `U`/`v`/`V` = Flamme,
 * `k` = Augen.
 */
const FLAMMEN = [
  `....F...
   ...FUF..
   ..FUvUF.
   .FUvVvUF
   .FUkVkUF
   FUvVVVvU
   FUvVVVvU
   FUvvVvvU
   .FUvvvUF
   ..FUUUF.
   ...FFF..`,
  `...F....
   ..FUF...
   .FUvUF..
   .FUvVvUF
   .FUkVkUF
   FUvVVVvU
   FUvVVVvU
   FUvvVvvU
   .FUvvvUF
   ..FUUUF.
   ...FFF..`,
  `.....F..
   ....FUF.
   ...FUvUF
   .FUvVvUF
   .FUkVkUF
   FUvVVVvU
   FUvVVVvU
   FUvvVvvU
   .FUvvvUF
   ..FUUUF.
   ...FFF..`,
  `....F...
   ...FUF..
   ..FUvUF.
   .FUvVvUF
   .FUVVVUF
   FUkkVkkU
   FUvVVVvU
   FUvvVvvU
   .FUvvvUF
   ..FUUUF.
   ...FFF..`,
];

/** Bild `i`: die Laterne mit Flamme `i` (dunkles Glas `n`/`N`: oben heller, wo der Schein hinreicht). */
function bild(i: number): string {
  const zeilen = LATERNE.trim()
    .split('\n')
    .map((z) => [...z.trim()]);
  const flamme = (FLAMMEN[i] as string)
    .trim()
    .split('\n')
    .map((z) => [...z.trim()]);
  for (let y = 8; y <= 18; y++) {
    for (let x = 8; x <= 15; x++) {
      const ch = flamme[y - 8]?.[x - 8] ?? '.';
      (zeilen[y] as string[])[x] = ch === '.' ? (y < 13 ? 'N' : 'n') : ch;
    }
  }
  return zeilen.map((z) => z.join('')).join('\n');
}

export default sprite({
  id: 'funke_laterne',
  group: GRUPPE,
  size: [24, 24],
  anchor: [12, 12],
  hoehe: 'flach',
  legende: {
    '.': null,
    k: 'nacht.1',
    n: 'nacht.2',
    N: 'nacht.3',
    '2': 'stein.1',
    '3': 'stein.2',
    '4': 'stein.3',
    F: 'feuer.1',
    U: 'feuer.3*',
    v: 'feuer.4*',
    V: 'feuer.5*',
  },
  frames: [0, 1, 2, 3].map(bild),
  schatten: 'none',
  occluder: { kind: 'none' },
});
