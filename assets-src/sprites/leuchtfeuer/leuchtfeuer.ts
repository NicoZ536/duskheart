/**
 * Das Leuchtfeuer (MASTERPROMPT §8 „Je Biom ein Leuchtfeuer … Entzünden → die Region heilt sichtbar“, §23.1; docs/SPIEL.md
 * §22; M7-35, Strang F): `leuchtfeuer` – die Feuerschale der Erbauer auf einer Säule, mitten auf der gepflasterten Stätte
 * (Marke `leuchtfeuer` der Vorlage von Strang B; gezeichnet von src/render/game/beacons.ts).
 *
 * 56 × 116, Anker = Mitte der Vorderkante des Sockels `[28, 112]` (12 px Luft oben für die Stichflamme). Aufbau von unten: zweistufiger runder Sockel aus
 * behauenem Stein (Fugen in der Front), eine Säule mit Steinlagen und einem Runenband, ein Kapitell, darauf die weite
 * Schale. Steine in `stein.0`–`stein.4` nach Himmelsöffnung (Deckflächen hell, Fronten mittel, Fußzeilen dunkel), Kontur
 * `nacht.1` um den Stein – die Flamme hat keine Kontur, sie leuchtet (wie `brand`).
 *
 * Clips (Zustände des Systems `beacons`):
 * - `erloschen` – kalte Asche in der Schale, die Runen sind tote Kerben (`stein.1`);
 * - `bereit` – der Wächter ist besiegt: Glutnester in der Asche atmen, die Runen glimmen auf (`eis.3*`), 4 fps;
 * - `entzuenden` – Glut → Zunge → Stichflamme weit über die Schale → die Flamme setzt sich, 10 fps, ohne Schleife
 *   (Events `flamme` beim Aufschlagen, `voll` am Ende);
 * - `brennend` – die volle Flamme, sechs Formen (Ruhe, Ducken, Strecken mit abreißender Zunge, Neigen rechts, zwei Zungen,
 *   Neigen links) 12 fps, Lumen-Funken steigen, die Runen leuchten.
 * Die Flamme entsteht je Frame aus einem Profil (Breite über der Höhe, Neigung, Zungen); ihre Stufen liegen nach dem Abstand
 * zur Mittellinie – außen `feuer.1`/`feuer.2`, innen `feuer.4`, der Kern unten `feuer.5`: der Kern ist heller als der Rand
 * (docs/ART.md §9 Punkt 9). Sockel `licht` im Flammenkern (Schale bei Glut und Asche).
 */
import { paletteIndex } from '../../palette';
import { spriteFromPixels, type PixelFrameInput, type Sprite } from '../../lib/sprite';
import { inEllipse, Leinwand } from './_maler';

const W = 56;
/** Luft über der Stätte für die Stichflamme beim Entzünden [px]. */
const Y0 = 12;
const H = 104 + Y0;
const ANKER: [number, number] = [28, 100 + Y0];
/** Mitte der Schale (Fußpunkt der Flamme). */
const SCHALE: [number, number] = [27.5, 40 + Y0];

/** Kontaktbogen `leuchtfeuer.png` (Ordnergruppe). */
const GRUPPE = 'leuchtfeuer';

/**
 * Ein runder Steinkörper: Deckfläche (Ellipse um `cy`), darunter die Front von `hoehe` px. Die Front ist ein Zylinder: Mitte
 * heller, Ränder dunkler, die unterste Zeile im Schatten; Fugen alle `fuge` px (versetzt je Lage).
 */
function trommel(l: Leinwand, cx: number, cy: number, rx: number, ry: number, hoehe: number, fuge: number, versatz: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry + hoehe); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const oben = inEllipse(x, y, cx, cy, rx, ry);
      const front = !oben && inEllipse(x, y - Math.min(hoehe, Math.max(0, y - cy)), cx, cy, rx, ry) && y > cy;
      if (!oben && !front) continue;
      const u = (x + 0.5 - cx) / rx;
      if (oben) {
        // Deckfläche: hinten (oben) am hellsten, zur Vorderkante eine Stufe tiefer.
        const v = (y + 0.5 - cy) / ry;
        l.set(x, y, v < 0.2 ? 'stein.4' : 'stein.3');
        continue;
      }
      // Front: Abstand zur Unterkante bestimmt die Fußschattenzeile.
      const unten = !inEllipse(x, y + 1 - hoehe, cx, cy, rx, ry) || y + 1 > cy + ry + hoehe;
      let c = Math.abs(u) < 0.45 ? 'stein.3' : Math.abs(u) < 0.8 ? 'stein.2' : 'stein.1';
      if (unten) c = 'stein.1';
      const fugeX = Math.round(cx + versatz) + Math.round((x - cx - versatz) / fuge) * fuge;
      if (x === fugeX && Math.abs(u) < 0.92 && !unten) c = 'stein.1';
      l.set(x, y, c);
    }
}

/** Die Säule mit Steinlagen und dem Runenband. */
function saeule(l: Leinwand, runen: 'tot' | 'glimmt' | 'leuchtet', phase: number): void {
  const cx = 27.5;
  const rx = 9.5;
  const oben = 50 + Y0;
  const unten = 80 + Y0;
  for (let y = oben; y <= unten; y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const u = (x + 0.5 - cx) / rx;
      if (Math.abs(u) > 1) continue;
      let c = Math.abs(u) < 0.35 ? 'stein.3' : Math.abs(u) < 0.75 ? 'stein.2' : 'stein.1';
      // Lagen: alle 8 px eine Fuge, die Stoßfugen je Lage versetzt.
      const lage = Math.floor((y - oben) / 8);
      if ((y - oben) % 8 === 7) c = 'stein.1';
      const stoss = Math.round(cx + (lage % 2 === 0 ? -4 : 4));
      if (x === stoss && (y - oben) % 8 !== 7) c = 'stein.1';
      l.set(x, y, c);
    }
  // Runenband: fünf Zeichen aus Kerben, je 3 × 4 px, mittig auf der Front.
  const ZEICHEN = [
    ['x.x', '.x.', 'x.x', '.x.'],
    ['xx.', 'x..', 'xx.', 'x..'],
    ['.x.', 'xxx', '.x.', '.x.'],
    ['x..', 'xx.', 'x.x', 'x..'],
    ['.xx', '..x', '.xx', '..x'],
  ];
  const y0 = 61 + Y0;
  ZEICHEN.forEach((z, i) => {
    const x0 = Math.round(cx) - 9 + i * 4 - 1;
    const an = runen === 'leuchtet' || (runen === 'glimmt' && (i + phase) % 2 === 0);
    z.forEach((zeile, dy) =>
      [...zeile].forEach((ch, dx) => {
        if (ch === 'x') l.set(x0 + dx, y0 + dy, an ? 'eis.3*' : 'stein.0');
      }),
    );
  });
}

/** Die Schale: Rand, Bauch und die Mulde mit Asche (und Glut). */
function schale(l: Leinwand, glut: number, phase: number): void {
  const [cx, cy] = SCHALE;
  // Bauch: unter dem Rand bis zum Kapitell, nach unten schmaler.
  const fuss = 48 + Y0;
  for (let y = Math.floor(cy); y <= fuss; y++) {
    const t = (y - cy) / (fuss - cy);
    const rx = 18 - t * 7;
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const u = (x + 0.5 - cx) / rx;
      if (Math.abs(u) > 1) continue;
      let c = Math.abs(u) < 0.4 ? 'stein.2' : 'stein.1';
      if (y === fuss || t > 0.85) c = 'stein.0';
      // Ein Zierband aus Buckeln unter dem Rand.
      if (y === Math.floor(cy) + 3 && Math.round(x - cx) % 4 === 0) c = 'stein.3';
      l.set(x, y, c);
    }
  }
  // Rand und Mulde.
  for (let y = Math.floor(cy - 6); y <= Math.ceil(cy + 6); y++)
    for (let x = Math.floor(cx - 18); x <= Math.ceil(cx + 18); x++) {
      if (!inEllipse(x, y, cx, cy, 18, 5.5)) continue;
      const innen = inEllipse(x, y, cx, cy - 0.5, 15, 3.8);
      if (!innen) {
        const v = (y + 0.5 - cy) / 5.5;
        l.set(x, y, v < 0 ? 'stein.4' : 'stein.3');
        continue;
      }
      // Asche: dunkle Mulde, hinten eine hellere Ascheschicht.
      const v = (y + 0.5 - (cy - 0.5)) / 3.8;
      l.set(x, y, v < -0.3 ? 'stein.0' : 'stein.1');
    }
  // Glutnester in der Asche (Paare, damit nichts verwaist).
  if (glut > 0) {
    const NESTER: readonly (readonly [number, number])[] = [
      [-8, 0],
      [-3, 1],
      [2, 0],
      [7, 1],
      [-5, -1],
      [5, -1],
    ];
    NESTER.forEach(([dx, dy], i) => {
      if (i >= Math.ceil(glut * NESTER.length)) return;
      const hell = (i + phase) % 3 === 0;
      l.set(cx + dx, cy + dy, hell ? 'feuer.4*' : 'feuer.2*');
      l.set(cx + dx + 1, cy + dy, hell ? 'feuer.3*' : 'feuer.2*');
    });
  }
}

/** Stein der ganzen Stätte (ohne Flamme), mit Kontur. */
function stein(runen: 'tot' | 'glimmt' | 'leuchtet', glut: number, phase: number): Leinwand {
  const l = new Leinwand(W, H);
  trommel(l, 27.5, 88 + Y0, 22, 6.5, 6, 7, 0);
  trommel(l, 27.5, 81.5 + Y0, 16.5, 5, 5, 6, 3);
  saeule(l, runen, phase);
  trommel(l, 27.5, 49 + Y0, 13, 4, 3, 5, 2);
  schale(l, glut, phase);
  l.kontur();
  return l;
}

/** Profil einer Flamme: Höhe, größte Halbbreite, Neigung der Spitze, Wellenphase. */
interface Flamme {
  readonly hoehe: number;
  readonly breite: number;
  readonly neigung: number;
  readonly welle: number;
  /** Seitenzungen: Versatz und relative Höhe (0 = keine). */
  readonly zungen: readonly (readonly [number, number])[];
  /** Abreißende Zunge über der Spitze (px Abstand, 0 = keine). */
  readonly abriss: number;
}

/** Farbstufe nach Abstand zur Mittellinie `d` (0 … 1) und Höhe `t` (0 Fuß … 1 Spitze). */
function flammenStufe(d: number, t: number): string {
  if (d < 0.34 && t < 0.42) return 'feuer.5*';
  if (d < 0.58 && t < 0.68) return 'feuer.4*';
  if (d < 0.8 && t < 0.88) return 'feuer.3*';
  if (d < 0.93) return 'feuer.2*';
  return 'feuer.1*';
}

function zungenProfil(l: Leinwand, fx: number, fy: number, hoehe: number, breite: number, neigung: number, welle: number, kern: boolean): void {
  if (hoehe < 2) return;
  for (let y = 0; y < hoehe; y++) {
    const t = y / hoehe;
    const halb = breite * Math.pow(1 - t, 0.85) * Math.pow(Math.min(1, t * 3.5 + 0.4), 0.5);
    if (halb < 0.5) continue;
    const mitte = fx + neigung * Math.pow(t, 1.6) + Math.sin(2 * Math.PI * (t * 1.2 + welle)) * 1.1 * t;
    for (let x = Math.floor(mitte - halb - 1); x <= Math.ceil(mitte + halb + 1); x++) {
      const d = Math.abs(x + 0.5 - mitte) / halb;
      if (d > 1) continue;
      const py = Math.round(fy - y);
      const i = py * W + x;
      // Eine Zunge legt sich nie über einen helleren Kern.
      const stufe = flammenStufe(kern ? d : Math.max(d, 0.6), t);
      if (l.belegt(x, py) && l.emissive[i] === 1 && rang(l.index[i] ?? 0) >= rang(paletteIndex(stufe.slice(0, -1)))) continue;
      l.set(x, py, stufe);
    }
  }
}

const RANG = ['feuer.1', 'feuer.2', 'feuer.3', 'feuer.4', 'feuer.5'].map((r) => paletteIndex(r));
function rang(index: number): number {
  return RANG.indexOf(index);
}

/** Zeichnet eine Flamme in die Schale. */
function flamme(l: Leinwand, f: Flamme, funken: number): void {
  const [cx, cy] = SCHALE;
  for (const [dx, rel] of f.zungen) if (rel > 0) zungenProfil(l, cx + dx, cy - 1, f.hoehe * rel, f.breite * 0.42, f.neigung * 0.6 + dx * 0.3, f.welle + 0.3, false);
  zungenProfil(l, cx, cy - 1, f.hoehe, f.breite, f.neigung, f.welle, true);
  if (f.abriss > 0) {
    const sx = cx + f.neigung;
    const sy = cy - 1 - f.hoehe - f.abriss;
    for (const [dx, dy, r] of [
      [0, 0, 'feuer.2*'],
      [0, 1, 'feuer.3*'],
      [1, 1, 'feuer.2*'],
      [0, 2, 'feuer.2*'],
    ] as const)
      l.set(sx + dx, sy + dy, r);
  }
  // Lumen-Funken: kleine Paare, die über der Flamme steigen.
  const FUNKEN: readonly (readonly [number, number])[] = [
    [-9, 0.62],
    [8, 0.78],
    [-4, 0.95],
    [11, 0.5],
  ];
  FUNKEN.forEach(([dx, rel], i) => {
    if (i >= funken) return;
    const y = cy - f.hoehe * rel - ((i * 7) % 5);
    l.set(cx + dx, y, 'eis.3*');
    l.set(cx + dx, y - 1, 'eis.3*');
  });
}

const VOLL = { hoehe: 34, breite: 9.5 } as const;
const BRENNEN: readonly Flamme[] = [
  { ...VOLL, neigung: 0, welle: 0, zungen: [[-6, 0.5], [6, 0.45]], abriss: 0 },
  { hoehe: 30, breite: 10, neigung: 0, welle: 0.15, zungen: [[-6, 0.45], [6, 0.5]], abriss: 0 },
  { hoehe: 36, breite: 9, neigung: 1, welle: 0.3, zungen: [[-6, 0.55], [7, 0.4]], abriss: 3 },
  { ...VOLL, neigung: 3, welle: 0.45, zungen: [[-5, 0.4], [7, 0.55]], abriss: 0 },
  { ...VOLL, neigung: 0, welle: 0.6, zungen: [[-7, 0.62], [6, 0.6]], abriss: 0 },
  { ...VOLL, neigung: -3, welle: 0.8, zungen: [[-7, 0.55], [5, 0.4]], abriss: 0 },
];

function bild(runen: 'tot' | 'glimmt' | 'leuchtet', glut: number, phase: number, f: Flamme | null, funken = 0): PixelFrameInput {
  const l = stein(runen, glut, phase);
  if (f !== null) flamme(l, f, funken);
  return l.frame();
}

function leuchtfeuer(): Sprite {
  const frames: PixelFrameInput[] = [];
  const auf = (fr: PixelFrameInput): number => frames.push(fr) - 1;
  const kalt = auf(bild('tot', 0, 0, null));
  const bereit = [auf(bild('glimmt', 0.5, 0, null)), auf(bild('glimmt', 1, 1, null))];
  const entzuenden = [
    auf(bild('glimmt', 1, 2, { hoehe: 6, breite: 4, neigung: 0, welle: 0, zungen: [], abriss: 0 })),
    auf(bild('leuchtet', 1, 0, { hoehe: 14, breite: 6, neigung: 1, welle: 0.2, zungen: [[-4, 0.5]], abriss: 0 })),
    auf(bild('leuchtet', 1, 1, { hoehe: 26, breite: 8, neigung: -1, welle: 0.4, zungen: [[-5, 0.5], [5, 0.45]], abriss: 0 }, 2)),
    auf(bild('leuchtet', 1, 0, { hoehe: 46, breite: 12, neigung: 0, welle: 0.1, zungen: [[-8, 0.55], [8, 0.6]], abriss: 4 }, 4)),
    auf(bild('leuchtet', 1, 1, { hoehe: 42, breite: 11, neigung: 1, welle: 0.5, zungen: [[-8, 0.6], [8, 0.5]], abriss: 0 }, 4)),
  ];
  const brennend = BRENNEN.map((f, i) => auf(bild('leuchtet', 1, i % 3, f, 2 + (i % 3))));
  const lichtSchale: [number, number] = [28, 39 + Y0];
  const lichtFlamme: [number, number] = [28, 32 + Y0];
  const licht: [number, number][] = frames.map((_, i) => (i <= bereit[1]! ? lichtSchale : i === entzuenden[0] ? [28, 37 + Y0] : lichtFlamme));
  return spriteFromPixels(
    {
      id: 'leuchtfeuer',
      group: GRUPPE,
      size: [W, H],
      anchor: ANKER,
      hoehe: 'zylinder',
      clips: {
        erloschen: { frames: [kalt], fps: 1, loop: true },
        bereit: { frames: [bereit[0]!, bereit[1]!], fps: 4, loop: true },
        entzuenden: {
          frames: [...entzuenden, entzuenden[3]!, entzuenden[4]!, brennend[0]!],
          fps: 10,
          loop: false,
          events: [
            { frame: 1, name: 'flamme' },
            { frame: 7, name: 'voll' },
          ],
        },
        brennend: { frames: brennend, fps: 12, loop: true },
      },
      sockets: { licht },
      hitbox: [5, 34 + Y0, 46, 62],
      occluder: { kind: 'ellipse', x: 28, y: 89 + Y0, rx: 21, ry: 6 },
      schatten: 'silhouette',
      spiegelbar: false,
      einzelpixel: 'Glutnester, Lumen-Funken und die abreißende Flammenzunge sind kleine leuchtende Tupfer',
    },
    frames,
  );
}

export default leuchtfeuer();
