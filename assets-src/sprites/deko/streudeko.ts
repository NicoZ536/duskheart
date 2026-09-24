/**
 * Streudeko (M2-19, docs/WORLD.md §7 `deko_<typ>`, alle 28 Typen aus `src/content/worldObjects.ts`):
 * Steinchen, Blumen, Pilze, Knochen, Muscheln, Gräser und die Eigenheiten jedes Bioms – jedes Biom hat
 * mindestens vier Typen (`tests/unit/assets/deco.test.ts`). Zelle 16×16, Anker unten Mitte, je Typ drei
 * Varianten als Frames (Frame nach Tile-Hash wählen, docs/WORLD.md §7 „Varianten“).
 *
 * Biom-Tönung per Palettenzeile (`objektZeile`: Streudeko nimmt die Zeile `biom_<id>` des Tiles): was
 * sich dem Biom anpassen soll (Steine, Gras, Moos, Flechten), steht in Grünhain-Rampen (`stein`, `gras`,
 * `erde`, `holz`, `laub`); was überall gleich aussieht (Knochen, Muscheln, Kristall, Glut, Ton), in
 * Rampen, die keine Biomzeile ändert (`sand`, `eis`, `wasser`, `feuer`, `haut`, `nacht`, `verderb`).
 */
import type { Rng } from '../../../src/engine/rng';
import { defineGenerator } from '../../lib/generator';
import { outlineOf } from '../../lib/foliageRelief';
import { halme, kiesel, pilz, polster, type Halm, type HalmFarben } from '../../lib/foliageHalme';
import { prisma, type PrismaFarben } from '../../lib/rock';
import { MATERIAL_BITS, spriteFromPixels, type Sprite } from '../../lib/sprite';
import { Bild, saeubere } from '../../lib/tree';

const GRUPPE = 'streudeko';
const W = 16;
const H = 16;
const FUSS = 14;
const VARIANTEN = 3;
const WIND = MATERIAL_BITS.wind;
const GLANZ = MATERIAL_BITS.eis;

type Motiv = (b: Bild, rng: Rng, x: number, y: number) => void;

interface Dekotyp {
  readonly typ: string;
  readonly hoehe: 'flach' | 'kugel';
  readonly motiv: Motiv;
  /** Anzahl Motive je Variante [min, max]. */
  readonly anzahl: readonly [number, number];
  /** Mindestabstand der Motive (px). */
  readonly abstand: number;
  /** Streubereich: halbe Breite/Höhe um (8, 10). */
  readonly bereich?: readonly [number, number];
  readonly einzelpixel?: string;
}

/** Kontur (auf leeren Pixeln) um alle Pixel, die sich gegenüber `vorher` geändert haben. */
function umranden(b: Bild, vorher: Uint8Array, farbe: string, material = 0): void {
  const neu = Uint8Array.from(b.index, (v, q) => (v !== 0 && v !== vorher[q] ? 1 : 0));
  outlineOf(neu, W, H).forEach((v, q) => {
    if (v > 0 && (b.index[q] ?? 0) === 0) b.set(q % W, Math.floor(q / W), farbe, material, 0.5);
  });
}

/** Zeichnet eine kleine Rasterform: Zeilen aus Zeichen, `farben` bildet Zeichen → Palettenreferenz. */
function form(b: Bild, x: number, y: number, zeilen: readonly string[], farben: Readonly<Record<string, string>>, material = 0, akzent = ''): void {
  zeilen.forEach((z, dy) => {
    [...z].forEach((c, dx) => {
      const ref = farben[c];
      if (ref === undefined) return;
      if (akzent.includes(c)) b.akzent(x + dx, y + dy, ref, material, 1 + (zeilen.length - dy) * 0.5);
      else b.set(x + dx, y + dy, ref, material, 1 + (zeilen.length - dy) * 0.5);
    });
  });
}

/** Spiegelt Rasterzeilen waagerecht (Varianten aus einer Zeichnung). */
function gespiegelt(zeilen: readonly string[]): string[] {
  return zeilen.map((z) => [...z].reverse().join(''));
}

const STEIN_K = ['stein.1', 'stein.2', 'stein.3', 'stein.4'] as const;

// ---------------------------------------------------------------------------------------------
// Motive
// ---------------------------------------------------------------------------------------------

const steinchen: Motiv = (b, rng, x, y) => kiesel(b, x, y, rng.float(2, 3), rng.float(1.5, 2), STEIN_K);

const BLUETEN: ReadonlyArray<Readonly<Record<string, string>>> = [
  { p: 'laub.4', c: 'laub.3', s: 'gras.2', l: 'gras.3' },
  { p: 'sand.4', c: 'laub.4', s: 'gras.2', l: 'gras.3' },
  { p: 'haut.3', c: 'laub.4', s: 'gras.2', l: 'gras.3' },
];
const blume: Motiv = (b, rng, x, y) => {
  const f = BLUETEN[rng.int(0, BLUETEN.length)] ?? BLUETEN[0] ?? {};
  form(b, x - 1, y - 5, ['.p.', 'pcp', '.p.', '.s.', 'ls.', '.sl'], f, WIND, 'pc');
};

const pilzchen: Motiv = (b, rng, x, y) => pilz(b, x, y, rng.int(2, 4), rng.bool(0.5) ? 4 : 3, 2, { kontur: 'laub.0', hut: ['laub.1', 'laub.2', 'laub.3'], stiel: ['sand.3', 'sand.4'] });

const BLAETTER: readonly (readonly string[])[] = [
  ['.lL', 'dl.'],
  ['Ll.', '.ld'],
  ['.L.', 'dld'],
];
const blatt: Motiv = (b, rng, x, y) => {
  const f = rng.bool(0.5) ? { L: 'laub.4', l: 'laub.3', d: 'laub.2' } : { L: 'laub.3', l: 'laub.2', d: 'laub.1' };
  form(b, x - 1, y - 1, BLAETTER[rng.int(0, BLAETTER.length)] ?? BLAETTER[0] ?? [], f, 0, 'Lld');
};

function bueschel(farben: HalmFarben, kontur: string, hoehe: number, material: number = WIND): Motiv {
  return (b, rng, x, y) => {
    const n = rng.int(3, 6);
    const liste: Halm[] = Array.from({ length: n }, (_, i) => ({ dx: i - Math.floor(n / 2), hoehe: Math.round(hoehe * rng.float(0.6, 1)), neigung: Math.round((i - n / 2) * 0.8 + rng.float(-0.8, 0.8)) }));
    const vorher = Uint8Array.from(b.index);
    halme(b, x, y, liste, farben, material);
    umranden(b, vorher, kontur, material);
  };
}

function kissen(farben: readonly [string, string, string]): Motiv {
  return (b, rng, x, y) => {
    polster(b, rng, x, y - 1, rng.float(3.5, 5), rng.float(2, 2.8), farben);
  };
}

/** Kammmuschel: Fächer mit Rippen (hell/mittel im Wechsel), Schloss unten. */
const MUSCHEL = ['.ooo.', 'oLlLo', 'oLlLo', 'ommmo', '.ooo.'];
/** Schneckenhaus: Spirale mit hellem Umgang und dunkler Mündung. */
const SCHNECKE = ['.ooo.', 'oLLlo', 'oLolo', 'ommlo', '.ooo.'];
const muschel: Motiv = (b, rng, x, y) => {
  const f = { o: 'haut.1', L: 'haut.4', l: 'haut.3', m: 'haut.2' };
  if (rng.bool(0.6)) form(b, x - 2, y - 5, MUSCHEL, f, 0, 'oLlm');
  else form(b, x - 2, y - 5, rng.bool(0.5) ? SCHNECKE : gespiegelt(SCHNECKE), { o: 'sand.0', L: 'sand.4', l: 'sand.3', m: 'sand.1' }, 0, 'oLlm');
};

const treibholz: Motiv = (b, rng, x, y) => {
  const lang = rng.int(8, 11);
  const x0 = x - Math.floor(lang / 2);
  const steigt = rng.bool(0.5);
  for (let i = 0; i < lang; i++) {
    const yy = y - 2 + (steigt ? (i > lang / 2 ? -1 : 0) : i > lang / 2 ? 1 : 0);
    b.set(x0 + i, yy, 'holz.4', 0, 2);
    b.set(x0 + i, yy + 1, 'holz.3', 0, 1.5);
  }
  // Aststummel.
  b.set(x0 + 3, y - 3, 'holz.4', 0, 2);
  b.set(x0 + 2, y - 4, 'holz.3', 0, 2);
  const vorher = new Uint8Array(W * H);
  umranden(b, vorher, 'holz.1');
};

const tang: Motiv = (b, rng, x, y) => {
  const f = ['laub.0', 'laub.1', 'laub.2'];
  for (let s = 0; s < 3; s++) {
    let yy = y - 1 - s;
    for (let i = -3; i <= 3; i++) {
      if (rng.bool(0.3)) yy += rng.bool(0.5) ? 1 : -1;
      yy = Math.max(y - 4, Math.min(y, yy));
      b.set(x + i, yy, f[(s + (i & 1)) % 3] ?? 'laub.1', 0, 1);
    }
  }
};

const KNOCHEN = ['o.....o', 'LlllllL', 'o.....o'];
const KNOCHEN_SCHRAEG = ['oL...', '.lo..', '..lo.', '...lL', '....o'];
const knochen: Motiv = (b, rng, x, y) => {
  const f = { o: 'sand.2', L: 'eis.4', l: 'sand.4' };
  const r = rng.int(0, 3);
  const z = r === 0 ? KNOCHEN : r === 1 ? KNOCHEN_SCHRAEG : gespiegelt(KNOCHEN_SCHRAEG);
  form(b, x - Math.floor((z[0]?.length ?? 0) / 2), y - z.length, z, f, 0, 'oLl');
  umranden(b, new Uint8Array(W * H), 'sand.1');
};

const EIS: PrismaFarben = { kontur: 'wasser.2', dunkel: 'eis.0', mitte: 'eis.1', licht: 'eis.3', kern: 'eis.4' };
const eisbrocken: Motiv = (b, rng, x, y) => {
  prisma(b, x, y, rng.int(3, 5), rng.float(3, 4), rng.float(-0.6, 0.6), EIS);
};

const ZAPFEN = ['.o.', 'olo', 'dld', 'old', '.d.'];
const zapfen: Motiv = (b, _rng, x, y) => form(b, x - 1, y - 5, ZAPFEN, { o: 'holz.1', l: 'holz.3', d: 'holz.2' }, 0, 'old');

/** Tonscherben: heller Rand (Lippe), bemaltes Band, Scherbenkörper, Bruchkante dunkel. */
const SCHERBEN: readonly (readonly string[])[] = [
  ['rrrr.', 'kkkko', 'bbbo.', 'bbo..'],
  ['.rrr', 'kkko', 'bbbo', '.oo.'],
  ['rrr..', 'kkkk.', 'bbbbo', '.bbo.'],
];
const scherbe: Motiv = (b, rng, x, y) => {
  const z = SCHERBEN[rng.int(0, SCHERBEN.length)] ?? SCHERBEN[0] ?? [];
  form(b, x - 2, y - 4, rng.bool(0.5) ? z : gespiegelt(z), { r: 'haut.3', k: 'nacht.2', b: 'haut.2', o: 'haut.1' }, 0, 'rkbo');
  umranden(b, new Uint8Array(W * H), 'haut.0');
};

const QUADER = ['ohhhho', 'ollllo', 'ommmmo', 'oddddo', '.oooo.'];
/** Kleiner behauener Stein mit Fase: Oberseite hell, Front mittel, Kante dunkel. */
const KLOTZ = ['ohho', 'ollo', 'oddo', '.oo.'];
const ruinenbrocken: Motiv = (b, rng, x, y) => {
  const f = { o: 'stein.1', h: 'stein.5', l: 'stein.4', m: 'stein.3', d: 'stein.2' };
  if (rng.bool(0.6)) form(b, x - 3, y - 5, QUADER, f, 0, 'ohlmd');
  else form(b, x - 2, y - 4, KLOTZ, f, 0, 'ohld');
};

const aschehaufen: Motiv = (b, rng, x, y) => {
  polster(b, rng, x, y - 1, rng.float(3.5, 4.5), rng.float(2, 2.6), ['nacht.2', 'nacht.3', 'nacht.4']);
  if (rng.bool(0.5)) {
    b.akzent(x, y - 1, 'feuer.3*', 0, 1);
    b.akzent(x + 1, y - 1, 'feuer.2*', 0, 1);
  }
};

const schwefel: Motiv = (b, rng, x, y) => {
  polster(b, rng, x, y - 1, rng.float(3.5, 4.5), rng.float(2, 2.6), ['sand.1', 'sand.2', 'sand.3']);
  // Schwefelkristalle: kleine gelbe Nadeln (2 px) auf der Kruste.
  for (const dx of [-2, 1]) {
    b.akzent(x + dx, y - 3, 'feuer.5', 0, 2);
    b.akzent(x + dx, y - 2, 'sand.4', 0, 2);
  }
};

const glutstein: Motiv = (b, rng, x, y) => {
  kiesel(b, x, y, rng.float(1.8, 2.5), rng.float(1.2, 1.6), ['nacht.0', 'nacht.1', 'nacht.2', 'nacht.3']);
  b.akzent(x, y - 1, 'feuer.4*', 0, 2);
  b.akzent(x - 1, y - 1, 'feuer.3*', 0, 2);
};

const OBSIDIAN: PrismaFarben = { kontur: 'nacht.0', dunkel: 'nacht.0', mitte: 'nacht.1', licht: 'verderb.2', kern: 'eis.1' };
const obsidian: Motiv = (b, rng, x, y) => prisma(b, x, y, rng.int(4, 7), 3, rng.float(-0.8, 0.8), OBSIDIAN);

const KRISTALL: PrismaFarben = { kontur: 'wasser.1', dunkel: 'wasser.3', mitte: 'wasser.4', licht: 'wasser.5', kern: 'eis.4*' };
const kristall: Motiv = (b, rng, x, y) => prisma(b, x, y, rng.int(4, 8), 3, rng.float(-0.5, 0.5), KRISTALL);

/** Glasscherben: flache, spitze Splitter; heller Glanz an der Kante, Körper durchscheinend. */
const GLAS = [
  ['..ll.', '.lmmo', 'lmmo.', 'oo...'],
  ['ll...', 'omml.', '.ommo', '...oo'],
  ['.ll..', 'lmml.', 'ommmo', '.ooo.'],
] as const;
const glasscherbe: Motiv = (b, rng, x, y) => {
  const z = GLAS[rng.int(0, GLAS.length)] ?? GLAS[0];
  form(b, x - 2, y - 4, z, { l: 'eis.4', m: 'eis.2', o: 'wasser.3' }, GLANZ, 'lmo');
};

const ranke: Motiv = (b, rng, x, y) => {
  // Eingerollte Ranke: Bogen nach außen, am Ende ein glühender Knoten.
  const dir = rng.bool(0.5) ? 1 : -1;
  const punkte: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [2, -1],
    [3, -1],
    [4, -2],
    [4, -3],
    [3, -4],
    [2, -4],
    [2, -3],
  ];
  punkte.forEach(([dx, dy], i) => b.set(x + dx * dir - 2 * dir, y + dy, i < 4 ? 'verderb.1' : 'verderb.2', 0, 1));
  b.akzent(x + 2 * dir - 2 * dir, y - 3, 'verderb.4*', 0, 1);
  b.akzent(x + 3 * dir - 2 * dir, y - 3, 'verderb.4*', 0, 1);
};

const kraterstein: Motiv = (b, rng, x, y) => {
  kiesel(b, x, y, rng.float(1.8, 2.6), rng.float(1.2, 1.6), STEIN_K);
  if (rng.bool(0.5)) b.akzent(x, y - 1, 'verderb.3', 0, 2);
};

const wurzel: Motiv = (b, rng, x, y) => {
  let yy = y - 2;
  for (let i = -4; i <= 4; i++) {
    if (i % 3 === 0 && rng.bool(0.6)) yy += rng.bool(0.5) ? 1 : -1;
    yy = Math.max(y - 4, Math.min(y - 1, yy));
    b.set(x + i, yy, 'holz.2', 0, 1.5);
    b.set(x + i, yy + 1, 'holz.1', 0, 1);
  }
  umranden(b, new Uint8Array(W * H), 'holz.0');
};

const leuchtmoos: Motiv = (b, rng, x, y) => {
  polster(b, rng, x, y - 1, rng.float(3.5, 4.5), rng.float(2, 2.6), ['gras.1', 'gras.2', 'gras.3']);
  for (const [dx, dy] of [
    [-2, -2],
    [1, -3],
    [2, -1],
  ] as const) {
    b.akzent(x + dx, y + dy, 'wasser.5*', 0, 1.5);
    b.akzent(x + dx + 1, y + dy, 'wasser.4*', 0, 1.5);
  }
};

const flechte = kissen(['gras.2', 'gras.3', 'gras.4']);

// ---------------------------------------------------------------------------------------------
// Typen (Reihenfolge wie in worldObjects.ts)
// ---------------------------------------------------------------------------------------------

const TYPEN: readonly Dekotyp[] = [
  { typ: 'steinchen', hoehe: 'kugel', motiv: steinchen, anzahl: [3, 5], abstand: 4 },
  { typ: 'blumen', hoehe: 'kugel', motiv: blume, anzahl: [2, 4], abstand: 4, einzelpixel: 'Blütenmitte: ein Pixel in der Mitte des Blütenkreuzes ist gewollt' },
  { typ: 'pilze', hoehe: 'kugel', motiv: pilzchen, anzahl: [2, 3], abstand: 4 },
  { typ: 'laub', hoehe: 'flach', motiv: blatt, anzahl: [4, 6], abstand: 3, einzelpixel: 'Blattadern und Stiele: Einzelpixel im Blatt sind gewollt' },
  { typ: 'graeser', hoehe: 'kugel', motiv: bueschel(['gras.2', 'gras.3', 'gras.4', 'gras.5'], 'gras.1', 6), anzahl: [2, 3], abstand: 5 },
  { typ: 'moos', hoehe: 'flach', motiv: kissen(['gras.2', 'gras.4', 'gras.5']), anzahl: [1, 2], abstand: 7 },
  { typ: 'muscheln', hoehe: 'kugel', motiv: muschel, anzahl: [2, 3], abstand: 5 },
  { typ: 'treibholz', hoehe: 'kugel', motiv: treibholz, anzahl: [1, 1], abstand: 8, bereich: [1, 1] },
  { typ: 'tang', hoehe: 'flach', motiv: tang, anzahl: [1, 2], abstand: 6 },
  { typ: 'moorgras', hoehe: 'kugel', motiv: bueschel(['gras.1', 'gras.2', 'gras.3', 'gras.4'], 'gras.0', 7), anzahl: [2, 3], abstand: 5 },
  { typ: 'knochen', hoehe: 'kugel', motiv: knochen, anzahl: [1, 2], abstand: 6, einzelpixel: 'Knochenenden: Gelenkknöpfe als Einzelpixel sind gewollt' },
  { typ: 'eisbrocken', hoehe: 'kugel', motiv: eisbrocken, anzahl: [2, 3], abstand: 4 },
  { typ: 'zapfen', hoehe: 'kugel', motiv: zapfen, anzahl: [2, 3], abstand: 4 },
  { typ: 'trockengras', hoehe: 'kugel', motiv: bueschel(['sand.0', 'sand.1', 'sand.2', 'sand.3'], 'erde.1', 6), anzahl: [2, 3], abstand: 5 },
  { typ: 'tonscherben', hoehe: 'kugel', motiv: scherbe, anzahl: [2, 3], abstand: 5 },
  { typ: 'ruinenbrocken', hoehe: 'kugel', motiv: ruinenbrocken, anzahl: [2, 2], abstand: 6 },
  { typ: 'aschehaufen', hoehe: 'flach', motiv: aschehaufen, anzahl: [1, 2], abstand: 7, einzelpixel: 'Glutkern im Aschehaufen ist gewollt' },
  { typ: 'schwefelkruste', hoehe: 'flach', motiv: schwefel, anzahl: [1, 2], abstand: 7 },
  { typ: 'glutsteine', hoehe: 'kugel', motiv: glutstein, anzahl: [2, 3], abstand: 4, einzelpixel: 'Glutkerne in den Steinen sind gewollt' },
  { typ: 'obsidiansplitter', hoehe: 'kugel', motiv: obsidian, anzahl: [2, 3], abstand: 4 },
  { typ: 'kristallsplitter', hoehe: 'kugel', motiv: kristall, anzahl: [2, 3], abstand: 4 },
  { typ: 'kristallgras', hoehe: 'kugel', motiv: bueschel(['wasser.2', 'wasser.3', 'wasser.4', 'eis.3'], 'wasser.1', 6, GLANZ), anzahl: [2, 3], abstand: 5 },
  { typ: 'glasscherben', hoehe: 'flach', motiv: glasscherbe, anzahl: [2, 3], abstand: 4 },
  { typ: 'verderbnisranken', hoehe: 'flach', motiv: ranke, anzahl: [2, 3], abstand: 4, einzelpixel: 'Glühende Rankenknoten sind gewollt' },
  { typ: 'kratersteine', hoehe: 'kugel', motiv: kraterstein, anzahl: [2, 4], abstand: 4, einzelpixel: 'Violetter Glanz im Kraterstein ist gewollt' },
  { typ: 'wurzelstraenge', hoehe: 'flach', motiv: wurzel, anzahl: [1, 2], abstand: 5 },
  { typ: 'leuchtmoos', hoehe: 'flach', motiv: leuchtmoos, anzahl: [1, 2], abstand: 7, einzelpixel: 'Leuchtsporen im Moos: Zweiergruppen aus Kern und Rand sind gewollt' },
  { typ: 'flechten', hoehe: 'flach', motiv: flechte, anzahl: [2, 3], abstand: 5 },
];

/** Eine Variante: Motive an zufälligen, sich nicht berührenden Stellen, von hinten nach vorn. */
function variante(rng: Rng, t: Dekotyp): Bild {
  const b = new Bild(W, H);
  const [bx, by] = t.bereich ?? [4.5, 2.5];
  const n = rng.int(t.anzahl[0], t.anzahl[1] + 1);
  const punkte: Array<[number, number]> = [];
  for (let i = 0; i < 60 && punkte.length < n; i++) {
    const x = Math.round(8 + rng.float(-bx, bx));
    const y = Math.round(FUSS - 1 - by + rng.float(-by, by));
    if (punkte.every(([px, py]) => Math.hypot(px - x, (py - y) * 1.5) >= t.abstand)) punkte.push([x, y]);
  }
  punkte.sort((a, c) => a[1] - c[1]);
  for (const [x, y] of punkte) t.motiv(b, rng, x, y);
  // 1 px Luft zum Zellrand (Interaktions-Outline).
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) b.clear(x, y);
  saeubere(b);
  return b;
}

function dekoSprite(rng: Rng, t: Dekotyp): Sprite {
  const frames = Array.from({ length: VARIANTEN }, () => variante(rng, t));
  return spriteFromPixels(
    {
      id: `deko_${t.typ}`,
      group: GRUPPE,
      size: [W, H],
      anchor: [W / 2, FUSS],
      hoehe: t.hoehe,
      ...(t.einzelpixel !== undefined ? { einzelpixel: t.einzelpixel } : {}),
    },
    frames.map((f) => f.frame()),
  );
}

/** Typ-Ids der Streudeko in Reihenfolge (für Tests). */
export const DEKO_TYPEN: readonly string[] = TYPEN.map((t) => t.typ);

export default defineGenerator('streudeko', (rng: Rng): Sprite[] => TYPEN.map((t) => dekoSprite(rng, t))).generate(206, undefined);
