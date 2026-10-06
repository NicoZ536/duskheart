/**
 * Effekte der Weltereignisse (M7-39, M7-40; MASTERPROMPT §10 „Lumenregen (Sternschnuppen: glühende Scherben schlagen ein,
 * selten ein Meteorit …)“, „Blitze“; docs/SPIEL.md §18): alle emissiv, ohne Schatten, über allem gezeichnet
 * (`src/render/world/weltereignisScene.ts`).
 * - `fx_blitz`: der Blitz eines Einschlags – ein gezackter Kanal aus kaltem Weiß (`eis.4`) mit bläulichem Saum (`wasser.5`),
 *   zwei, drei Äste nach oben, am Fuß ein Spritzer. Anker am Fuß (der Einschlagpunkt); drei Formen (Frames), der Renderer
 *   wählt je Einschlag eine. 176 px hoch: aus dem oberen Bildrand bis zum Boden.
 * - `fx_sternschnuppe`: eine Sternschnuppe des Lumenregens und eine fallende Scherbe – heller Kopf, Schweif nach links oben,
 *   der in Wasserblau verglimmt. Anker am Kopf; zwei Frames (der Schweif flackert).
 * - `fx_meteor`: der Meteorit im Flug – glühender Kopf (`feuer.5`), Feuerschweif, darüber eine Rauchspur. Anker am Kopf.
 * - `fx_einschlag`: der Aufschlag einer Scherbe – ein Lichtring, der sich weitet und verlischt (Clip `aufschlag`).
 *
 * Die Kanäle sind aus einer festen Folge (LCG je Frame) gezogen, nicht von Hand gezeichnet: ein Blitz ist Zufall, aber
 * jeder Build zeichnet denselben.
 */
import { sprite } from '../../lib/sprite';

const GRUPPE = 'effekte';
const EINZEL = 'Blitzäste und Funken sind ein Pixel breit; ihr Saum steht diagonal';

/** Feste Zahlenfolge 0…1 (LCG) für einen Startwert. */
function folge(start: number): () => number {
  let s = start >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

/** Ein leeres Raster `w × h` aus `.`. */
function raster(w: number, h: number): string[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => '.'));
}

function setze(g: string[][], x: number, y: number, c: string, nurLeer = false): void {
  const row = g[y];
  if (row === undefined || x < 0 || x >= row.length) return;
  if (nurLeer && row[x] !== '.') return;
  row[x] = c;
}

function text(g: string[][]): string {
  return g.map((r) => r.join('')).join('\n');
}

const BLITZ_W = 40;
const BLITZ_H = 176;

/** Ein Blitzkanal: Kern `W`, Saum `w`, Äste `b`, Spritzer am Fuß. */
function blitz(start: number): string {
  const r = folge(start);
  const g = raster(BLITZ_W, BLITZ_H);
  const pts: Array<[number, number]> = [];
  let x = BLITZ_W >> 1;
  let y = BLITZ_H - 2;
  // Der Hauptkanal von unten nach oben: Abschnitte von 5–12 Zeilen mit eigener Neigung.
  while (y >= 0) {
    const len = 5 + Math.floor(r() * 8);
    const dx = r() < 0.5 ? -1 : 1;
    const steil = r() < 0.4;
    for (let i = 0; i < len && y >= 0; i++, y--) {
      if (!steil || i % 2 === 0) x = Math.max(4, Math.min(BLITZ_W - 5, x + dx));
      pts.push([x, y]);
    }
  }
  for (const [px, py] of pts) {
    setze(g, px, py, 'W');
  }
  for (const [px, py] of pts) {
    setze(g, px - 1, py, 'w', true);
    setze(g, px + 1, py, 'w', true);
  }
  // Äste aus dem oberen zwei Dritteln, schräg nach außen und oben.
  const aeste = 2 + Math.floor(r() * 2);
  for (let a = 0; a < aeste; a++) {
    const at = pts[Math.floor(pts.length * (0.3 + r() * 0.55))];
    if (at === undefined) continue;
    let [bx, by] = at;
    const richtung = r() < 0.5 ? -1 : 1;
    const len = 10 + Math.floor(r() * 18);
    for (let i = 0; i < len; i++) {
      by--;
      if (r() < 0.6) bx += richtung;
      if (bx < 1 || bx > BLITZ_W - 2 || by < 0) break;
      setze(g, bx, by, i < len / 2 ? 'b' : 'c', true);
    }
  }
  // Spritzer am Fuß.
  const fx = (pts[0] as [number, number])[0];
  for (const [dx, dy, c] of [
    [-3, 0, 'w'],
    [-2, -1, 'b'],
    [2, -1, 'b'],
    [3, 0, 'w'],
    [-1, 1, 'w'],
    [1, 1, 'w'],
    [0, 1, 'W'],
  ] as const)
    setze(g, fx + dx, BLITZ_H - 2 + dy, c);
  return text(g);
}

const SCHNUPPE_W = 24;
const SCHNUPPE_H = 12;

/** Sternschnuppe: Kopf rechts unten, Schweif nach links oben (2 : 1). */
function sternschnuppe(flacker: number): string {
  const g = raster(SCHNUPPE_W, SCHNUPPE_H);
  const kx = SCHNUPPE_W - 3;
  const ky = SCHNUPPE_H - 3;
  for (let i = 1; i < 20; i++) {
    const x = kx - i;
    const y = ky - Math.floor(i / 2);
    const c = i < 5 ? 'w' : i < 10 + flacker ? 'v' : i < 16 + flacker ? 'u' : (i + flacker) % 2 === 0 ? 'u' : '.';
    if (c !== '.') setze(g, x, y, c);
  }
  setze(g, kx, ky, 'W');
  setze(g, kx + 1, ky, 'W');
  setze(g, kx, ky + 1, 'W');
  setze(g, kx + 1, ky + 1, 'w');
  setze(g, kx - 1, ky + 1, 'v', true);
  setze(g, kx + 2, ky, 'v', true);
  setze(g, kx, ky - 1, 'v', true);
  return text(g);
}

const METEOR_W = 40;
const METEOR_H = 20;

/** Meteorit: glühender Kopf 3 × 3 rechts unten, Feuerschweif, darüber Rauch. */
function meteor(flacker: number): string {
  const g = raster(METEOR_W, METEOR_H);
  const kx = METEOR_W - 5;
  const ky = METEOR_H - 5;
  for (let i = 2; i < 34; i++) {
    const x = kx - i;
    const y = ky - Math.floor(i / 2);
    const breite = i < 8 ? 2 : i < 16 ? 1 : 0;
    const c = i < 7 ? 'O' : i < 14 + flacker ? 'o' : i < 22 ? 'r' : (i + flacker) % 2 === 0 ? 'r' : '.';
    for (let k = -breite; k <= breite; k++) if (c !== '.') setze(g, x, y + k, c, true);
    // Rauch über dem Schweif.
    if (i > 6 && (i + flacker) % 3 !== 0) setze(g, x + 1, y - breite - 2, i < 20 ? 's' : 't', true);
  }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) setze(g, kx + dx, ky + dy, dx === 0 || dy === 0 ? 'Y' : 'O');
  setze(g, kx + 2, ky, 'O');
  setze(g, kx, ky + 2, 'O');
  return text(g);
}

/** Aufschlag: Ring mit Radius `r` (flach 2 : 1). */
function ring(r: number, kern: boolean): string {
  const g = raster(24, 12);
  const cx = 12;
  const cy = 6;
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    setze(g, Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r * 0.5), r < 5 ? 'W' : r < 9 ? 'w' : 'v');
  }
  if (kern) {
    setze(g, cx, cy, 'W');
    setze(g, cx - 1, cy, 'w');
    setze(g, cx + 1, cy, 'w');
  }
  return text(g);
}

const LICHT = { '.': null, W: 'eis.4*', w: 'wasser.5*', v: 'wasser.4*', u: 'wasser.3*', b: 'eis.3*', c: 'wasser.4*' } as const;

export default [
  sprite({
    id: 'fx_blitz',
    group: GRUPPE,
    size: [BLITZ_W, BLITZ_H],
    anchor: [BLITZ_W >> 1, BLITZ_H - 2],
    hoehe: 'flach',
    legende: LICHT,
    frames: [blitz(0x51a7), blitz(0x2c3b), blitz(0x7e11)],
    schatten: 'none',
    occluder: { kind: 'none' },
    einzelpixel: EINZEL,
  }),
  sprite({
    id: 'fx_sternschnuppe',
    group: GRUPPE,
    size: [SCHNUPPE_W, SCHNUPPE_H],
    anchor: [SCHNUPPE_W - 3, SCHNUPPE_H - 3],
    hoehe: 'flach',
    legende: LICHT,
    frames: [sternschnuppe(0), sternschnuppe(1)],
    clips: { flug: { frames: [0, 1], fps: 12, loop: true } },
    schatten: 'none',
    occluder: { kind: 'none' },
    einzelpixel: EINZEL,
  }),
  sprite({
    id: 'fx_meteor',
    group: GRUPPE,
    size: [METEOR_W, METEOR_H],
    anchor: [METEOR_W - 5, METEOR_H - 5],
    hoehe: 'flach',
    legende: { '.': null, Y: 'feuer.5*', O: 'feuer.4*', o: 'feuer.3*', r: 'feuer.2*', s: 'stein.3', t: 'stein.2' },
    frames: [meteor(0), meteor(1)],
    clips: { flug: { frames: [0, 1], fps: 12, loop: true } },
    schatten: 'none',
    occluder: { kind: 'none' },
    einzelpixel: EINZEL,
  }),
  sprite({
    id: 'fx_einschlag',
    group: GRUPPE,
    size: [24, 12],
    anchor: [12, 6],
    hoehe: 'flach',
    legende: LICHT,
    frames: [ring(2, true), ring(5, true), ring(8, false), ring(10, false)],
    clips: { aufschlag: { frames: [0, 1, 2, 3], fps: 12, loop: false } },
    schatten: 'none',
    occluder: { kind: 'none' },
    einzelpixel: EINZEL,
  }),
];
