/**
 * Kristallknoten (M2-21, docs/WORLD.md §7 `kristall_<art>`): drei bis fünf Prismen verschiedener Höhe
 * und Neigung aus einem kleinen Felssockel, 24×32, Fuß in der untersten Konturzeile. Die Prismen tragen
 * ihre Farbe in Rampen, die keine Biomzeile ändert; der Sockel ist Grünhain-Stein und wird über die
 * Biomzeile getönt (`objektZeile`). Leuchtende Kristalle (Glut, Lumen, Prisma, Leere, Tiefen) sind
 * emissiv – der Grat heller als die Facetten; Eis spiegelt nur (Materialflag Eis).
 */
import type { Rng } from '../../../src/engine/rng';
import { defineGenerator } from '../../lib/generator';
import { STEIN, STEIN_SCHLICHT, fels, felsSprite, maleFels, prisma, type PrismaFarben } from '../../lib/rock';
import { Bild, saeubere } from '../../lib/tree';
import type { Sprite } from '../../lib/sprite';

const GRUPPE = 'gestein';
const W = 24;
const H = 32;

interface Kristallart {
  readonly art: string;
  /** Farben je Prisma (zyklisch). */
  readonly farben: readonly PrismaFarben[];
  /** Prismen: x, Fuß, Höhe, Breite, Neigung (hinten → vorn). */
  readonly prismen: ReadonlyArray<readonly [number, number, number, number, number]>;
  /** Sockelfarben (Prismen mit vielen Farben: sparsamer Stein). */
  readonly sockel?: typeof STEIN;
}

const STANDARD: Kristallart['prismen'] = [
  [9, 25, 16, 4, -0.3],
  [15, 24, 20, 5, 0.12],
  [12, 27, 11, 4, -0.05],
  [18, 27, 9, 3, 0.45],
];

const ARTEN: readonly Kristallart[] = [
  { art: 'eis', farben: [{ kontur: 'wasser.2', dunkel: 'eis.0', mitte: 'eis.1', licht: 'eis.3', kern: 'eis.4' }], prismen: STANDARD },
  { art: 'glut', farben: [{ kontur: 'feuer.0', dunkel: 'feuer.1', mitte: 'feuer.2*', licht: 'feuer.3*', kern: 'feuer.4*' }], prismen: STANDARD },
  { art: 'lumen', farben: [{ kontur: 'wasser.1', dunkel: 'wasser.3', mitte: 'wasser.4*', licht: 'wasser.5*', kern: 'eis.4*' }], prismen: STANDARD },
  {
    art: 'prisma',
    farben: [
      { kontur: 'stein.0', dunkel: 'verderb.3', mitte: 'verderb.4*', licht: 'eis.4*', kern: 'eis.4*' },
      { kontur: 'stein.0', dunkel: 'wasser.4', mitte: 'wasser.5*', licht: 'eis.4*', kern: 'eis.4*' },
      { kontur: 'stein.0', dunkel: 'sand.3', mitte: 'sand.4*', licht: 'eis.4*', kern: 'eis.4*' },
    ],
    prismen: STANDARD,
    sockel: STEIN_SCHLICHT,
  },
  { art: 'leere', farben: [{ kontur: 'nacht.0', dunkel: 'verderb.0', mitte: 'verderb.1', licht: 'verderb.2', kern: 'verderb.4*' }], prismen: STANDARD },
  { art: 'tiefen', farben: [{ kontur: 'wasser.0', dunkel: 'wasser.1', mitte: 'wasser.2', licht: 'wasser.3*', kern: 'eis.2*' }], prismen: STANDARD },
];

function kristallBild(rng: Rng, k: Kristallart): Bild {
  const b = new Bild(W, H);
  const sockel = fels(rng, {
    w: W,
    h: H,
    form: 'kantig',
    bloecke: [
      { x: 12, y: 26, rx: 9, ry: 4, hoch: 4 },
      { x: 5, y: 28, rx: 3, ry: 2, hoch: 2 },
    ],
  });
  maleFels(b, sockel, k.sockel ?? STEIN);
  k.prismen.forEach(([x, fuss, hoehe, breite, neigung], i) => {
    const f = k.farben[i % k.farben.length];
    if (f !== undefined) prisma(b, x, fuss, hoehe * rng.float(0.9, 1.05), breite, neigung, f);
  });
  saeubere(b);
  return b;
}

export default defineGenerator('kristalle', (rng: Rng): Sprite[] => ARTEN.map((k) => felsSprite(`kristall_${k.art}`, GRUPPE, [kristallBild(rng, k)]))).generate(202, undefined);
