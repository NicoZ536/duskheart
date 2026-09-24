/**
 * Felsen je Biom (M2-21, docs/WORLD.md §7 `fels_<klein|gross>_<biom>`, docs/ART.md §3/§5): klein 16×16,
 * groß 32×32, Fuß in der untersten Konturzeile, Bodenkontakt `nacht.1` an den Fußecken. Jedes Biom hat
 * seinen eigenen Stein, gezeichnet in seinen Endfarben (Palettenzeile `basis`, `objektZeile`):
 * - Grünhain: gerundeter Feldstein mit Moospolster.
 * - Salzküste: heller, glatt gewaschener Küstenfels mit Salzkruste und Seepocken.
 * - Nebelmoor: dunkler Moorstein, dick bemoost, Moos hängt in Strähnen herab.
 * - Frostkamm: kantiger, blaugrauer Granit mit Schneekappe.
 * - Glutsand: geschichteter Sandstein (gewellte Bänder), der große als Pilzfels.
 * - Aschenschlund: kantiger Basalt mit Ascheauflage und einem glühenden Riss.
 * - Scherbenhain: fahl-lila Scherbenstein, aus dem Kristallsplitter wachsen.
 * - Nachtherz: violettschwarzes Nachtgestein mit glühenden Adern.
 * - Wurzelhöhlen: erdiger Fels, von Wurzeln umschlungen, Moosspitzen.
 * - Tiefgrund: kalter Tiefenstein mit blauen Flechten und Kristallglanz.
 * - Glutadern: rotschwarzer Glutstein mit Lavarissen.
 */
import type { Rng } from '../../../src/engine/rng';
import { defineGenerator } from '../../lib/generator';
import { GLANZ, deckschicht, fels, felsSprite, maleFels, riss, type Block, type Fels, type SteinFarben } from '../../lib/rock';
import { Bild, saeubere } from '../../lib/tree';
import type { Sprite } from '../../lib/sprite';

const GRUPPE = 'gestein';

/** Blocklayouts: klein (16×16) und groß (32×32). */
const KLEIN: readonly Block[] = [
  { x: 7.5, y: 9.5, rx: 6, ry: 5, hoch: 6 },
  { x: 12.5, y: 12.5, rx: 2.5, ry: 2, hoch: 2 },
];
const GROSS: readonly Block[] = [
  { x: 14, y: 17, rx: 11.5, ry: 10, hoch: 12 },
  { x: 22, y: 22, rx: 7, ry: 6, hoch: 7 },
  { x: 5.5, y: 25, rx: 3, ry: 2.5, hoch: 3 },
];

interface Biomfels {
  readonly biom: string;
  readonly form: 'rund' | 'kantig';
  readonly farben: SteinFarben;
  readonly bloeckeKlein?: readonly Block[];
  readonly bloeckeGross?: readonly Block[];
  /** Zusätze nach dem Stein (Deckschicht, Risse, Einschlüsse); `gross` für die 32er-Fassung. */
  readonly zusatz?: (b: Bild, f: Fels, rng: Rng, gross: boolean) => void;
  readonly licht?: { bias?: number };
  readonly einzelpixel?: string;
}

/** Gezackte, leuchtende Linie (Glutriss, Ader) über die Front. */
function ader(b: Bild, f: Fels, rng: Rng, x0: number, y0: number, laenge: number, kern: string, rand: string): void {
  let x = x0;
  for (let i = 0; i < laenge; i++) {
    const y = y0 + i;
    const q = y * b.w + x;
    if ((f.relief.mask[q] ?? 0) === 0) break;
    b.set(x, y, i > 0 && i < laenge - 1 ? kern : rand, 0, 1);
    if (i % 2 === 1) {
      const nx = x + rng.int(-1, 2);
      if (nx !== x && (f.relief.mask[y * b.w + nx] ?? 0) > 0) {
        b.set(nx, y, rand, 0, 1);
        x = nx;
      }
    }
  }
}

/** Kristallsplitter: schmaler Keil, links Lichtfacette, rechts Schattenfacette, Spitze hell. */
export function splitter(b: Bild, x: number, fuss: number, hoehe: number, licht: string, schatten: string, kontur: string, material = GLANZ): void {
  for (let i = 0; i < hoehe; i++) {
    const y = fuss - i;
    const breit = i < hoehe - 2 ? 2 : 1;
    b.set(x, y, licht, material, 4 + i);
    if (breit === 2) b.set(x + 1, y, schatten, material, 3 + i);
    b.set(x - 1, y, kontur, material, 2);
    b.set(x + breit, y, kontur, material, 2);
  }
  b.set(x, fuss - hoehe, kontur, material, 2);
}

const BIOMFELSEN: readonly Biomfels[] = [
  {
    biom: 'gruenhain',
    form: 'rund',
    farben: { kontur: 'stein.0', stufen: ['stein.1', 'stein.2', 'stein.3', 'stein.4', 'stein.5'] },
    zusatz: (b, f, rng, gross) => {
      deckschicht(b, f, ['gras.2', 'gras.4'], gross ? 2 : 1, gross ? 5 : 3, rng);
      riss(b, f, rng, gross ? 17 : 6, gross ? 20 : 11, gross ? 5 : 3, 'stein.1');
    },
  },
  {
    biom: 'salzkueste',
    form: 'rund',
    farben: { kontur: 'stein.1', stufen: ['stein.2', 'stein.3', 'stein.4', 'stein.5', 'sand.4'] },
    bloeckeKlein: [
      { x: 7.5, y: 10, rx: 6.5, ry: 4.5, hoch: 5 },
      { x: 12.5, y: 12.5, rx: 2.5, ry: 2, hoch: 2 },
    ],
    bloeckeGross: [
      { x: 15, y: 18, rx: 12, ry: 9, hoch: 10 },
      { x: 23, y: 22.5, rx: 6.5, ry: 5, hoch: 6 },
      { x: 5.5, y: 25, rx: 3, ry: 2.5, hoch: 3 },
    ],
    zusatz: (b, f, rng, gross) => {
      deckschicht(b, f, ['eis.3', 'eis.4'], gross ? 2 : 1, 2, rng);
      // Seepocken: kleine Zweiergruppen an der Front.
      const pocken: ReadonlyArray<readonly [number, number]> = gross
        ? [
            [8, 22],
            [13, 24],
            [20, 21],
            [25, 25],
          ]
        : [
            [4, 12],
            [9, 13],
          ];
      for (const [x, y] of pocken) {
        if ((f.relief.mask[y * b.w + x] ?? 0) === 0 || (f.relief.mask[y * b.w + x + 1] ?? 0) === 0) continue;
        b.set(x, y, 'sand.3', 0, 2);
        b.set(x + 1, y, 'sand.4', 0, 2);
      }
    },
  },
  {
    biom: 'nebelmoor',
    form: 'rund',
    farben: { kontur: 'nacht.1', stufen: ['stein.0', 'stein.1', 'stein.2', 'stein.3'] },
    licht: { bias: 0.5 },
    zusatz: (b, f, rng, gross) => {
      const moos = deckschicht(b, f, ['gras.1', 'gras.3'], gross ? 3 : 1, gross ? 5 : 3, rng);
      // Moossträhnen hängen von der Deckschicht herab.
      for (let x = 2; x < b.w - 2; x += rng.int(3, 5)) {
        let y = -1;
        for (let yy = b.h - 1; yy >= 0; yy--) {
          if ((moos[yy * b.w + x] ?? 0) > 0) {
            y = yy;
            break;
          }
        }
        if (y < 0) continue;
        const len = rng.int(1, 4);
        for (let i = 1; i <= len; i++) if ((f.relief.mask[(y + i) * b.w + x] ?? 0) > 0) b.set(x, y + i, 'gras.1', 0, 2);
      }
    },
  },
  {
    biom: 'frostkamm',
    form: 'kantig',
    farben: { kontur: 'stein.0', stufen: ['stein.1', 'stein.2', 'stein.3', 'eis.0', 'eis.1'] },
    zusatz: (b, f, rng) => {
      deckschicht(b, f, ['eis.2', 'eis.4'], 0, 0, rng, GLANZ);
    },
  },
  {
    biom: 'glutsand',
    form: 'rund',
    farben: { kontur: 'erde.1', stufen: ['erde.2', 'erde.3', 'sand.1', 'sand.2', 'sand.3'] },
    bloeckeGross: [
      { x: 15, y: 15, rx: 12.5, ry: 7, hoch: 12 },
      { x: 15, y: 23, rx: 7, ry: 5, hoch: 8 },
      { x: 25, y: 25, rx: 3, ry: 2.5, hoch: 3 },
    ],
    zusatz: (b, f, rng, gross) => {
      // Schichtbänder: je Band eine dunkle Fuge mit heller Kante darüber, gewellt, im Abstand 3–4 px.
      let y = gross ? 12 : 8;
      while (y < b.h - 3) {
        let off = 0;
        let naechster = rng.int(3, 6);
        for (let x = 0; x < b.w; x++) {
          if (x === naechster) {
            off = off === 0 ? 1 : 0;
            naechster += rng.int(3, 6);
          }
          const yy = y + off;
          const q = yy * b.w + x;
          if ((f.relief.mask[q] ?? 0) === 0 || (f.relief.mask[q + b.w] ?? 0) === 0) continue;
          b.set(x, yy, 'erde.2', 0, 1);
          if ((f.relief.mask[q - b.w] ?? 0) > 0 && (f.oben[q - b.w] ?? 0) === 0) b.set(x, yy - 1, 'sand.2', 0, 1);
        }
        y += rng.int(3, 5);
      }
    },
  },
  {
    biom: 'aschenschlund',
    form: 'kantig',
    farben: { kontur: 'nacht.0', stufen: ['nacht.1', 'nacht.2', 'nacht.3', 'nacht.4'] },
    zusatz: (b, f, rng, gross) => {
      deckschicht(b, f, ['stein.2', 'stein.3'], gross ? 2 : 1, gross ? 4 : 3, rng);
      ader(b, f, rng, gross ? 12 : 6, gross ? 19 : 10, gross ? 7 : 4, 'feuer.4*', 'feuer.2*');
    },
    einzelpixel: 'Glutriss: einzelne Randpixel der leuchtenden Ader sind gewollt (Funkenspur)',
  },
  {
    biom: 'scherbenhain',
    form: 'rund',
    farben: { kontur: 'nacht.2', stufen: ['nacht.3', 'nacht.4', 'stein.3', 'stein.4', 'eis.2'] },
    zusatz: (b, f, _rng, gross) => {
      if (gross) {
        splitter(b, 9, 12, 7, 'wasser.5*', 'wasser.4*', 'nacht.2');
        splitter(b, 13, 11, 9, 'eis.4*', 'verderb.4*', 'nacht.2');
        splitter(b, 20, 15, 5, 'wasser.5*', 'wasser.4*', 'nacht.2');
      } else {
        splitter(b, 6, 7, 5, 'wasser.5*', 'wasser.4*', 'nacht.2');
        splitter(b, 9, 8, 3, 'eis.4*', 'verderb.4*', 'nacht.2');
      }
      void f;
    },
  },
  {
    biom: 'nachtherz',
    form: 'kantig',
    farben: { kontur: 'nacht.0', stufen: ['nacht.1', 'verderb.1', 'nacht.3', 'verderb.2'] },
    zusatz: (b, f, rng, gross) => {
      ader(b, f, rng, gross ? 10 : 5, gross ? 14 : 8, gross ? 9 : 5, 'verderb.4*', 'verderb.3*');
      if (gross) ader(b, f, rng, 21, 19, 5, 'verderb.4*', 'verderb.3*');
    },
    einzelpixel: 'Glühende Adern: einzelne Randpixel der Ader sind gewollt',
  },
  {
    biom: 'wurzelhoehlen',
    form: 'rund',
    farben: { kontur: 'erde.0', stufen: ['erde.1', 'erde.2', 'erde.3', 'erde.4'] },
    zusatz: (b, f, rng, gross) => {
      deckschicht(b, f, ['gras.2', 'gras.3'], 1, gross ? 3 : 2, rng);
      // Wurzeln: Stränge laufen über die Kuppe und die Flanke hinab bis zum Boden (2 px: Oberseite
      // hell, Unterseite dunkel), wie ein Netz, das den Fels hält.
      const straenge: ReadonlyArray<readonly [number, number]> = gross
        ? [
            [7, 1],
            [21, -1],
          ]
        : [[5, 1]];
      for (const [x0, dir] of straenge) {
        let x = x0;
        let y = 0;
        while (y < b.h && (f.relief.mask[y * b.w + x] ?? 0) === 0) y++;
        for (let i = 0; i < b.h && y < b.h - 2; i++) {
          const q = y * b.w + x;
          if ((f.relief.mask[q] ?? 0) === 0) break;
          // Wurzeln liegen auf dem Stein (über der Oberfläche), nicht in einer Rinne.
          b.set(x, y, 'holz.2', 0, (f.relief.height[q] ?? 0) + 1.5);
          if ((f.relief.mask[q + b.w] ?? 0) > 0) b.set(x, y + 1, 'holz.0', 0, (f.relief.height[q + b.w] ?? 0) + 0.5);
          if (i % 3 !== 2) y += 1;
          else x += dir;
        }
      }
    },
  },
  {
    biom: 'tiefgrund',
    form: 'kantig',
    farben: { kontur: 'nacht.1', stufen: ['stein.0', 'stein.1', 'stein.2', 'stein.3'] },
    zusatz: (b, f, rng, gross) => {
      // Flechten: flache Flecken im unteren Drittel.
      const flecken: ReadonlyArray<readonly [number, number, number]> = gross
        ? [
            [6, 22, 4],
            [18, 24, 3],
          ]
        : [[4, 12, 3]];
      for (const [x0, y0, n] of flecken) {
        for (let i = 0; i < n; i++) {
          for (const [dx, dy, c] of [
            [i, 0, 'wasser.3'],
            [i, 1, 'wasser.2'],
          ] as const) {
            if ((f.relief.mask[(y0 + dy) * b.w + x0 + dx] ?? 0) > 0) b.set(x0 + dx, y0 + dy, c, 0, 2);
          }
        }
      }
      splitter(b, gross ? 16 : 9, gross ? 12 : 7, gross ? 4 : 3, 'eis.3*', 'eis.1*', 'wasser.1');
      void rng;
    },
  },
  {
    biom: 'glutadern',
    form: 'kantig',
    farben: { kontur: 'nacht.0', stufen: ['nacht.1', 'erde.0', 'laub.0', 'erde.1'] },
    zusatz: (b, f, rng, gross) => {
      ader(b, f, rng, gross ? 9 : 5, gross ? 16 : 9, gross ? 8 : 5, 'feuer.4*', 'feuer.3*');
      if (gross) ader(b, f, rng, 20, 20, 6, 'feuer.4*', 'feuer.2*');
    },
    einzelpixel: 'Lavarisse: einzelne Randpixel der Glut sind gewollt',
  },
];

function felsBild(rng: Rng, d: Biomfels, gross: boolean): Bild {
  const w = gross ? 32 : 16;
  const b = new Bild(w, w);
  const f = fels(rng, { w, h: w, bloecke: (gross ? d.bloeckeGross : d.bloeckeKlein) ?? (gross ? GROSS : KLEIN), form: d.form, farben: d.farben, ...(d.licht !== undefined ? { licht: d.licht } : {}) });
  maleFels(b, f, d.farben);
  d.zusatz?.(b, f, rng, gross);
  saeubere(b);
  return b;
}

export default defineGenerator('felsen', (rng: Rng): Sprite[] =>
  BIOMFELSEN.flatMap((d) => [
    felsSprite(`fels_klein_${d.biom}`, GRUPPE, [felsBild(rng, d, false)], d.einzelpixel !== undefined ? { einzelpixel: d.einzelpixel } : {}),
    felsSprite(`fels_gross_${d.biom}`, GRUPPE, [felsBild(rng, d, true)], d.einzelpixel !== undefined ? { einzelpixel: d.einzelpixel } : {}),
  ]),
).generate(201, undefined);
