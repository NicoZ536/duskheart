/**
 * Herdfeuer (M4-20, docs/SPIEL.md §8, MASTERPROMPT §16.5) – der Kern der Basis: `obj_herdfeuer`
 * (48×48, Stellfläche 3×3, Anker Mitte der Vorderkante) und der eingesetzte Glutkern
 * `obj_herdfeuer_glutkern` (8×8, emissiv, pulsierend).
 *
 * Aufbau: ein breiter Ring aus behauenen Decksteinen (Fugen strahlenförmig, außen dunkler, innen heller),
 * vorn zwei Lagen Mauerwerk; in der Mulde Asche und gekreuzte Scheite. Sechs Nischen im Ring tragen die
 * Glutkerne (Sockel `glutkern_1` … `glutkern_6`, einer je entzündetem Leuchtfeuer; der Renderer setzt
 * `obj_herdfeuer_glutkern` mit seinem Anker auf den Sockel). Clips: `aus` (kalt), `brennt` (sechs
 * Flammenformen, 12 fps: Ruhe → Ducken → Strecken mit abreißender Spitze → Neigen rechts → zwei Zungen →
 * Neigen links), `glut` (nur Glut auf den Scheiten, 4 fps). Nur Flammen und Glut leuchten, der Kern ist
 * heller als der Rand. Sockel `licht` im Flammenkern.
 *
 * Der Steinring entsteht aus Regeln (Ellipsen für Deckring, Mulde und Front, Fugen nach Winkel bzw. Lage),
 * die Flamme ist handgezeichnet; die fünf Bewegungsformen entstehen aus ihr durch zeilenweises
 * Versetzen und Stauchen.
 */
import { station, ueber } from './_stationen';

const B = 48;
const H = 48;
/** Mitte und Halbachsen des Deckrings (außen), der Mulde und die Höhe der Front. */
const CX = 23.5;
const CY = 30;
const RX_AUSSEN = 22;
const RY_AUSSEN = 10;
const RX_INNEN = 14;
const RY_INNEN = 5.5;
const FRONT = 7;
/** Anzahl der Decksteine im Ring. */
const DECKSTEINE = 14;
/** Winkel der sechs Glutkern-Nischen (Bogenmaß, 0 = Osten, im Uhrzeigersinn auf dem Bildschirm). */
const NISCHEN = [Math.PI * (7 / 6), Math.PI * (9 / 6), Math.PI * (11 / 6), Math.PI * (1 / 6), Math.PI * (3 / 6), Math.PI * (5 / 6)];
/** Mittlerer Ringradius (Anteil zwischen innen und außen) für die Nischen. */
const NISCHE_RING = 0.55;

function ellipse(x: number, y: number, rx: number, ry: number): number {
  const dx = (x + 0.5 - CX) / rx;
  const dy = (y + 0.5 - CY) / ry;
  return dx * dx + dy * dy;
}

/** Nischenmitten (Pixel) in Reihenfolge `glutkern_1` … `glutkern_6`. */
export const NISCHEN_PUNKTE: ReadonlyArray<readonly [number, number]> = NISCHEN.map((w) => {
  const rx = RX_INNEN + (RX_AUSSEN - RX_INNEN) * NISCHE_RING;
  const ry = RY_INNEN + (RY_AUSSEN - RY_INNEN) * NISCHE_RING;
  return [Math.round(CX + Math.cos(w) * rx - 0.5), Math.round(CY + Math.sin(w) * ry - 0.5)] as const;
});

/** Steinring mit Mulde, Front und Nischen als Raster. */
function ring(): string {
  const g: string[][] = Array.from({ length: H }, () => Array.from({ length: B }, () => '.'));
  const inRing = (x: number, y: number): boolean => ellipse(x, y, RX_AUSSEN, RY_AUSSEN) <= 1;
  const inMulde = (x: number, y: number): boolean => ellipse(x, y, RX_INNEN, RY_INNEN) <= 1;
  // Unterkante des Deckrings je Spalte (für die Front).
  const unterkante = Array.from({ length: B }, (_, x) => {
    let u = -1;
    for (let y = 0; y < H; y++) if (inRing(x, y)) u = y;
    return u;
  });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < B; x++) {
      const row = g[y];
      if (row === undefined) continue;
      if (inRing(x, y) && !inMulde(x, y)) {
        const w = Math.atan2(y + 0.5 - CY, (x + 0.5 - CX) * (RY_AUSSEN / RX_AUSSEN));
        const t = Math.sqrt(ellipse(x, y, RX_AUSSEN, RY_AUSSEN));
        const segment = ((w + Math.PI) / (2 * Math.PI)) * DECKSTEINE;
        const fuge = segment - Math.floor(segment) < 0.09;
        row[x] = fuge ? '3' : t > 0.88 ? '4' : t > 0.72 && (Math.floor(segment) % 3 === 0) ? '4' : '5';
      } else if (inMulde(x, y)) {
        // Mulde: hinten die Innenwand des Rings (zur Kamera), sonst Asche.
        const oben = !inMulde(x, y - 3);
        row[x] = oben && y + 0.5 < CY ? '3' : '2';
      } else {
        const u = unterkante[x] ?? -1;
        if (u >= 0 && y > u && y <= u + FRONT && y + 0.5 > CY) {
          const lage = y - u - 1;
          const versatz = lage < 3 ? 0 : 4;
          const fugeSenk = (x + versatz) % 8 === 0;
          row[x] = lage === 3 ? '2' : fugeSenk ? '2' : lage === 0 || lage === 4 ? '4' : '3';
        }
      }
    }
  }
  // Nischen: kleine Mulden im Deckring.
  for (const [nx, ny] of NISCHEN_PUNKTE) {
    for (const [dx, dy, c] of [
      [-1, 0, 'k'],
      [0, 0, 'k'],
      [1, 0, 'k'],
      [-1, 1, '2'],
      [0, 1, '2'],
      [1, 1, '2'],
    ] as const) {
      const row = g[ny + dy];
      if (row !== undefined && row[nx + dx] !== undefined && row[nx + dx] !== '.') row[nx + dx] = c;
    }
  }
  // Kontur: Randpixel gegen leer; Fuß der Front als Bodenkontakt.
  const voll = (x: number, y: number): boolean => (g[y]?.[x] ?? '.') !== '.';
  const kontur: Array<[number, number]> = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < B; x++) if (voll(x, y) && (!voll(x - 1, y) || !voll(x + 1, y) || !voll(x, y - 1) || !voll(x, y + 1))) kontur.push([x, y]);
  for (const [x, y] of kontur) {
    const row = g[y];
    if (row !== undefined) row[x] = 'k';
  }
  // Muldenrand vorn: dunkle Kante, wo der Ring zur Mulde abfällt.
  for (let y = 1; y < H; y++) {
    for (let x = 0; x < B; x++) {
      const row = g[y];
      if (row !== undefined && inMulde(x, y) && !inMulde(x, y + 1) && inRing(x, y + 1)) row[x] = '1';
    }
  }
  return g.map((r) => r.join('')).join('\n');
}

const RING = ring();

/** Gekreuzte Scheite in der Mulde. */
const SCHEITE = `..kk..........kk..
                  .kcck........kcck.
                  ..kbcck....kkcbk..
                  ....kbcckkccbkk...
                  ......kbccbck.....
                  ....kkccbkbcck....
                  ..kkcbkk...kbcckk.
                  .kcbkk.......kbcbk
                  ..kk...........kk.`;

/** Glut auf den Scheiten (zwei Helligkeiten). */
const GLUT_HELL = `..................
                   ..................
                   ....}.......}.....
                   ......}+..+}......
                   .......}==}.......
                   ......}+..+}......
                   ....}.......}.....
                   ..................
                   ..................`;
const TIEFER: Readonly<Record<string, string>> = { '=': '+', '+': '}' };
const GLUT_MATT = [...GLUT_HELL].map((c) => TIEFER[c] ?? c).join('');

/** Grundflamme (18 × 24): Kern `@` unten innen, Rand `}` an den Zungen. */
const FLAMME = `........}.........
                ........}}........
                .......}}}........
                .......}}}...}....
                ......}}+}...}}...
                ......}++}..}}}...
                .....}}++}}.}+}...
                .....}+++}}}}+}...
                ....}}+=+}}}++}...
                ....}++=++}}+=}}..
                ...}}+==+++}+=+}..
                ...}++==+=++==+}..
                ..}}+=@==+==+=++}.
                ..}++=@@==@=+==+}.
                ..}+==@@@==@@=++}.
                .}}+=@@@@@@@=+++}.
                .}++=@@@@@@@==++}.
                .}+==@@@@@@@@=+}}.
                .}+=@@@@@@@@@==+}.
                ..}+=@@@@@@@@=+}..
                ..}+==@@@@@@==+}..
                ...}+==@@@@==+}...
                ....}++====++}....
                .....}}++++}}.....`;

function zeilenVon(t: string): string[] {
  return t
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z.length > 0);
}

/** Versetzt jede Zeile um `versatz(zeile)` px (positiv = rechts), Breite bleibt. */
function versetze(t: string, versatz: (zeile: number, anzahl: number) => number): string {
  const z = zeilenVon(t);
  return z
    .map((zeile, i) => {
      const v = versatz(i, z.length);
      const breite = zeile.length;
      const neu = v >= 0 ? '.'.repeat(v) + zeile : zeile.slice(-v);
      return neu.slice(0, breite).padEnd(breite, '.');
    })
    .join('\n');
}

/** Staucht die Flamme um `n` Zeilen (oberste Zeilen fallen weg, unten bleibt der Kern). */
function ducke(t: string, n: number): string {
  const z = zeilenVon(t);
  const leer = '.'.repeat(z[0]?.length ?? 0);
  return [...Array.from({ length: n }, () => leer), ...z.slice(n)].join('\n');
}

const RUHE = FLAMME;
const DUCKEN = ducke(FLAMME, 3);
/** Strecken: die Spitze reißt ab und schwebt 2 px höher. */
const STRECKEN = zeilenVon(FLAMME)
  .map((z, i) => (i === 0 ? '.........}........' : i === 1 ? '..................' : i === 2 ? '........}}........' : z))
  .join('\n');
const RECHTS = versetze(FLAMME, (i, n) => Math.round(((n - 1 - i) / (n - 1)) ** 1.5 * 3));
const LINKS = versetze(FLAMME, (i, n) => -Math.round(((n - 1 - i) / (n - 1)) ** 1.5 * 3));
/** Flackern: zwei Zungen – die rechte Nebenzunge wächst, die Hauptspitze teilt sich. */
const ZUNGEN = zeilenVon(FLAMME)
  .map((z, i) => (i === 0 ? '.......}....}.....' : i === 1 ? '.......}}..}}.....' : i === 2 ? '......}}}..}}}....' : z))
  .join('\n');

/** Setzt die Flamme mittig über die Mulde (Kern auf Höhe der Scheite). */
const FLAMME_X = 15;
const FLAMME_Y = 7;
const SCHEITE_X = 15;
const SCHEITE_Y = 25;

function mitFeuer(flamme: string | null, glut: string | null): string {
  let r = ueber(RING, SCHEITE, SCHEITE_X, SCHEITE_Y);
  if (glut !== null) r = ueber(r, glut, SCHEITE_X, SCHEITE_Y);
  if (flamme !== null) r = ueber(r, flamme, FLAMME_X, FLAMME_Y);
  return r;
}

const FLAMMEN = [RUHE, DUCKEN, STRECKEN, RECHTS, ZUNGEN, LINKS];

/** Lichtpunkt im Flammenkern je Frame (aus = am Boden der Mulde). */
const LICHT_VOLL: [number, number] = [FLAMME_X + 9, FLAMME_Y + 17];
const LICHT_GLUT: [number, number] = [SCHEITE_X + 9, SCHEITE_Y + 4];

const herdfeuer = station({
  item: 'herdfeuer',
  size: [B, H],
  anchor: [24, 46],
  hoehe: 'block',
  frames: [mitFeuer(null, null), ...FLAMMEN.map((f) => mitFeuer(f, GLUT_HELL)), mitFeuer(null, GLUT_MATT), mitFeuer(null, GLUT_HELL)],
  clips: {
    aus: { frames: [0], fps: 1, loop: true },
    brennt: { frames: [1, 2, 3, 4, 5, 6], fps: 12, loop: true },
    glut: { frames: [7, 7, 8, 8], fps: 4, loop: true },
  },
  sockets: {
    licht: [LICHT_GLUT, LICHT_VOLL, LICHT_VOLL, LICHT_VOLL, LICHT_VOLL, LICHT_VOLL, LICHT_VOLL, LICHT_GLUT, LICHT_GLUT],
    ...Object.fromEntries(NISCHEN_PUNKTE.map((p, i) => [`glutkern_${i + 1}`, [[p[0], p[1]]]])),
  },
  einzelpixel: 'Glutfunken auf den Scheiten und die abreißende Flammenspitze sind einzelne leuchtende Pixel',
  hitbox: [2, 20, 44, 27],
  occluder: { kind: 'ellipse', x: 24, y: 34, rx: 21, ry: 9 },
});

/** Eingesetzter Glutkern: geschliffene Glut in Tropfenform, Puls in vier Stufen (6 fps). */
const KERN = [
  `...kk...
   ..k}}k..
   .k}+=}k.
   .k+@@+k.
   .k}==}k.
   ..k}}k..
   ...kk...
   ........`,
  `...kk...
   ..k}+k..
   .k}=@}k.
   .k+@@=k.
   .k}=@}k.
   ..k}}k..
   ...kk...
   ........`,
  `...kk...
   ..k++k..
   .k+=@+k.
   .k=@@=k.
   .k+@@+k.
   ..k++k..
   ...kk...
   ........`,
];

const glutkern = station({
  item: 'herdfeuer_glutkern',
  size: [8, 8],
  anchor: [4, 6],
  hoehe: 'kugel',
  frames: KERN,
  clips: { idle: { frames: [0, 1, 2, 1], fps: 6, loop: true } },
  sockets: { licht: [[4, 3]] },
});

export default [herdfeuer, glutkern];
