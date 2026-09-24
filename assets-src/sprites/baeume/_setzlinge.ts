/**
 * Setzlinge mit eigener Form (M2-20): Nadelbaum (drei kleine Etagen), Palme (Wedelbüschel aus dem
 * Boden), Zweigsetzling mit Büscheln (Aschebaum) und Kristall (Facettenblätter, leuchtend). Laubbaum-Setzlinge baut `_baukasten.ts` aus einer
 * kleinen Laubkrone. Zelle 16×24, Fuß in der vorletzten Zeile.
 */
import type { Rng } from '../../../src/engine/rng';
import { krone } from '../../lib/foliage';
import { MATERIAL_BITS } from '../../lib/sprite';
import { outlineOf } from '../../lib/foliageRelief';
import { maleKrone, type Bild, type KronenFarben, type RindenFarben } from '../../lib/tree';
import { halme } from '../../lib/foliageHalme';
import { etagenKrone } from '../../lib/treeKronen';

/** Zelle aller Setzlinge. */
export const SETZLING_W = 16;
export const SETZLING_H = 24;
const FUSS = SETZLING_H - 2;
const MITTE = SETZLING_W / 2;

/** Blätter der Setzlinge wiegen sich im Wind. */
const KRONE_WIND = MATERIAL_BITS.wind;

/** Kontur um `mask` auf leeren Pixeln. */
function konturAussen(b: Bild, mask: Uint8Array, farbe: string): void {
  outlineOf(mask, b.w, b.h).forEach((v, q) => {
    if (v > 0 && (b.index[q] ?? 0) === 0) b.set(q % b.w, Math.floor(q / b.w), farbe, KRONE_WIND, 1);
  });
}

/** Stämmchen: 1 px Mitte zwischen zwei Konturpixeln, unten Bodenkontakt in der Kontur. */
function staemmchen(b: Bild, f: RindenFarben, oben: number): void {
  for (let y = oben; y <= FUSS; y++) {
    b.set(MITTE - 1, y, f.kontur);
    b.set(MITTE, y, y === FUSS ? f.kontur : f.mitte);
    b.set(MITTE + 1, y, f.kontur);
  }
}

/** Nadelbaum-Setzling: drei Etagen über einem kurzen Stämmchen. */
export function nadelSetzling(f: RindenFarben, farben: KronenFarben) {
  return (b: Bild, rng: Rng): void => {
    staemmchen(b, f, FUSS - 4);
    const k = etagenKrone(rng, SETZLING_W, SETZLING_H, { x: MITTE, spitze: 3, unten: FUSS - 5, breite: 5.5, etagen: 3, zacken: 1, haengen: 1 });
    maleKrone(b, k, farben, 2);
  };
}

/** Palmen-Setzling: junge Palme als Fächer aus fünf bandförmigen Blättern, je 2 px breit (Lichtseite links). */
export function palmSetzling(f: RindenFarben, farben: KronenFarben) {
  return (b: Bild): void => {
    staemmchen(b, f, FUSS - 2);
    const blaetter = [
      { dx: 0, hoehe: 16, neigung: 1, kruemmung: 1.5 },
      { dx: -1, hoehe: 13, neigung: -5, kruemmung: 1.5 },
      { dx: 1, hoehe: 12, neigung: 3, kruemmung: 1.5 },
      { dx: -1, hoehe: 8, neigung: -5, kruemmung: 1 },
      { dx: 1, hoehe: 7, neigung: 4, kruemmung: 1 },
    ];
    const vorher = Uint8Array.from(b.index);
    const [s0, s1, s2, s3, s4] = farben.stufen;
    halme(b, MITTE + 1, FUSS - 2, blaetter, [s0, s1, s1, s2], KRONE_WIND);
    halme(b, MITTE, FUSS - 2, blaetter, [s1, s2, s3, s4], KRONE_WIND);
    const neu = Uint8Array.from(b.index, (v, q) => (v !== 0 && v !== vorher[q] ? 1 : 0));
    konturAussen(b, neu, farben.kontur);
  };
}

/** Zweigiger Setzling mit kleinen Büscheln an den Zweigenden (Aschebaum). */
export function zweigSetzling(f: RindenFarben, farben: KronenFarben) {
  return (b: Bild, rng: Rng): void => {
    staemmchen(b, f, 12);
    for (const [x0, y0, x1, y1] of [
      [8, 15, 4, 11],
      [8, 13, 12, 9],
    ] as const) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= n; i++) b.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), f.mitte);
    }
    const k = krone(rng, SETZLING_W, SETZLING_H, {
      buendel: 0,
      massen: [
        { x: 8, y: 6, rx: 2.5, ry: 2 },
        { x: 3.5, y: 10, rx: 2, ry: 1.7 },
        { x: 12.5, y: 8, rx: 2, ry: 1.7 },
      ],
    });
    maleKrone(b, k, farben, 2);
  };
}

/** Kristall-Setzling: Stämmchen mit drei leuchtenden Facettenblättern. */
export function kristallSetzling(f: RindenFarben, farben: KronenFarben) {
  return (b: Bild, rng: Rng): void => {
    staemmchen(b, f, FUSS - 8);
    const k = krone(rng, SETZLING_W, SETZLING_H, {
      form: 'kristall',
      buendel: 0,
      massen: [
        { x: MITTE, y: 8, rx: 3.5, ry: 5 },
        { x: MITTE - 3.5, y: 13, rx: 2.5, ry: 3.5 },
        { x: MITTE + 3.5, y: 12, rx: 2.5, ry: 3.5 },
      ],
      schwellen: [0.3, 0.45, 0.6, 0.78],
    });
    maleKrone(b, k, farben, 2);
  };
}
