/**
 * Büsche (M2-21, docs/WORLD.md §7 `busch_<art>`, alle 12 Büsche aus `src/content/worldObjects.ts`):
 * 24×24, Fuß in der vorletzten Zeile, Höhen-Hinweis `kugel`, Wind-Biegung auf dem Laub. Büsche sind in
 * ihren Endfarben gezeichnet; Laub in `gras` folgt den allgemeinen Jahreszeitzeilen (`objektZeile`).
 * Pflückbare Büsche haben Frame 1 `abgeerntet` (ohne Beeren, Nüsse, Samenwolle).
 */
import type { Rng } from '../../../src/engine/rng';
import { defineGenerator } from '../../lib/generator';
import { krone, type Blattmasse, type KronenParameter } from '../../lib/foliage';
import { outlineOf } from '../../lib/foliageRelief';
import { MATERIAL_BITS, spriteFromPixels, type Sprite } from '../../lib/sprite';
import { Bild, LAUB_GRAS, astGeruest, maleKrone, saeubere, schmueckeKrone, zeichneAeste, type Ast, type KronenFarben, type KronenSchmuck, type RindenFarben } from '../../lib/tree';

const GRUPPE = 'vegetation';
const W = 24;
const H = 24;
const FUSS = H - 2;
const WIND = MATERIAL_BITS.wind;

const HOLZ: RindenFarben = { kontur: 'holz.0', schatten: 'holz.1', mitte: 'holz.2', licht: 'holz.3' };

/** Laubbusch: Kuppel aus Blattmassen, unten ein paar Triebe, Bodenkontakt. */
const RUND: readonly Blattmasse[] = [
  { x: 12, y: 10, rx: 6, ry: 5 },
  { x: 7, y: 14, rx: 5, ry: 5 },
  { x: 17, y: 14, rx: 5, ry: 5 },
  { x: 12, y: 16, rx: 7, ry: 5 },
];

/** Triebe unter dem Busch (im Schatten) und Bodenkontakt in `nacht.1`. */
function triebe(b: Bild, f: RindenFarben): void {
  for (const x of [9, 12, 15]) {
    b.set(x, FUSS, f.kontur);
    b.set(x, FUSS - 1, f.schatten);
  }
  for (const x of [7, 8, 16, 17]) b.set(x, FUSS + 1 - 1, 'nacht.1');
}

/** Ergebnis eines gepflückten Busches: Schmuckpixel und das Bild, wie es ohne Schmuck war. */
interface Ernte {
  readonly schmuck: Uint8Array;
  readonly leer: Bild;
}

interface Buschart {
  readonly art: string;
  /** Zeichnet den vollen Busch; liefert für pflückbare Büsche Schmuck und Bild ohne Schmuck. */
  readonly zeichne: (b: Bild, rng: Rng) => Ernte | null;
  readonly einzelpixel?: string;
}

/** Setzt Schmuck auf die Krone und merkt sich das Bild davor. */
function ernte(b: Bild, rng: Rng, k: Parameters<typeof schmueckeKrone>[2], s: KronenSchmuck): Ernte {
  const leer = b.copy();
  return { schmuck: schmueckeKrone(b, rng, k, s, WIND), leer };
}

/** Laubbusch mit optionalem Schmuck. */
function laubbusch(massen: readonly Blattmasse[], farben: KronenFarben = LAUB_GRAS, schmuck?: KronenSchmuck, extra: Partial<KronenParameter> = {}) {
  return (b: Bild, rng: Rng): Ernte | null => {
    triebe(b, HOLZ);
    const k = krone(rng, W, H, { massen, buendel: 2, ...extra });
    maleKrone(b, k, farben, 2, WIND);
    if (schmuck === undefined) return null;
    return ernte(b, rng, k, schmuck);
  };
}

/** Beeren-Form: 2×2 mit Glanzpixel oben links. */
function beere(dunkel: string, mitte: string, glanz: string, anzahl: number, abstand = 4): KronenSchmuck {
  return {
    anzahl,
    abstand,
    minStufe: 1,
    form: [
      [0, 0, glanz],
      [1, 0, mitte],
      [0, 1, mitte],
      [1, 1, dunkel],
    ],
  };
}

/** Zweiggerüst eines Busches (Raumkolonisation in einer Kuppel), gezeichnet in `f`. */
function zweige(b: Bild, rng: Rng, f: RindenFarben, form: readonly Blattmasse[], dichte: number): void {
  const mask = new Uint8Array(W * H);
  for (const m of form) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - m.x) / m.rx;
        const dy = (y + 0.5 - m.y) / m.ry;
        if (dx * dx + dy * dy <= 1 && x > 1 && x < W - 2 && y > 1) mask[y * W + x] = 1;
      }
    }
  }
  const aeste = astGeruest(rng, mask, W, 12, FUSS, 1.5, { punkte: dichte, punktAbstand: 2, einfluss: 7, erreicht: 2, schritt: 1.5, auftrieb: 0.2, dickenStufen: [6, 20, 99, 99], laengenStufen: [5, 99, 99, 99] });
  zeichneAeste(b, aeste, f);
}

const ARTEN: readonly Buschart[] = [
  { art: 'beeren', zeichne: laubbusch(RUND, LAUB_GRAS, beere('laub.0', 'laub.1', 'laub.3', 9)) },
  {
    art: 'hasel',
    zeichne: laubbusch(
      [
        { x: 12, y: 9, rx: 7, ry: 6 },
        { x: 6, y: 15, rx: 5, ry: 5 },
        { x: 18, y: 15, rx: 5, ry: 5 },
        { x: 12, y: 16, rx: 7, ry: 5 },
      ],
      LAUB_GRAS,
      beere('holz.1', 'holz.3', 'holz.4', 6, 5),
      { buendel: 2.5 },
    ),
  },
  {
    art: 'sanddorn',
    zeichne: (b, rng) => {
      zweige(b, rng, HOLZ, [{ x: 12, y: 12, rx: 10, ry: 9 }], 26);
      const k = krone(rng, W, H, { buendel: 1.5, massen: [{ x: 8, y: 9, rx: 4, ry: 3.5 }, { x: 16, y: 8, rx: 4, ry: 3.5 }, { x: 5, y: 15, rx: 3, ry: 3 }, { x: 19, y: 15, rx: 3, ry: 3 }, { x: 12, y: 13, rx: 4, ry: 3 }] });
      maleKrone(b, k, { kontur: 'gras.0', stufen: ['gras.1', 'gras.2', 'gras.3', 'gras.4', 'stein.5'] }, 2, WIND);
      return ernte(b, rng, k, { anzahl: 8, abstand: 3, minStufe: 0, form: [[0, 0, 'laub.4'], [1, 0, 'laub.3'], [0, 1, 'laub.3']] });
    },
  },
  { art: 'moorbeere', zeichne: laubbusch(RUND, { kontur: 'gras.0', stufen: ['gras.0', 'gras.1', 'gras.2', 'gras.3', 'gras.4'] }, beere('wasser.0', 'wasser.1', 'eis.1', 9), { licht: { bias: 0.5 } }) },
  { art: 'frostbeere', zeichne: laubbusch(RUND, { kontur: 'gras.0', stufen: ['gras.1', 'gras.2', 'gras.3', 'eis.2', 'eis.4'] }, beere('feuer.0', 'feuer.1', 'feuer.3', 8)) },
  {
    art: 'wacholder',
    zeichne: (b, rng) => {
      triebe(b, HOLZ);
      // Kegelförmig aus waagerechten Nadelbüscheln, dunkel-blaugrün, mit blauen Beeren.
      const k = krone(rng, W, H, {
        buendel: 1.8,
        buendelStreckung: 1.5,
        massen: [
          { x: 12, y: 6, rx: 3, ry: 3.5 },
          { x: 10, y: 10, rx: 4, ry: 3 },
          { x: 14, y: 10, rx: 4, ry: 3 },
          { x: 8, y: 15, rx: 5, ry: 3.5 },
          { x: 16, y: 15, rx: 5, ry: 3.5 },
          { x: 12, y: 18, rx: 7, ry: 3 },
        ],
      });
      maleKrone(b, k, { kontur: 'gras.0', stufen: ['gras.1', 'gras.1', 'gras.2', 'gras.3', 'gras.4'] }, 2, WIND);
      return ernte(b, rng, k, { anzahl: 6, abstand: 4, minStufe: 1, form: [[0, 0, 'eis.1'], [1, 0, 'wasser.2'], [0, 1, 'wasser.2']] });
    },
  },
  {
    art: 'baumwolle',
    zeichne: (b, rng) => {
      zweige(b, rng, HOLZ, [{ x: 12, y: 11, rx: 9, ry: 9 }], 24);
      const k = krone(rng, W, H, { buendel: 0, massen: [{ x: 7, y: 13, rx: 3, ry: 2.5 }, { x: 17, y: 12, rx: 3, ry: 2.5 }, { x: 12, y: 16, rx: 3, ry: 2 }] });
      maleKrone(b, k, LAUB_GRAS, 2, WIND);
      // Samenwolle: weiße Bäusche (3×2 mit Schattenzeile) an den Zweigenden.
      const leer = b.copy();
      const used = new Uint8Array(W * H);
      for (const [x, y] of [
        [5, 6],
        [11, 3],
        [17, 5],
        [20, 10],
        [8, 9],
        [14, 8],
      ] as const) {
        for (const [dx, dy, c] of [
          [0, 0, 'eis.4'],
          [1, 0, 'eis.4'],
          [2, 0, 'sand.4'],
          [0, 1, 'sand.4'],
          [1, 1, 'sand.3'],
          [2, 1, 'sand.3'],
        ] as const) {
          b.set(x + dx, y + dy, c, WIND, 6);
          used[(y + dy) * W + x + dx] = 1;
        }
      }
      const kontur = konturAussen(b, used, 'holz.0');
      kontur.forEach((v, q) => {
        if (v > 0) used[q] = 1;
      });
      void rng;
      return { schmuck: used, leer };
    },
  },
  {
    art: 'dornbusch',
    zeichne: (b, rng) => {
      zweige(b, rng, HOLZ, [{ x: 12, y: 12, rx: 10, ry: 9 }], 55);
      const k = krone(rng, W, H, { buendel: 0, massen: [{ x: 6, y: 9, rx: 2.5, ry: 2 }, { x: 18, y: 7, rx: 2.5, ry: 2 }, { x: 12, y: 5, rx: 2.5, ry: 2 }] });
      maleKrone(b, k, { kontur: 'gras.0', stufen: ['gras.1', 'gras.2', 'holz.3', 'sand.2', 'sand.3'] }, 2, WIND);
      return null;
    },
  },
  {
    art: 'glutdorn',
    zeichne: (b, rng) => {
      zweige(b, rng, { kontur: 'nacht.0', schatten: 'nacht.1', mitte: 'nacht.2', licht: 'nacht.3' }, [{ x: 12, y: 12, rx: 10, ry: 9 }], 60);
      // Glutspitzen: die obersten Zweigenden glimmen.
      for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
          if (b.get(x, y) === 0) continue;
          if (b.get(x, y - 1) === 0 && b.get(x - 1, y - 1) === 0 && b.get(x + 1, y - 1) === 0 && y < 14) {
            b.set(x, y, 'feuer.3*', WIND, 6);
            if (b.get(x, y + 1) !== 0) b.set(x, y + 1, 'feuer.2*', WIND, 5);
          }
          break;
        }
      }
      return null;
    },
    einzelpixel: 'Glutspitzen an den Zweigenden sind gewollt (glimmende Dornen)',
  },
  {
    art: 'kristallstrauch',
    zeichne: (b, rng) => {
      triebe(b, { kontur: 'wasser.1', schatten: 'eis.0', mitte: 'eis.1', licht: 'eis.3' });
      const k = krone(rng, W, H, {
        form: 'kristall',
        buendel: 0,
        massen: [
          { x: 12, y: 8, rx: 3.5, ry: 6 },
          { x: 7, y: 12, rx: 3, ry: 5 },
          { x: 17, y: 11, rx: 3, ry: 5 },
          { x: 4, y: 17, rx: 2.5, ry: 3.5 },
          { x: 20, y: 17, rx: 2.5, ry: 3.5 },
          { x: 12, y: 17, rx: 3.5, ry: 3.5 },
        ],
      });
      maleKrone(b, k, { kontur: 'wasser.1', stufen: ['wasser.2', 'wasser.3', 'verderb.4*', 'wasser.5*', 'eis.4*'] }, 2, MATERIAL_BITS.eis);
      return null;
    },
  },
  {
    art: 'dornenranke',
    zeichne: (b, rng) => {
      zweige(b, rng, { kontur: 'nacht.0', schatten: 'verderb.1', mitte: 'verderb.2', licht: 'verderb.3' }, [{ x: 12, y: 13, rx: 11, ry: 9 }], 70);
      for (let x = 1; x < W - 1; x++) {
        for (let y = 0; y < H; y++) {
          if (b.get(x, y) === 0) continue;
          if (y < 16 && b.get(x, y - 1) === 0 && b.get(x - 1, y) === 0 && b.get(x + 1, y) === 0) b.set(x, y, 'verderb.4*', WIND, 6);
          break;
        }
      }
      return null;
    },
    einzelpixel: 'Glühende Rankenspitzen sind gewollt',
  },
  {
    art: 'wurzelgeflecht',
    zeichne: (b, rng) => {
      // Wurzelbögen: Schlingen, die aus dem Boden kommen und wieder hineinführen; dazwischen Luft.
      const aeste: Ast[] = [];
      for (const [x0, x1, hoch, d] of [
        [2, 12, 13, 2.5],
        [10, 21, 16, 3],
        [6, 17, 8, 2],
        [15, 22, 7, 2],
      ] as const) {
        const n = 12;
        let px: number = x0;
        let py: number = FUSS;
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const x = x0 + (x1 - x0) * t;
          const y = FUSS - Math.sin(Math.PI * t) * hoch;
          aeste.push({ x0: px, y0: py, x1: x, y1: y, d0: d, d1: d });
          px = x;
          py = y;
        }
      }
      zeichneAeste(b, aeste, HOLZ);
      void rng;
      return null;
    },
  },
];

/** Kontur um eine Maske in `farbe`, nur auf leeren Pixeln; liefert die gesetzten Pixel. */
function konturAussen(b: Bild, mask: Uint8Array, farbe: string): Uint8Array {
  const gesetzt = new Uint8Array(W * H);
  outlineOf(mask, W, H).forEach((v, q) => {
    if (v > 0 && b.index[q] === 0) {
      b.set(q % W, Math.floor(q / W), farbe, WIND, 2);
      gesetzt[q] = 1;
    }
  });
  return gesetzt;
}

function buschSprite(rng: Rng, a: Buschart): Sprite {
  const b = new Bild(W, H);
  const e = a.zeichne(b, rng);
  const frames: Bild[] = [];
  if (e !== null) {
    // Frame „abgeerntet“: dieselbe Zeichnung, an den Schmuckpixeln das Bild von vor dem Schmuck.
    const ohne = b.copy();
    e.schmuck.forEach((v, q) => {
      if (v === 0) return;
      ohne.index[q] = e.leer.index[q] ?? 0;
      ohne.emissive[q] = e.leer.emissive[q] ?? 0;
      ohne.material[q] = e.leer.material[q] ?? 0;
      ohne.hoehe[q] = e.leer.hoehe[q] ?? -1;
    });
    saeubere(b, e.schmuck);
    saeubere(ohne);
    frames.push(b, ohne);
  } else {
    saeubere(b);
    frames.push(b);
  }
  return spriteFromPixels(
    {
      id: `busch_${a.art}`,
      group: GRUPPE,
      size: [W, H],
      anchor: [W / 2, FUSS],
      hoehe: 'kugel',
      hitbox: [5, FUSS - 5, 14, 6],
      occluder: { kind: 'ellipse', x: W / 2, y: FUSS - 2, rx: 6, ry: 2 },
      ...(frames.length > 1 ? { clips: { abgeerntet: { frames: [1], fps: 1, loop: true } } } : {}),
      ...(a.einzelpixel !== undefined ? { einzelpixel: a.einzelpixel } : {}),
    },
    frames.map((f) => f.frame()),
  );
}

export default defineGenerator('buesche', (rng: Rng): Sprite[] => ARTEN.map((a) => buschSprite(rng, a))).generate(204, undefined);
