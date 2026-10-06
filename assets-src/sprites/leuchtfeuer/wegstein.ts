/**
 * Der Wegstein (`obj_wegstein`; MASTERPROMPT §25 „Schnellreise … Wegsteine“, §23.1; Item und Bauteil
 * src/content/items/leuchtfeuer.ts; M7-37, Strang F): ein behauener Stehstein auf einer Kachel des Bauraster, in Brusthöhe
 * der Figur ein Auge aus Lumen in einer gekerbten Fassung, darunter drei Kerbzeichen. Stein nach Himmelsöffnung (Kappe hell,
 * Flanken und Fuß dunkel), Kontur `nacht.1` wie jedes Möbel; das Auge leuchtet kühl (`eis.2*` – `eis.4*`, der Kern heller als
 * der Rand) und atmet langsam (Clip `idle`, 3 fps), damit er nachts als Reiseziel zu finden ist.
 *
 * 16 × 30, Anker = Mitte der Vorderkante `[8, 28]`.
 */
import { spriteFromPixels, type Sprite } from '../../lib/sprite';
import { Leinwand } from './_maler';

const W = 16;
const H = 30;
const FUSS = 28;

/** Halbbreite des Steins in Zeile `y` (oben gerundet, zum Fuß leicht breiter). */
function halb(y: number): number {
  const oben = 3;
  if (y < oben) return 0;
  const t = (y - oben) / (FUSS - oben);
  const kappe = Math.min(1, Math.sqrt(Math.max(0, (y - oben + 0.6) / 3.2)));
  return (4.6 + t * 1.6) * kappe;
}

function bild(auge: number): Leinwand {
  const l = new Leinwand(W, H);
  const cx = 7.5;
  for (let y = 0; y <= FUSS; y++) {
    const hb = halb(y);
    if (hb < 0.5) continue;
    for (let x = Math.floor(cx - hb); x <= Math.ceil(cx + hb); x++) {
      const u = (x + 0.5 - cx) / hb;
      if (Math.abs(u) > 1) continue;
      // Behauen, nicht gedrechselt: die Grenzen der Stufen wandern von Zeile zu Zeile (kein Banding).
      const au = Math.abs(u) + 0.12 * Math.sin(y * 1.7 + (u > 0 ? 1 : 0)) + 0.06 * Math.sin(y * 0.6);
      // Kappe hell, Flanken dunkler, zum Fuß hin eine Stufe tiefer (Umgebungsverdeckung).
      const kappe = y < 7;
      let c = kappe ? (au < 0.6 ? 'stein.4' : 'stein.3') : au < 0.45 ? 'stein.3' : au < 0.8 ? 'stein.2' : 'stein.1';
      if (y >= FUSS - 1) c = Math.abs(u) < 0.6 ? 'stein.1' : 'stein.0';
      l.set(x, y, c);
    }
  }
  // Fassung des Auges (gekerbter Ring) und das Auge.
  const ey = 12;
  for (const [dx, dy] of [
    [-2, -2], [-1, -3], [0, -3], [1, -2],
    [-3, -1], [-3, 0], [2, -1], [2, 0],
    [-2, 1], [-1, 2], [0, 2], [1, 1],
  ] as const)
    l.set(cx + dx, ey + dy, 'stein.0');
  const rand = auge >= 1 ? 'eis.3*' : 'eis.2*';
  const kern = auge > 0 ? 'eis.4*' : 'eis.3*';
  for (const [dx, dy] of [
    [-2, -1], [-1, -2], [0, -2], [1, -1],
    [-2, 0], [1, 0], [-1, 1], [0, 1],
  ] as const)
    l.set(cx + dx, ey + dy, rand);
  for (const [dx, dy] of [
    [-1, -1], [0, -1], [-1, 0], [0, 0],
  ] as const)
    l.set(cx + dx, ey + dy, kern);
  // Drei Kerbzeichen untereinander.
  for (const [x, y] of [
    [6, 17], [7, 17], [8, 18],
    [7, 20], [7, 21], [6, 21], [8, 21],
    [6, 24], [7, 23], [8, 24],
  ] as const)
    l.set(x, y, 'stein.1');
  l.kontur();
  return l;
}

const wegstein: Sprite = spriteFromPixels(
  {
    id: 'obj_wegstein',
    group: 'leuchtfeuer',
    size: [W, H],
    anchor: [8, FUSS],
    hoehe: 'zylinder',
    clips: { idle: { frames: [0, 1, 2, 1], fps: 3, loop: true } },
    sockets: { licht: [[7, 12]] },
    hitbox: [2, 2, 12, 27],
    occluder: { kind: 'ellipse', x: 8, y: 27, rx: 6, ry: 2 },
    schatten: 'silhouette',
    spiegelbar: true,
  },
  [bild(0), bild(0.6), bild(1)].map((l) => l.frame()),
);

export default wegstein;
