/**
 * Lumen-Werkbank (`obj_lumen_werkbank`; MASTERPROMPT §23.1 „Leuchtfeuer 1 Grünhain: Lumen-Werkbank …“; Station
 * src/content/stations.ts, Item src/content/items/stationen.ts, Rezepte src/content/recipes/lumen.ts; M7-36, Strang F):
 * eine Werkbank aus dunkler Eiche mit Schublade, Beschlägen und Querstrebe wie die Werkbank der Stufe 1, auf der Platte
 * links ein großer Lumen-Kristall in einer Bronzefassung, rechts eine Linse auf einem Bronzearm, dazwischen zwei Splitter.
 *
 * 32 × 40, Stellfläche 2 × 1, Anker = Mitte der Vorderkante `[16, 38]` (wie `obj_werkbank_2`). Der Kristall ist kaltes Licht
 * ohne Brennstoff (`eis.2*` – `eis.4*`, die Spitze und die vordere Kante am hellsten); die Station steht nie „an“, sie atmet
 * nur: Clip `aus` mit zwei Helligkeiten, 3 fps. Holz `holz.1`–`holz.4`, Bronze `erde.1`/`laub.2`/`laub.3` (Metallflag), Glas
 * der Linse `eis.2`/`eis.3`; Kontur `nacht.1`. Sockel `arbeit` vor der Platte, `licht` im Kristall.
 */
import { station } from './_stationen';

/** Werkbank mit Kristall (Grundhelligkeit). */
const BANK = `................................
   ................................
   ........kk......................
   .......k=@k.....................
   .......k=@}k....................
   ......k==@}k....................
   ......k=@@}}k...................
   .....k==@@}}k...................
   .....k=@@@}}k...................
   .....k=@@}}}k.........kkkk......
   .....k@@@}}}k........k;}};k.....
   .....k@@@}}k.........k};;}k.....
   ......k@@}}k..........kkkk......
   ......k@}}k............kWk......
   .......kkkk............kWk......
   ......kQWQk............kWk......
   .....kQWTWQk..........kQWQk.....
   ....kQWWTWWQk..kkkk..kQWTWQk....
   ....kkkkkkkkk.k@=@k..kkkkkkk....
   .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
   .keeeeeeeeeeeeeeeeeeeeeeeeeeeek.
   .kdddddccddddddddcddddddccddddk.
   .kddddddddddddddddddddddddddddk.
   .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
   .kccccccckkkkkkkkkkkkkkccccccck.
   .kccccccckcccccQWccccckccccccck.
   .kccccccckbbbbbQQbbbbbkccccccck.
   .kccccccckkkkkkkkkkkkkkccccccck.
   .kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.
   .kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.
   .kcdbk....................kccbk.
   .kcdbk....................kccbk.
   .kcdbk....................kccbk.
   .kcdbkkkkkkkkkkkkkkkkkkkkkkccbk.
   .kcdbbbbbbbbbbbbbbbbbbbbbbbccbk.
   .kcdbkkkkkkkkkkkkkkkkkkkkkkccbk.
   .kcdbk....................kccbk.
   .kbbbk....................kbbbk.
   .kkkkk....................kkkkk.
   ................................`;

/** Der Kristall eine Stufe heller (Spalten 4–13 der Zeilen 2–14): das Atmen des Lumens. */
function heller(raster: string): string {
  return raster
    .split('\n')
    .map((zeile, y) => {
      const z = zeile.trim();
      if (y < 2 || y > 14) return z;
      return [...z].map((c, x) => (x < 4 || x > 13 ? c : c === '@' ? '=' : c === '}' ? '@' : c)).join('');
    })
    .join('\n');
}

const lumenWerkbank = station({
  item: 'lumen_werkbank',
  size: [32, 40],
  anchor: [16, 38],
  hoehe: 'block',
  legende: { '=': 'eis.4*', '@': 'eis.3*', '}': 'eis.2*', ';': 'eis.3', b: 'holz.1' },
  frames: [BANK, heller(BANK)],
  clips: { aus: { frames: [0, 0, 1, 1], fps: 3, loop: true } },
  material: { metall: 'QWT' },
  sockets: { arbeit: [[16, 20]], licht: [[9, 8]] },
  hitbox: [2, 2, 28, 37],
  occluder: { kind: 'rect', x: 2, y: 28, w: 28, h: 10 },
});

export default lumenWerkbank;
