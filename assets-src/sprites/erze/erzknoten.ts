/**
 * Erzknoten (M2-21, docs/WORLD.md §7 `erz_<erz>`, alle 16 Erze aus `src/content/ores.ts`): ein Brocken
 * Wirtsgestein (24×24, Grünhain-Stein, über die Biomzeile getönt) mit Erz in einer eigenen, bei 16–32 px
 * lesbaren Farbe und Form: Nuggets (Kupfer, Gold, Raseneisen), Adern (Eisen, Silber, Nachtstahl, Magmit),
 * Kristalle (Klarquarz, Edelstein, Lumenit, Prismenquarz), Krusten (Salpeter, Schwefel) oder ganze
 * Brocken (Kohle, Obsidian, Zinnstein). Erzfarben stehen in Rampen, die keine Biomzeile ändert. Magisch
 * und deshalb emissiv: Magmit (Glut), Lumenit (türkis), Prismenquarz (prismatisch).
 */
import type { Rng } from '../../../src/engine/rng';
import { defineGenerator } from '../../lib/generator';
import { GLANZ, METALL, STEIN, STEIN_SCHLICHT, deckschicht, fels, felsSprite, maleFels, prisma, type Fels, type PrismaFarben } from '../../lib/rock';
import { Bild, saeubere } from '../../lib/tree';
import type { Sprite } from '../../lib/sprite';

const GRUPPE = 'erze';
const W = 24;
const H = 24;

/** Nugget-Farben: Schatten, Körper, Glanz. */
type Drei = readonly [string, string, string];

/**
 * Nuggets: runde 3×3-Klumpen (Ecke oben rechts frei) und 2×2-Klumpen auf Front und Oberseite; Glanz oben
 * links, Schatten in der unteren Zeile, darunter ein Kontaktschatten im Gestein.
 */
function nuggets(b: Bild, f: Fels, rng: Rng, farben: Drei, anzahl: number, material: number): void {
  const plaetze: Array<[number, number]> = [];
  f.relief.mask.forEach((v, q) => {
    const x = q % W;
    const y = Math.floor(q / W);
    if (v > 0 && x > 2 && x < W - 5 && y > 4 && y < H - 6 && (f.relief.mask[q + 3 * W] ?? 0) > 0 && (f.relief.mask[q + 3] ?? 0) > 0) plaetze.push([x, y]);
  });
  rng.shuffle(plaetze);
  const gesetzt: Array<[number, number]> = [];
  for (const [x, y] of plaetze) {
    if (gesetzt.length >= anzahl) break;
    if (!gesetzt.every(([gx, gy]) => Math.abs(gx - x) > 4 || Math.abs(gy - y) > 3)) continue;
    gesetzt.push([x, y]);
    const gross = gesetzt.length % 3 !== 0;
    const form: ReadonlyArray<readonly [number, number, number]> = gross
      ? [
          [0, 0, 2],
          [1, 0, 1],
          [0, 1, 1],
          [1, 1, 1],
          [2, 1, 1],
          [0, 2, 0],
          [1, 2, 0],
          [2, 2, 0],
        ]
      : [
          [0, 0, 2],
          [1, 0, 1],
          [0, 1, 0],
          [1, 1, 0],
        ];
    for (const [dx, dy, s] of form) b.set(x + dx, y + dy, farben[s] ?? farben[1], material, (f.relief.height[(y + dy) * W + x + dx] ?? 0) + 1.5);
    const unten = gross ? 3 : 2;
    for (let dx = 0; dx < (gross ? 3 : 2); dx++) if ((f.relief.mask[(y + unten) * W + x + dx] ?? 0) > 0) b.set(x + dx, y + unten, STEIN.kontur, 0, f.relief.height[(y + unten) * W + x + dx] ?? 0);
  }
}

/** Adern: 2–3 px dicke Zickzack-Bänder schräg über die Front (Kern hell, Unterkante dunkel). */
function adern(b: Bild, f: Fels, rng: Rng, farben: Drei, anzahl: number, material: number): void {
  for (let a = 0; a < anzahl; a++) {
    let x = 3 + a * 5 + rng.int(0, 3);
    let y = rng.int(7, 10) + a * 2;
    for (let i = 0; i < 16; i++) {
      const q = y * W + x;
      if ((f.relief.mask[q] ?? 0) > 0 && (f.relief.mask[q + 2 * W] ?? 0) > 0) {
        const z = f.relief.height[q] ?? 0;
        b.set(x, y, farben[i % 4 === 1 ? 2 : 1], material, z + 1);
        b.set(x, y + 1, farben[1], material, z + 1);
        b.set(x, y + 2, farben[0], material, z);
      }
      x += 1;
      if (i % 3 === 2) y += rng.bool(0.65) ? 1 : -1;
      y = Math.max(5, Math.min(H - 6, y));
    }
  }
}

interface Erzart {
  readonly erz: string;
  readonly form: 'rund' | 'kantig';
  /** Wirtsgestein dunkler (Kohle, Obsidian) oder wie gezeichnet. */
  readonly gestein?: typeof STEIN;
  readonly zeichne: (b: Bild, f: Fels, rng: Rng) => void;
  readonly einzelpixel?: string;
}

const DUNKEL: typeof STEIN = { kontur: 'stein.0', stufen: ['stein.0', 'stein.1', 'stein.2', 'stein.3'] };

const kristall = (kontur: string, dunkel: string, mitte: string, licht: string, kern: string): PrismaFarben => ({ kontur, dunkel, mitte, licht, kern });

const ERZE: readonly Erzart[] = [
  { erz: 'kupfer', form: 'rund', zeichne: (b, f, rng) => {
    nuggets(b, f, rng, ['haut.2', 'feuer.2', 'haut.3'], 7, METALL);
    // Grünspan: kleine Patina-Flecken neben den Nuggets.
    deckschicht(b, f, ['wasser.3', 'wasser.4'], 2, 1.5, rng);
  } },
  { erz: 'zinn', form: 'kantig', zeichne: (b, f, rng) => nuggets(b, f, rng, ['nacht.4', 'eis.0', 'eis.2'], 8, METALL) },
  { erz: 'raseneisen', form: 'rund', zeichne: (b, f, rng) => {
    deckschicht(b, f, ['sand.0', 'haut.1'], 3, 3, rng);
    nuggets(b, f, rng, ['haut.0', 'haut.1', 'sand.1'], 4, METALL);
  } },
  { erz: 'eisen', form: 'kantig', zeichne: (b, f, rng) => adern(b, f, rng, ['feuer.0', 'feuer.1', 'haut.2'], 3, METALL) },
  { erz: 'salpeter', form: 'rund', zeichne: (b, f, rng) => {
    deckschicht(b, f, ['sand.3', 'eis.4'], 0, 0, rng);
    nuggets(b, f, rng, ['sand.3', 'sand.4', 'eis.4'], 3, 0);
  } },
  { erz: 'kohle', form: 'kantig', gestein: DUNKEL, zeichne: (b, f, rng) => nuggets(b, f, rng, ['nacht.0', 'nacht.0', 'nacht.4'], 9, GLANZ) },
  { erz: 'silber', form: 'kantig', zeichne: (b, f, rng) => adern(b, f, rng, ['nacht.3', 'eis.2', 'eis.4'], 3, METALL) },
  { erz: 'gold', form: 'rund', zeichne: (b, f, rng) => nuggets(b, f, rng, ['feuer.3', 'feuer.4', 'feuer.5'], 7, METALL) },
  { erz: 'klarquarz', form: 'kantig', zeichne: (b) => {
    const k = kristall('stein.0', 'eis.1', 'eis.2', 'eis.3', 'eis.4');
    prisma(b, 8, 12, 8, 3, -0.4, k);
    prisma(b, 13, 11, 10, 3, 0.1, k);
    prisma(b, 17, 13, 7, 3, 0.5, k);
  } },
  { erz: 'edelstein', form: 'kantig', gestein: STEIN_SCHLICHT, zeichne: (b) => {
    prisma(b, 8, 13, 6, 3, -0.35, kristall('stein.0', 'feuer.1', 'feuer.1', 'feuer.2', 'eis.4'));
    prisma(b, 13, 12, 8, 3, 0.05, kristall('stein.0', 'wasser.2', 'wasser.2', 'wasser.4', 'eis.4'));
    prisma(b, 17, 15, 5, 3, 0.45, kristall('stein.0', 'verderb.2', 'verderb.2', 'verderb.4', 'eis.4'));
  } },
  { erz: 'obsidian', form: 'kantig', gestein: DUNKEL, zeichne: (b) => {
    const k = kristall('nacht.0', 'nacht.0', 'nacht.1', 'verderb.2', 'eis.1');
    prisma(b, 7, 15, 7, 4, -0.5, k);
    prisma(b, 13, 14, 9, 5, 0.1, k);
    prisma(b, 18, 16, 6, 4, 0.55, k);
  } },
  { erz: 'schwefel', form: 'rund', zeichne: (b, f, rng) => {
    deckschicht(b, f, ['sand.2', 'sand.4'], 0, 0, rng);
    nuggets(b, f, rng, ['sand.2', 'sand.3', 'feuer.5'], 4, 0);
  } },
  { erz: 'magmit', form: 'kantig', gestein: DUNKEL, zeichne: (b, f, rng) => adern(b, f, rng, ['feuer.1', 'feuer.3*', 'feuer.4*'], 3, METALL), einzelpixel: 'Glutadern: Kernpixel der Magmitader sind gewollt' },
  { erz: 'lumenit', form: 'kantig', zeichne: (b) => {
    const k = kristall('wasser.1', 'wasser.3', 'wasser.4*', 'wasser.5*', 'eis.4*');
    prisma(b, 8, 13, 7, 3, -0.4, k);
    prisma(b, 13, 12, 10, 4, 0.05, k);
    prisma(b, 17, 14, 6, 3, 0.5, k);
  } },
  { erz: 'prismenquarz', form: 'kantig', gestein: STEIN_SCHLICHT, zeichne: (b) => {
    prisma(b, 8, 13, 7, 3, -0.4, kristall('stein.0', 'verderb.3', 'verderb.4*', 'eis.4*', 'eis.4*'));
    prisma(b, 13, 12, 10, 4, 0.05, kristall('stein.0', 'wasser.4', 'wasser.5*', 'eis.4*', 'eis.4*'));
    prisma(b, 17, 14, 6, 3, 0.5, kristall('stein.0', 'sand.3', 'sand.4*', 'eis.4*', 'eis.4*'));
  } },
  { erz: 'nachtstahl', form: 'kantig', gestein: DUNKEL, zeichne: (b, f, rng) => adern(b, f, rng, ['verderb.1', 'verderb.2', 'verderb.4'], 3, METALL) },
];

function erzBild(rng: Rng, e: Erzart): Bild {
  const b = new Bild(W, H);
  const f = fels(rng, {
    w: W,
    h: H,
    form: e.form,
    bloecke: [
      { x: 11.5, y: 14, rx: 9, ry: 7.5, hoch: 9 },
      { x: 17, y: 17.5, rx: 5, ry: 4, hoch: 5 },
    ],
  });
  maleFels(b, f, e.gestein ?? STEIN);
  e.zeichne(b, f, rng);
  saeubere(b);
  return b;
}

export default defineGenerator('erzknoten', (rng: Rng): Sprite[] =>
  ERZE.map((e) => felsSprite(`erz_${e.erz}`, GRUPPE, [erzBild(rng, e)], e.einzelpixel !== undefined ? { einzelpixel: e.einzelpixel } : {})),
).generate(203, undefined);
