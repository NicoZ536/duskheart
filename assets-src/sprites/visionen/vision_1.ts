/**
 * Vision 1 – die Erinnerung des ersten Leuchtfeuers (MASTERPROMPT §8 „7 Visionen (kurze In-Engine-Sequenzen mit
 * Pixel-Standbildern)“; Content src/content/beacons/index.ts `vision_1`; Bildschirm src/ui/screens/vision/; M7-35,
 * Strang F): vier Standbilder 160 × 90 (`vision_1_1` … `vision_1_4`), je ≤ 12 Farben, ohne Kontur – Illustrationen wie die
 * Zwischenbilder eines SNES-Spiels:
 * 1. „Einst brannten sechs Feuer über Lumara“ – Nachthimmel über zwei Bergketten, auf sechs Gipfeln je ein Feuer;
 * 2. „Sie griffen nach dem Urfeuer – und rissen das Nachtherz auf“ – eine Lichtsäule über dem Turm der Erbauer, darunter
 *    der violette Riss, der durch das Land bricht;
 * 3. „Eines nach dem anderen erloschen die Feuer … nach Süden, ans Meer“ – kalte Gipfel, eine Gestalt trägt eine Glut den
 *    Hang hinab zur Küste, der Mond spiegelt sich im Meer;
 * 4. „Das erste Feuer brennt wieder. Fünf warten noch“ – Morgendämmerung über dem Grünhain, das Leuchtfeuer brennt auf
 *    seinem Hügel, fünf ferne dunkle Gipfel.
 * Himmel in Bändern ungleicher Höhe mit gewellten Grenzen (Wolkenzüge statt Streifen, docs/ART.md §2.3 „kein Banding“),
 * Bergketten als Profile aus überlagerten Wellen; Feuer, Glut, Riss und Sterne leuchten (emissiv). Alles deterministisch.
 */
import { Rng } from '../../../src/engine/rng';
import { spriteFromPixels, type Sprite } from '../../lib/sprite';
import { Leinwand } from '../leuchtfeuer/_maler';

const W = 160;
const H = 90;
const GRUPPE = 'visionen';

/** Himmel: Bänder von oben nach unten; jede Grenze wellt sich (Höhe `basis`, Ausschlag `amp`). */
function himmel(l: Leinwand, baender: readonly { readonly ref: string; readonly bis: number; readonly amp: number; readonly phase: number }[]): void {
  for (let x = 0; x < W; x++) {
    let y0 = 0;
    for (const b of baender) {
      const grenze = Math.round(b.bis + b.amp * Math.sin(x * 0.07 + b.phase) + b.amp * 0.5 * Math.sin(x * 0.19 + b.phase * 2));
      for (let y = y0; y < Math.min(H, grenze); y++) l.set(x, y, b.ref);
      y0 = Math.max(y0, grenze);
    }
    for (let y = y0; y < H; y++) l.set(x, y, baender[baender.length - 1]?.ref ?? 'nacht.0');
  }
}

/** Bergkette: Profil `basis − Σ amp·sin(f·x + p)` (ganze Pixel), darunter gefüllt bis zum Bildrand. */
function kette(l: Leinwand, ref: string, basis: number, wellen: readonly (readonly [number, number, number])[], kante?: string): (x: number) => number {
  const profil = (x: number): number => Math.round(basis - wellen.reduce((s, [amp, f, p]) => s + amp * Math.sin(f * x + p), 0));
  for (let x = 0; x < W; x++) {
    const top = profil(x);
    for (let y = Math.max(0, top); y < H; y++) l.set(x, y, kante !== undefined && y === top ? kante : ref);
  }
  return profil;
}

/** Sterne: Einzelpunkte und wenige Kreuze im Himmel oberhalb von `bis`. */
function sterne(l: Leinwand, rng: Rng, anzahl: number, bis: number, ref: string): void {
  for (let i = 0; i < anzahl; i++) {
    const x = rng.int(2, W - 2);
    const y = rng.int(1, bis);
    l.set(x, y, ref);
    if (i % 7 === 0) {
      l.set(x - 1, y, ref);
      l.set(x + 1, y, ref);
      l.set(x, y - 1, ref);
      l.set(x, y + 1, ref);
    }
  }
}

/** Kleines Feuer auf einem Gipfel (Fuß bei x, y): Größe 1 = 3 × 5, 2 = 5 × 8. */
function feuer(l: Leinwand, x: number, y: number, groesse: 1 | 2, ruhend = false, rand = 'feuer.2*'): void {
  const KLEIN = ['.r.', 'rfr', 'fFf', 'FyF', '.y.'];
  const GROSS = ['..r..', '..r..', '.rfr.', '.fFf.', 'rfFyf', 'fFyWF', 'FyWyF', '.yWy.'];
  const MAP: Record<string, string> = ruhend
    ? { r: 'feuer.2', f: 'feuer.2', F: 'feuer.3', y: 'feuer.3', W: 'feuer.4' }
    : { r: rand, f: 'feuer.3*', F: 'feuer.4*', y: 'feuer.4*', W: 'feuer.5*' };
  const form = groesse === 1 ? KLEIN : GROSS;
  const breite = form[0]?.length ?? 0;
  form.forEach((zeile, dy) =>
    [...zeile].forEach((c, dx) => {
      const ref = MAP[c];
      if (ref !== undefined) l.set(x - Math.floor(breite / 2) + dx, y - form.length + dy, ref);
    }),
  );
}

/** Die Gipfel einer Kette (lokale Minima des Profils, von links nach rechts), höchstens `n`. */
function gipfel(profil: (x: number) => number, n: number, rand = 12): number[] {
  const out: number[] = [];
  for (let x = rand; x < W - rand; x++) {
    const y = profil(x);
    if (y <= profil(x - 1) && y < profil(x + 1) && y <= profil(x - 3) && y <= profil(x + 3)) {
      if (out.length > 0 && x - (out[out.length - 1] ?? 0) < 14) continue;
      out.push(x);
    }
  }
  return out.slice(0, n);
}

/** 1 – sechs Feuer über Lumara. */
function bild1(): Leinwand {
  const l = new Leinwand(W, H);
  himmel(l, [
    { ref: 'nacht.0', bis: 22, amp: 2, phase: 0.4 },
    { ref: 'nacht.1', bis: 40, amp: 3, phase: 1.7 },
    { ref: 'nacht.2', bis: 54, amp: 2, phase: 3.1 },
    { ref: 'wasser.0', bis: 90, amp: 0, phase: 0 },
  ]);
  sterne(l, new Rng(101), 46, 44, 'eis.4*');
  kette(l, 'nacht.3', 62, [
    [7, 0.05, 0.3],
    [4, 0.13, 1.1],
  ]);
  const nah = kette(
    l,
    'nacht.1',
    72,
    [
      [9, 0.045, 2.2],
      [5, 0.11, 0.4],
      [2, 0.31, 1.0],
    ],
    'nacht.2',
  );
  for (const x of gipfel(nah, 6)) feuer(l, x, nah(x), 1);
  return l;
}

/** 2 – das Urfeuer und der Riss im Nachtherz. */
function bild2(): Leinwand {
  const l = new Leinwand(W, H);
  himmel(l, [
    { ref: 'nacht.0', bis: 30, amp: 3, phase: 0.9 },
    { ref: 'nacht.1', bis: 52, amp: 4, phase: 2.4 },
    { ref: 'verderb.1', bis: 90, amp: 0, phase: 0 },
  ]);
  const boden = kette(
    l,
    'nacht.2',
    66,
    [
      [3, 0.06, 0.2],
      [2, 0.17, 1.4],
    ],
    'stein.1',
  );
  // Der Turm der Erbauer: gestufte Silhouette in der Mitte.
  const cx = 80;
  const STUFEN: readonly (readonly [number, number])[] = [
    [14, 66],
    [11, 58],
    [8, 50],
    [5, 43],
  ];
  for (const [halb, oben] of STUFEN)
    for (let y = oben; y < boden(cx) + 2; y++)
      for (let x = cx - halb; x <= cx + halb; x++) l.set(x, y, x < cx - halb + 2 ? 'stein.1' : 'nacht.1');
  // Die Lichtsäule: vom Turm bis an den oberen Rand, innen weiß-gold, außen orange.
  for (let y = 0; y < 43; y++) {
    const t = y / 43;
    const halb = 3 + t * 3 + Math.sin(y * 0.5) * 0.6;
    for (let x = Math.floor(cx - halb - 2); x <= Math.ceil(cx + halb + 2); x++) {
      const d = Math.abs(x + 0.5 - cx) / halb;
      if (d > 1.35) continue;
      l.set(x, y, d < 0.45 ? 'feuer.5*' : d < 0.85 ? 'feuer.4*' : d < 1.15 ? 'feuer.3*' : 'feuer.2*');
    }
  }
  // Der Riss: zackige Linien vom Turmfuß in die Tiefe und zu den Seiten, innen hell violett.
  const rng = new Rng(202);
  const risse: readonly (readonly [number, number])[] = [
    [-1, 0.25],
    [1, 0.3],
    [-1, 0.9],
    [1, 0.85],
    [0, 1],
  ];
  for (const [seite, steil] of risse) {
    let x = cx + seite * 6;
    let y = boden(cx) + 3;
    for (let k = 0; k < 40 && y < H && x > 0 && x < W; k++) {
      const breite = Math.max(1, 3 - Math.floor(k / 12));
      for (let b = 0; b < breite; b++) {
        l.set(x + b, y, b === 0 && breite > 1 ? 'verderb.4*' : 'verderb.3*');
        l.set(x + b, y + 1, 'verderb.2*');
      }
      y += rng.float(0, 1) < steil ? 1 : 0;
      const schritt = seite === 0 ? rng.int(-1, 2) : seite * (rng.float(0, 1) < 1 - steil * 0.5 ? 2 : 1);
      // Ein Doppelschritt füllt den Pixel dazwischen: der Riss bleibt eine durchgehende Linie.
      if (Math.abs(schritt) === 2) l.set(x + schritt / 2, y, 'verderb.3*');
      x += schritt;
    }
  }
  return l;
}

/** 3 – die Feuer erlöschen; eine Glut wird zum Meer getragen. */
function bild3(): Leinwand {
  const l = new Leinwand(W, H);
  himmel(l, [
    { ref: 'nacht.0', bis: 34, amp: 3, phase: 2.0 },
    { ref: 'nacht.1', bis: 56, amp: 2, phase: 0.6 },
    { ref: 'wasser.0', bis: 90, amp: 0, phase: 0 },
  ]);
  // Der Mond oben rechts.
  for (let y = 6; y < 20; y++) for (let x = 118; x < 134; x++) if ((x + 0.5 - 126) ** 2 + (y + 0.5 - 13) ** 2 <= 36) l.set(x, y, (x + 0.5 - 126) ** 2 + (y + 0.5 - 12) ** 2 <= 12 ? 'eis.4*' : 'eis.3*');
  const berge = kette(l, 'nacht.2', 50, [
    [8, 0.04, 1.2],
    [4, 0.12, 0.2],
  ]);
  // Die erloschenen Feuer: dunkle Glutreste auf den Gipfeln.
  for (const x of gipfel(berge, 6)) {
    l.set(x, berge(x) - 1, 'nacht.3');
    l.set(x + 1, berge(x) - 1, 'nacht.3');
  }
  // Der Hang mit dem Weg hinab, darauf die Gestalt mit der Glut.
  kette(
    l,
    'nacht.1',
    70,
    [
      [10, 0.025, 2.6],
      [2, 0.15, 0.4],
    ],
    'nacht.2',
  );
  // Das Meer unten rechts: Wellenzüge, der Mond spiegelt sich als gebrochene Spur.
  const kueste = (x: number): number => Math.round(58 + (160 - x) * 0.24 + Math.sin(x * 0.2) * 1.5);
  for (let x = 0; x < W; x++) {
    const k = kueste(x);
    for (let y = Math.max(0, k); y < H; y++) {
      const welle = (y + Math.round(Math.sin(x * 0.3 + y) * 1.2)) % 4 === 0;
      l.set(x, y, welle ? 'wasser.2' : 'wasser.1');
    }
  }
  // Die Mondspur: Striche, die zum Ufer hin schmaler werden und seitlich schwanken.
  for (let y = 62; y < H; y += 2) {
    const breite = Math.max(1, 6 - Math.floor((y - 62) / 5));
    const versatz = Math.round(Math.sin(y * 0.9) * 1.5);
    for (let x = 126 - breite + versatz; x <= 126 + breite + versatz; x++) if (y >= kueste(x)) l.set(x, y, 'eis.3*');
  }
  const gx = 78;
  const gy = 74;
  // Gestalt im Umhang, im Profil nach rechts, der Arm mit der Glut vorgestreckt.
  const GESTALT = [
    '...kkk....',
    '..kkkkk...',
    '..kkkkk...',
    '...kkk....',
    '..kkkkkkk.',
    '.kkkkkk.kk',
    '.kkkkkk...',
    'kkkkkkk...',
    'kkkkkkk...',
    '.kkkkkk...',
    '..kk.kk...',
    '..kk..kk..',
  ];
  GESTALT.forEach((z, dy) => [...z].forEach((c, dx) => c === 'k' && l.set(gx + dx, gy - GESTALT.length + dy, 'nacht.0')));
  // Die Glut in der ausgestreckten Hand: heller Kern, Rand dunkler.
  const hx = gx + 10;
  const hy = gy - 8;
  for (const [dx, dy, r] of [
    [0, -1, 'feuer.4*'],
    [1, -1, 'feuer.3*'],
    [0, 0, 'feuer.5*'],
    [1, 0, 'feuer.4*'],
    [0, 1, 'feuer.3*'],
    [1, 1, 'feuer.3*'],
  ] as const)
    l.set(hx + dx, hy + dy, r);
  return l;
}

/** 4 – das erste Feuer brennt wieder; fünf warten. */
function bild4(): Leinwand {
  const l = new Leinwand(W, H);
  himmel(l, [
    { ref: 'wasser.0', bis: 18, amp: 2, phase: 1.1 },
    { ref: 'wasser.1', bis: 36, amp: 3, phase: 2.9 },
    { ref: 'wasser.2', bis: 50, amp: 2, phase: 0.5 },
    { ref: 'laub.2', bis: 90, amp: 0, phase: 0 },
  ]);
  // Fünf ferne, dunkle Gipfel rechts.
  const fern = kette(l, 'nacht.2', 60, [
    [9, 0.06, 0.9],
    [4, 0.17, 2.1],
  ]);
  for (const x of gipfel(fern, 7).filter((x) => x > 60).slice(0, 5)) {
    l.set(x, fern(x) - 1, 'nacht.1');
    l.set(x + 1, fern(x) - 1, 'nacht.1');
  }
  // Der grüne Hügel des Grünhains von links.
  const huegel = (x: number): number => Math.round(48 + ((x - 34) / 50) ** 2 * 26 + Math.sin(x * 0.2) * 0.8);
  for (let x = 0; x < W; x++) {
    const top = Math.min(H, huegel(x));
    for (let y = Math.max(0, top); y < H; y++) l.set(x, y, y - top < 2 ? 'gras.3' : y - top < 7 + Math.round(Math.sin(x * 0.3) * 2) ? 'gras.2' : 'gras.1');
  }
  // Das Leuchtfeuer auf dem Gipfel: Säule, Schale, Flamme.
  const bx = 34;
  const by = huegel(bx);
  for (let y = by - 9; y < by; y++) for (let x = bx - 2; x <= bx + 1; x++) l.set(x, y, x === bx - 2 ? 'nacht.2' : 'nacht.1');
  for (let x = bx - 4; x <= bx + 3; x++) l.set(x, by - 10, 'nacht.1');
  feuer(l, bx, by - 10, 2, false, 'feuer.3*');
  return l;
}

const BILDER: readonly (() => Leinwand)[] = [bild1, bild2, bild3, bild4];

const stills: Sprite[] = BILDER.map((male, i) =>
  spriteFromPixels(
    {
      id: `vision_1_${i + 1}`,
      group: GRUPPE,
      size: [W, H],
      anchor: [0, 0],
      hoehe: 'flach',
      schatten: 'none',
      occluder: { kind: 'none' },
      einzelpixel: 'Sterne, Glutreste und Lichtfunken der Vision sind gewollte Einzelpunkte',
    },
    [male().frame()],
  ),
);

export default stills;
