/**
 * Wildpflanzen (M2-21, docs/WORLD.md §7 `pflanze_<art>`, alle 13 Pflanzen aus
 * `src/content/worldObjects.ts`): Fasergras, Kräuter, Pilze, Strandhafer, Schilf, Bergtee, Kaktus,
 * Feuerwurz, Prismenblüte, Schattenkraut, Leuchtpilz, Kristallmoos, Glutmoos. Zelle 16×16, hohe
 * Pflanzen 16×24 (Schilf, Kaktus 16×32); Fuß in der vorletzten Zeile, Wind auf Halmen und Blättern.
 * Fasergras und Steinpilz wachsen in mehreren Biomen und sind in Grünhain-Farben gezeichnet (Biomzeile,
 * `objektZeile`); alle übrigen in ihren Endfarben.
 */
import type { Rng } from '../../../src/engine/rng';
import { defineGenerator } from '../../lib/generator';
import { outlineOf } from '../../lib/foliageRelief';
import { halme, pilz, polster, type Halm, type PilzFarben } from '../../lib/foliageHalme';
import { prisma } from '../../lib/rock';
import { MATERIAL_BITS, spriteFromPixels, type Sprite } from '../../lib/sprite';
import { Bild, saeubere } from '../../lib/tree';

const GRUPPE = 'pflanzen';
const WIND = MATERIAL_BITS.wind;

interface Pflanzenart {
  readonly art: string;
  readonly w: number;
  readonly h: number;
  readonly hoehe: 'flach' | 'kugel' | 'zylinder';
  readonly zeichne: (b: Bild, rng: Rng) => void;
  readonly einzelpixel?: string;
}

/** Fächer aus Halmen: `n` Halme mit Höhen um `hoehe`, nach außen geneigt. */
function faecher(rng: Rng, n: number, breite: number, hoehe: number, neigung: number): Halm[] {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    return { dx: Math.round(t * breite), hoehe: Math.round(hoehe * rng.float(0.7, 1) * (1 - Math.abs(t) * 0.5)), neigung: Math.round(t * neigung + rng.float(-1, 1)) };
  });
}

const STEINPILZ: PilzFarben = { kontur: 'holz.0', hut: ['holz.1', 'holz.2', 'holz.3'], stiel: ['sand.2', 'sand.4'] };

const ARTEN: readonly Pflanzenart[] = [
  {
    art: 'fasergras',
    w: 16,
    h: 24,
    hoehe: 'zylinder',
    zeichne: (b, rng) => halme(b, 8, 22, faecher(rng, 9, 8, 17, 10), ['gras.1', 'gras.2', 'gras.3', 'sand.3'], WIND, 'gras.0'),
  },
  {
    art: 'kraeuter',
    w: 16,
    h: 16,
    hoehe: 'kugel',
    zeichne: (b, rng) => {
      // Schafgarbenartig: drei Stängel mit cremeweißen Dolden über einer Rosette gefiederter Blätter.
      halme(b, 8, 13, [
        { dx: -3, hoehe: 8, neigung: -1 },
        { dx: 0, hoehe: 10, neigung: 0 },
        { dx: 3, hoehe: 7, neigung: 1 },
      ], ['gras.1', 'gras.2', 'gras.2', 'gras.3'], WIND);
      halme(b, 8, 13, faecher(rng, 8, 10, 4, 9), ['gras.1', 'gras.2', 'gras.3', 'gras.4'], WIND);
      for (const [x, y] of [
        [3, 4],
        [7, 2],
        [10, 5],
      ] as const) {
        for (const [dx, dy, c] of [
          [0, 0, 'sand.4'],
          [1, 0, 'sand.4'],
          [2, 0, 'sand.4'],
          [0, 1, 'sand.3'],
          [1, 1, 'sand.3'],
          [2, 1, 'sand.2'],
        ] as const) b.akzent(x + dx, y + dy, c, WIND, 5);
      }
      const mask = Uint8Array.from(b.index, (v) => (v !== 0 ? 1 : 0));
      outlineOf(mask, 16, 16).forEach((v, q) => {
        if (v > 0) b.set(q % 16, Math.floor(q / 16), Math.floor(q / 16) >= 14 ? 'nacht.1' : 'gras.0', WIND, 0.5);
      });
    },
  },
  {
    art: 'steinpilz',
    w: 16,
    h: 16,
    hoehe: 'kugel',
    zeichne: (b) => {
      pilz(b, 6.5, 13, 5, 9, 4, STEINPILZ);
      pilz(b, 12, 13, 3, 5, 2.5, STEINPILZ);
    },
  },
  {
    art: 'strandhafer',
    w: 16,
    h: 24,
    hoehe: 'zylinder',
    // Dünengras der Salzküste: blaugrün – dunkles Grün am Fuß, Türkis zur Spitze, trockene helle Spitzen
    // (M2-31: in Marineblau las es sich als blaue Agave auf dem Strand).
    zeichne: (b, rng) => halme(b, 8, 22, faecher(rng, 8, 7, 18, 12), ['gras.1', 'wasser.3', 'wasser.4', 'sand.4'], WIND, 'gras.0'),
  },
  {
    art: 'schilf',
    w: 16,
    h: 32,
    hoehe: 'zylinder',
    zeichne: (b, rng) => {
      halme(b, 8, 30, faecher(rng, 7, 8, 18, 6), ['gras.1', 'gras.2', 'gras.3', 'gras.4'], WIND);
      // Stängel mit Rohrkolben (3×5, oben heller), leicht versetzt.
      for (const [x, top] of [
        [5, 4],
        [9, 2],
        [12, 7],
      ] as const) {
        for (let y = top + 5; y <= 29; y++) b.set(x, y, 'gras.2', WIND, 2);
        for (let y = top; y < top + 5; y++) {
          b.set(x - 1, y, 'holz.0', WIND, 6);
          b.set(x, y, y < top + 2 ? 'holz.3' : 'holz.2', WIND, 6);
          b.set(x + 1, y, 'holz.1', WIND, 6);
        }
        b.set(x, top - 1, 'holz.0', WIND, 6);
        b.set(x, top - 2, 'gras.3', WIND, 6);
      }
    },
  },
  {
    art: 'bergtee',
    w: 16,
    h: 16,
    hoehe: 'kugel',
    zeichne: (b, rng) => {
      // Niedriger Polsterbusch mit schmalen Blättern; weiße Blüten auf kurzen Stielen.
      halme(b, 8, 13, faecher(rng, 9, 10, 6, 8), ['gras.1', 'gras.2', 'gras.3', 'gras.4'], WIND);
      for (const [x, y, stiel] of [
        [3, 4, 3],
        [7, 2, 4],
        [11, 4, 3],
      ] as const) {
        for (let i = 1; i <= stiel; i++) b.set(x + 1, y + 1 + i, 'gras.2', WIND, 3);
        for (const [dx, dy, c] of [
          [0, 0, 'eis.4'],
          [1, 0, 'eis.4'],
          [2, 0, 'eis.3'],
          [0, 1, 'eis.3'],
          [1, 1, 'sand.3'],
          [2, 1, 'eis.2'],
        ] as const) b.akzent(x + dx, y + dy, c, WIND, 4);
      }
      const mask = Uint8Array.from(b.index, (v) => (v !== 0 ? 1 : 0));
      outlineOf(mask, 16, 16).forEach((v, q) => {
        if (v > 0) b.set(q % 16, Math.floor(q / 16), Math.floor(q / 16) >= 14 ? 'nacht.1' : 'gras.0', WIND, 0.5);
      });
    },
  },
  {
    art: 'kaktus',
    w: 16,
    h: 32,
    hoehe: 'zylinder',
    zeichne: (b) => {
      // Säulenkaktus: Stamm 6 px, zwei Arme; Rippen als senkrechte Licht-/Schattenzüge, Blüte oben.
      const mask = new Uint8Array(16 * 32);
      const setze = (x0: number, x1: number, y0: number, y1: number): void => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask[y * 16 + x] = 1;
      };
      setze(5, 10, 6, 29);
      mask[5 * 16 + 6] = 1;
      mask[5 * 16 + 7] = 1;
      mask[5 * 16 + 8] = 1;
      mask[5 * 16 + 9] = 1;
      setze(1, 4, 16, 19);
      setze(1, 3, 10, 15);
      mask[9 * 16 + 2] = 1;
      setze(11, 14, 19, 22);
      setze(12, 14, 13, 18);
      mask[12 * 16 + 13] = 1;
      mask.forEach((v, q) => {
        if (v === 0) return;
        const x = q % 16;
        const y = Math.floor(q / 16);
        const links = (mask[q - 1] ?? 0) === 0;
        const rechts = (mask[q + 1] ?? 0) === 0;
        const oben = (mask[q - 16] ?? 0) === 0;
        let c = x % 2 === 0 ? 'gras.3' : 'gras.2';
        if (links) c = 'gras.3';
        if (rechts) c = 'gras.1';
        if (oben) c = 'gras.4';
        if (y > 26 && !links) c = 'gras.1';
        b.set(x, y, c, 0, 3);
      });
      outlineOf(mask, 16, 32).forEach((v, q) => {
        if (v === 0) return;
        const y = Math.floor(q / 16);
        b.set(q % 16, y, y >= 30 ? 'nacht.1' : 'gras.0', 0, 1);
      });
      for (const [x, y, c] of [
        [7, 3, 'laub.4'],
        [8, 3, 'laub.3'],
        [7, 4, 'laub.3'],
        [8, 4, 'laub.3'],
      ] as const) b.set(x, y, c, 0, 5);
    },
  },
  {
    art: 'feuerwurz',
    w: 16,
    h: 16,
    hoehe: 'kugel',
    zeichne: (b, rng) => {
      // Flammenförmige Blätter: dunkelrot am Fuß, orange, die Spitzen glimmen.
      halme(b, 8, 14, faecher(rng, 7, 8, 11, 7), ['feuer.0', 'feuer.1', 'feuer.2', 'feuer.3*'], WIND);
      halme(b, 8, 14, faecher(rng, 5, 5, 8, 4).map((h) => ({ ...h, dx: h.dx + 1 })), ['feuer.0', 'feuer.1', 'feuer.2', 'feuer.3*'], WIND);
    },
  },
  {
    art: 'prismenbluete',
    w: 16,
    h: 24,
    hoehe: 'zylinder',
    zeichne: (b) => {
      for (let y = 10; y <= 22; y++) b.set(8, y, y > 19 ? 'wasser.1' : 'wasser.2', WIND, 2);
      b.set(7, 16, 'wasser.2', WIND, 2);
      b.set(6, 15, 'wasser.3', WIND, 2);
      b.set(9, 18, 'wasser.2', WIND, 2);
      b.set(10, 17, 'wasser.3', WIND, 2);
      prisma(b, 6, 11, 6, 3, -0.7, { kontur: 'verderb.1', dunkel: 'verderb.3', mitte: 'verderb.4*', licht: 'eis.4*', kern: 'eis.4*' });
      prisma(b, 10, 11, 6, 3, 0.7, { kontur: 'verderb.1', dunkel: 'wasser.4', mitte: 'wasser.5*', licht: 'eis.4*', kern: 'eis.4*' });
      prisma(b, 8, 10, 8, 3, 0, { kontur: 'verderb.1', dunkel: 'sand.3', mitte: 'sand.4*', licht: 'eis.4*', kern: 'eis.4*' });
    },
  },
  {
    art: 'schattenkraut',
    w: 16,
    h: 16,
    hoehe: 'kugel',
    zeichne: (b, rng) => {
      // Spitze, violettschwarze Blätter, die sich wie eine Hand öffnen.
      const blaetter = faecher(rng, 7, 10, 10, 10);
      halme(b, 8, 13, blaetter, ['nacht.1', 'verderb.1', 'verderb.2', 'verderb.3'], WIND);
      halme(b, 9, 13, blaetter.map((h) => ({ ...h, hoehe: h.hoehe - 2 })), ['nacht.1', 'verderb.1', 'verderb.1', 'verderb.2'], WIND, 'nacht.0');
    },
  },
  {
    art: 'leuchtpilz',
    w: 16,
    h: 16,
    hoehe: 'kugel',
    zeichne: (b) => {
      const f: PilzFarben = { kontur: 'wasser.1', hut: ['wasser.3*', 'wasser.4*', 'wasser.5*'], stiel: ['eis.1', 'eis.2'] };
      pilz(b, 3.5, 13, 3, 4, 2.5, f);
      pilz(b, 12, 13, 2, 4, 2, f);
      pilz(b, 8, 13, 6, 7, 3.5, f);
    },
  },
  {
    art: 'kristallmoos',
    w: 16,
    h: 16,
    hoehe: 'flach',
    zeichne: (b, rng) => {
      polster(b, rng, 8, 10, 6, 3.5, ['wasser.1', 'wasser.2', 'wasser.3']);
      const k = { kontur: 'wasser.1', dunkel: 'wasser.3', mitte: 'eis.2*', licht: 'eis.3*', kern: 'eis.4*' };
      prisma(b, 5, 11, 5, 2.5, -0.35, k);
      prisma(b, 9, 10, 6, 3, 0.1, k);
      prisma(b, 12, 12, 4, 2.5, 0.5, k);
    },
  },
  {
    art: 'glutmoos',
    einzelpixel: 'Glutsporen: gewollte Dreiergruppen aus Kern und Rand (leuchtende Punkte im Moos)',
    w: 16,
    h: 16,
    hoehe: 'flach',
    zeichne: (b, rng) => {
      polster(b, rng, 8, 10, 6, 3.5, ['nacht.1', 'nacht.2', 'nacht.3']);
      // Glutsporen: kleine Dreiergruppen, heller Kern (gelb) in orangem Rand.
      for (const [x, y] of [
        [4, 9],
        [8, 8],
        [11, 10],
        [6, 11],
      ] as const) {
        b.akzent(x, y, 'feuer.4*', 0, 2);
        b.akzent(x + 1, y, 'feuer.3*', 0, 2);
        b.akzent(x, y + 1, 'feuer.2*', 0, 2);
      }
      void rng;
    },
  },
];

function pflanzenSprite(rng: Rng, a: Pflanzenart): Sprite {
  const b = new Bild(a.w, a.h);
  a.zeichne(b, rng);
  saeubere(b);
  const fuss = a.h - 2;
  return spriteFromPixels(
    {
      id: `pflanze_${a.art}`,
      group: GRUPPE,
      size: [a.w, a.h],
      anchor: [a.w / 2, fuss],
      hoehe: a.hoehe,
      hitbox: [a.w / 2 - 4, fuss - 4, 8, 5],
      ...(a.hoehe === 'flach' ? {} : { occluder: { kind: 'ellipse' as const, x: a.w / 2, y: fuss - 1, rx: 3, ry: 1.5 } }),
      ...(a.einzelpixel !== undefined ? { einzelpixel: a.einzelpixel } : {}),
    },
    [b.frame()],
  );
}

export default defineGenerator('pflanzen', (rng: Rng): Sprite[] => ARTEN.map((a) => pflanzenSprite(rng, a))).generate(205, undefined);
