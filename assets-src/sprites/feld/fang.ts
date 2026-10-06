/**
 * Welt-Sprites des Angelns (M7-24, Strang D; Kontaktbogen `fang`):
 * - `angel_pose`: der Schwimmer – rote Kappe, weißer Körper; Frames `ruhig`, `wippen` (ein Pixel tiefer) und `taucht`
 *   (nur die Kappe über Wasser: der Biss).
 * - `angel_schnur`: ein Punkt der Rute (Holz) und einer der Schnur (hell) – der Renderer setzt Rute und Schnur aus ihnen
 *   zusammen, die Rute gebogen nach dem Zug des Fischs (src/render/game/fishing.ts).
 * - `obj_reuse`: die gesetzte Reuse, halb im Wasser – Frames `leer` und `voll` (ein Fischschwanz im Korb).
 * - `fang_eisloch`: ein Loch im Eis (flach, Bodenebene): offenes dunkles Wasser im gesplitterten Rand.
 * Gezeichnet mit `_raster.ts`.
 */
import { sprite, type Sprite } from '../../lib/sprite';
import { ICON_LEGENDE } from '../icons/_icon';
import { Raster, stufe } from './_raster';

const GRUPPE = 'fang';
const sh = (rampe: string, hell = 0.3, dunkel = 0.75) => (_x: number, _y: number, t: number) => stufe(rampe, t, hell, dunkel);

const POSE = ((): Sprite => {
  const frames: string[] = [];
  for (const [tief, nurKappe] of [
    [0, false],
    [1, false],
    [2, true],
  ] as const) {
    const r = new Raster(6, 9);
    r.set(2, 1 + tief, 'F').set(3, 1 + tief, 'F').set(2, 2 + tief, 'u').set(3, 2 + tief, 'u');
    if (!nurKappe) r.set(2, 3 + tief, '#').set(3, 3 + tief, '#').set(2, 4 + tief, '0').set(3, 4 + tief, '0');
    r.outline('k');
    frames.push(r.toString());
  }
  return sprite({
    id: 'angel_pose',
    group: GRUPPE,
    size: [6, 9],
    anchor: [3, 6],
    hoehe: 'zylinder',
    legende: ICON_LEGENDE,
    frames,
    clips: { ruhig: { frames: [0, 1], fps: 1.2 }, taucht: { frames: [2], fps: 1 } },
    occluder: { kind: 'none' },
    schatten: 'none',
  });
})();

const SCHNUR = sprite({
  id: 'angel_schnur',
  group: GRUPPE,
  size: [1, 1],
  anchor: [0, 0],
  hoehe: 'zylinder',
  legende: ICON_LEGENDE,
  frames: ['c', '9'],
  occluder: { kind: 'none' },
  schatten: 'none',
  einzelpixel: 'Ein Punkt von Rute oder Schnur: der Renderer reiht die Punkte zur Linie',
});

const REUSE = ((): Sprite => {
  const frames: string[] = [];
  for (const voll of [false, true]) {
    const r = new Raster(16, 14);
    r.ellipse(7.5, 7, 6, 4, sh('bcd', 0.3, 0.8));
    for (const x of [4, 7, 10]) for (let y = 3; y <= 11; y++) if (r.get(x, y) !== '.') r.set(x, y, 'b');
    r.ellipse(13.5, 7, 1.5, 2.6, sh('cd'));
    r.ellipse(13.5, 7, 0.5, 1, 'a');
    if (voll) r.set(5, 2, '0').set(6, 2, '0').set(6, 3, '0').set(7, 3, '0').set(4, 1, '9').set(5, 1, '9');
    // Wasserlinie: die untere Hälfte im Wasser (dunkler, Rand hell).
    for (let x = 0; x < 16; x++) for (let y = 9; y < 14; y++) if (r.get(x, y) !== '.') r.set(x, y, y === 9 ? 'Y' : 'x');
    r.outline('k');
    frames.push(r.toString());
  }
  return sprite({
    id: 'obj_reuse',
    group: GRUPPE,
    size: [16, 14],
    anchor: [8, 12],
    hoehe: 'block',
    legende: ICON_LEGENDE,
    frames,
    clips: { leer: { frames: [0], fps: 1 }, voll: { frames: [1], fps: 1 } },
    material: { nass: 'xY' },
    occluder: { kind: 'none' },
  });
})();

const EISLOCH = ((): Sprite => {
  const r = new Raster(16, 16);
  r.ellipse(8, 8, 5.5, 4.5, (_x, _y, t) => (t < 0.3 ? '9' : '0'));
  r.ellipse(8, 8.4, 4, 3.2, (_x, _y, t) => (t < 0.35 ? 'w' : 'x'));
  for (const [x, y] of [
    [2, 6],
    [13, 10],
    [5, 12],
  ] as const)
    r.set(x, y, '9').set(x + 1, y, '9');
  return sprite({ id: 'fang_eisloch', group: GRUPPE, size: [16, 16], anchor: [0, 0], hoehe: 'flach', legende: ICON_LEGENDE, frames: [r.toString()], schatten: 'none', occluder: { kind: 'none' }, material: { nass: 'wx' } });
})();

export default [POSE, SCHNUR, REUSE, EISLOCH];
