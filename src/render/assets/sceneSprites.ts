/**
 * Sprites of the render debug scenes (palette swap, y-sort, animation layers, G-buffer, stress
 * test) in the docs/RENDER.md §1 source format, built in memory by `synthetic.ts`. Hand-drawn index
 * rasters; the tree crown and the pond outline come from small deterministic generators with
 * hand-placed parameters (§5 "Generatoren … für Baumkronen"). The figure's frames are composed from
 * hand-drawn parts (upper body, leg poses, near arm) with a breathing/step bob; its left-facing
 * frames are mirrored at build time with swapped hand sockets, because sword and torch make the
 * loadout asymmetric (§4.5 "Spiegelung nur bei symmetrischer Ausrüstung").
 */
import { PALETTE_RAMPS } from '../../generated/palette';
import type { PaletteRow } from '../palette/lut';
import { identityRow } from '../palette/lut';
import { rampRemapRow } from '../palette/rows';
import type { AtlasData } from './atlas';
import { distanceToEdge } from './normals';
import { mirrorRaster, rasterRows, type SpriteSource } from './spriteSource';
import { buildAtlas } from './synthetic';

export const SCENE_GROUP = 'render-szenen';

// ---------------------------------------------------------------------------------------------
// Ground

const GRASS_LEGEND = { A: 'gras.1', B: 'gras.2', C: 'gras.3', D: 'gras.4', W: 'eis.4', y: 'feuer.4' } as const;

/** Ground variants (§4.5 "3–4 Varianten je Grundtile"): plain ground (three), two tufts, a small flower. */
export const GRASS_VARIANTS = { plainA: 0, tuftA: 1, tuftB: 2, flower: 3, plainB: 4, bare: 5 } as const;

const grasBoden: SpriteSource = {
  id: 'gras_boden',
  group: SCENE_GROUP,
  size: [16, 16],
  anchor: [0, 0],
  hoehe: 'flach',
  legende: GRASS_LEGEND,
  frames: [
    `BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBAABBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB`,
    `BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBCBCBBBBBBBBBB
     BBBCDCBBBBBBBBBB
     BBBACABBBBBBBBBB
     BBBBABBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBAABB
     BBBBBBBBBBBBBAAB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB`,
    `BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBCBCBB
     BBBBBBBBBBBCDCBB
     BBBBBBBBBBBACABB
     BBBBBBBBBBBBABBB
     BBBBBBBBBBBBBBBB
     BCCBBBBBBBBBBBBB
     BAABBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB`,
    `BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBWBBBBBBBBB
     BBBBBWyWBBBBBBBB
     BBBBBBWCBBBBBBBB
     BBBBBBACBBBBBBBB
     BBBBBBBABBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBCCBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB`,
    `BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBCCBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB`,
    `BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB
     BBBBBBBBBBBBBBBB`,
  ],
  clips: { varianten: { frames: [0, 1, 2, 3, 4, 5], fps: 1, loop: false } },
};

const erdfleck: SpriteSource = {
  id: 'erdfleck',
  group: SCENE_GROUP,
  size: [32, 16],
  anchor: [16, 8],
  hoehe: 'flach',
  legende: { '.': null, a: 'erde.1', b: 'erde.2', c: 'erde.3', s: 'stein.3', S: 'stein.4', t: 'stein.1', C: 'gras.3' },
  frames: [
    `........aaaaaaaa..aaaa..........
     ....aaaabbbbbbbbaabbbbaaa.......
     ..aabbbbbbbccbbbbbbbbbbbbaa.....
     .abbbbccbbbbbbbbbbbccbbbbbbaa...
     .abbbbbbbbsSbbbbbbbbbbbbbbbbba..
     abbccbbbbbtsbbbbbbbbbbccbbbbbba.
     aCbbbbbbbbbbbbbbbbbbbbbbbbbbbbba
     .abbbbbbbbbbbbbccbbbbbbbbsSbbbba
     .abbbbbccbbbbbbbbbbbbbbbbtsbbbCa
     ..abbbbbbbbbbbbbbbbbbbbbbbbbbba.
     ...aabbbbbbbbbbbbbbccbbbbbbbaa..
     .....aaabbbbbbbbbbbbbbbbbaaaa...
     ........aaaabbbbbbbbbaaaa.......
     ............aaaaaaaaa...........
     ................................
     ................................`,
  ],
};

/** Pond outline: an ellipse with a hand-tuned wobble per row (deterministic). */
const POND = { w: 48, h: 32, cx: 24, cy: 15, rx: 21, ry: 12 } as const;
const POND_WOBBLE = [0, 1, 1, 2, 1, 0, -1, -1, 0, 1, 2, 2, 1, 0, 0, -1, -1, 0, 1, 1, 0, -1, -2, -1, 0, 1, 1, 0, 0, 0, 0, 0];
/** Water depth bands by distance to the shore (px): shallow rim, mid, deep centre. */
const SHALLOW_WIDTH = 2;
const MID_WIDTH = 5;
/** Shore ring by distance outside the water (px): wet mud, then a broken outer rim of earth. */
const WET_MUD = 1.5;
const OUTER_RIM = 2.5;
/** Wave glints of the pond surface: row, first column, length. */
const POND_GLINTS: readonly (readonly [number, number, number])[] = [
  [8, 14, 3],
  [9, 13, 1],
  [11, 27, 4],
  [12, 26, 1],
  [16, 10, 3],
  [18, 31, 3],
  [19, 30, 1],
  [21, 19, 2],
];

/** Water mask of the pond: an ellipse whose half-width wobbles per row. */
function pondMask(): Uint8Array {
  const mask = new Uint8Array(POND.w * POND.h);
  for (let y = 0; y < POND.h; y++) {
    const dy = (y + 0.5 - POND.cy) / POND.ry;
    if (Math.abs(dy) >= 1) continue;
    const half = POND.rx * Math.sqrt(1 - dy * dy) + (POND_WOBBLE[y] ?? 0);
    for (let x = 0; x < POND.w; x++) if (Math.abs(x + 0.5 - POND.cx) < half) mask[y * POND.w + x] = 1;
  }
  return mask;
}

/** Euclidean distance of every pixel outside `mask` to the nearest mask pixel (0 inside). */
function distanceOutside(mask: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const inside: number[] = [];
  mask.forEach((m, i) => {
    if (m) inside.push(i);
  });
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    let best = Number.POSITIVE_INFINITY;
    for (const j of inside) best = Math.min(best, Math.hypot((j % w) - x, Math.floor(j / w) - y));
    out[i] = best;
  }
  return out;
}

function pondRaster(kind: 'ufer' | 'wasser'): string {
  const mask = pondMask();
  const inside = distanceToEdge(mask, POND.w, POND.h);
  const outside = distanceOutside(mask, POND.w, POND.h);
  const rows: string[][] = [];
  for (let y = 0; y < POND.h; y++) {
    const row: string[] = [];
    for (let x = 0; x < POND.w; x++) {
      const i = y * POND.w + x;
      if (kind === 'wasser') {
        const d = inside[i] ?? 0;
        row.push(d === 0 ? '.' : d <= SHALLOW_WIDTH ? 'c' : d <= MID_WIDTH ? 'b' : 'a');
      } else {
        const d = mask[i] ? 0 : (outside[i] ?? 0);
        // The outer rim is broken where the wobble pulls the shore in, so it does not read as a frame.
        const rim = OUTER_RIM - ((POND_WOBBLE[y] ?? 0) < 0 ? 1 : 0);
        row.push(d === 0 ? '.' : d <= WET_MUD ? 'a' : d <= rim ? 'b' : '.');
      }
    }
    rows.push(row);
  }
  if (kind === 'wasser') {
    for (const [y, x0, len] of POND_GLINTS) {
      const r = rows[y];
      if (!r) continue;
      for (let x = x0; x < x0 + len; x++) if (r[x] !== undefined && r[x] !== '.') r[x] = len > 1 ? 'e' : 'd';
    }
  }
  return rows.map((r) => r.join('')).join('\n');
}

const teichUfer: SpriteSource = {
  id: 'teich_ufer',
  group: SCENE_GROUP,
  size: [POND.w, POND.h],
  anchor: [POND.cx, POND.h - 1],
  hoehe: 'flach',
  legende: { '.': null, a: 'erde.1', b: 'erde.2' },
  frames: [pondRaster('ufer')],
  material: { nass: 'a' },
};

const teich: SpriteSource = {
  id: 'teich',
  group: SCENE_GROUP,
  size: [POND.w, POND.h],
  anchor: [POND.cx, POND.h - 1],
  hoehe: 'flach',
  legende: { '.': null, a: 'wasser.1', b: 'wasser.2', c: 'wasser.3', d: 'wasser.4', e: 'wasser.5' },
  frames: [pondRaster('wasser')],
  material: { nass: 'abcde' },
};

// ---------------------------------------------------------------------------------------------
// Objects

/** Leaf clusters of the crown, back to front: centre x, centre y, radius (hand-placed). */
const CROWN_CLUSTERS: readonly (readonly [number, number, number])[] = [
  [10, 9, 6.5],
  [21, 8, 6.5],
  [15.5, 6, 6],
  [7, 16, 6.5],
  [25, 15.5, 6],
  [16, 14, 7.5],
  [11, 22, 6.5],
  [21, 22, 6.5],
  [16, 25, 5],
];
/** Shade thresholds of a cluster pixel (0 = rim/bottom … 1 = top centre). */
const CROWN_SHADES: readonly (readonly [number, string])[] = [
  [0.9, 'F'],
  [0.66, 'D'],
  [0.42, 'C'],
  [0.2, 'B'],
  [Number.NEGATIVE_INFINITY, 'A'],
];
/** How strongly the lower half of a cluster darkens (soft form shading, no directional highlight). */
const CROWN_UNDERSIDE = 0.75;
const CROWN_TOPSIDE = 0.25;
const CROWN_RIM = 0.55;

function crownCluster(x: number, y: number): number {
  for (let i = CROWN_CLUSTERS.length - 1; i >= 0; i--) {
    const c = CROWN_CLUSTERS[i];
    if (c && Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1]) < c[2]) return i;
  }
  return -1;
}

function crownPixel(x: number, y: number): string {
  const i = crownCluster(x, y);
  const c = CROWN_CLUSTERS[i];
  if (!c) return '.';
  // Selective outline: dark rim where the crown ends.
  const edge = crownCluster(x - 1, y) < 0 || crownCluster(x + 1, y) < 0 || crownCluster(x, y - 1) < 0 || crownCluster(x, y + 1) < 0;
  if (edge) return crownCluster(x, y + 1) < 0 || crownCluster(x + 1, y) < 0 ? 'E' : 'A';
  const dx = (x + 0.5 - c[0]) / c[2];
  const dy = (y + 0.5 - c[1]) / c[2];
  const v = 1 - Math.hypot(dx, dy) * CROWN_RIM - Math.max(0, dy) * CROWN_UNDERSIDE + Math.max(0, -dy) * CROWN_TOPSIDE;
  for (const [t, ch] of CROWN_SHADES) if (v >= t) return ch;
  return 'A';
}

const TREE_TRUNK = `................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   ................................
                   .............hiiiih.............
                   .............hiiiih.............
                   .............hiiiih.............
                   .............hiijih.............
                   .............hiijih.............
                   .............hiijih.............
                   .............hijjih.............
                   .............hijkjh.............
                   .............hijkjh.............
                   .............hijkjh.............
                   .............hijkjh.............
                   .............hiijkh.............
                   .............hiijkh.............
                   .............hijkjh.............
                   .............hijkjh.............
                   ............hhijkjh.............
                   ............hiijkjhh............
                   ...........hiijjkjiih...........
                   ..........hii.hijkhiiih.........
                   .........hih..hiijh..hih........
                   ..........h....hhhh...h.........
                   ................................
                   ................................
                   ................................`;

function treeRaster(): string {
  const trunk = rasterRows(TREE_TRUNK);
  return trunk
    .map((row, y) =>
      [...row]
        .map((ch, x) => {
          const leaf = y < 32 ? crownPixel(x, y) : '.';
          return leaf !== '.' ? leaf : ch;
        })
        .join(''),
    )
    .join('\n');
}

const laubbaum: SpriteSource = {
  id: 'laubbaum',
  group: SCENE_GROUP,
  size: [32, 48],
  anchor: [16, 45],
  hoehe: 'kugel',
  legende: { '.': null, E: 'gras.0', A: 'gras.1', B: 'gras.2', C: 'gras.3', D: 'gras.4', F: 'gras.5', h: 'holz.0', i: 'holz.1', j: 'holz.2', k: 'holz.3' },
  frames: [treeRaster()],
  material: { wind: 'EABCDF' },
  symmetric: true,
};

const fels: SpriteSource = {
  id: 'fels',
  group: SCENE_GROUP,
  size: [16, 16],
  anchor: [8, 15],
  hoehe: 'kugel',
  legende: { '.': null, o: 'stein.0', a: 'stein.1', b: 'stein.2', c: 'stein.3', d: 'stein.4', e: 'stein.5', m: 'gras.2', M: 'gras.3' },
  frames: [
    `................
     ................
     ................
     ................
     ................
     ......oooo......
     ....oommdcoo....
     ...omMMddccbo...
     ..odddddcccbbo..
     ..ocddcccccbbo..
     .obcceccccbbaao.
     .obbcccbbbbbaao.
     .oabbbbbbbbaaao.
     ..oaaabbbaaaao..
     ...ooaaaaaaoo...
     .....oooooo.....`,
  ],
  symmetric: true,
};

const grasbusch: SpriteSource = {
  id: 'grasbusch',
  group: SCENE_GROUP,
  size: [16, 16],
  anchor: [8, 15],
  hoehe: 'flach',
  legende: { '.': null, E: 'gras.0', A: 'gras.1', B: 'gras.2', C: 'gras.3', D: 'gras.4' },
  frames: [
    `................
     ................
     ................
     ................
     ................
     ........D.......
     ...D...DC...D...
     ...CD..CC..DC...
     ....C.DCB.DC....
     .D..CDCBBDCB..D.
     .CD.BCCBBCBB.DC.
     ..CDBCBBABBADC..
     ..BCBBBAABABCB..
     ...ABBAAAABAB...
     ....EAAEEAAAE...
     ................`,
  ],
  material: { wind: 'EABCD' },
  symmetric: true,
};

const FLAME_LEGEND = { '1': 'feuer.1*', '2': 'feuer.2*', '3': 'feuer.3*', '4': 'feuer.4*', '5': 'feuer.5*', e: 'feuer.0*' } as const;

const fackel: SpriteSource = {
  id: 'fackel',
  group: SCENE_GROUP,
  size: [16, 16],
  anchor: [8, 15],
  hoehe: 'zylinder',
  legende: { '.': null, ...FLAME_LEGEND, h: 'holz.0', i: 'holz.1', j: 'holz.2', o: 'stein.0', s: 'stein.2', S: 'stein.3' },
  frames: [
    `................
     .......2........
     ......232.......
     ......343.2.....
     .....23443......
     .....34543......
     ....2345432.....
     ....2345543.....
     .....o3553o.....
     .....oSeeSo.....
     ......osso......
     .......ij.......
     .......ij.......
     .......ij.......
     .......ij.......
     ......hhjh......`,
    `................
     ........2.......
     .......23.......
     ....2..343......
     .....23443......
     .....34543......
     ....2345432.....
     ....2345543.....
     .....o3553o.....
     .....oSeeSo.....
     ......osso......
     .......ij.......
     .......ij.......
     .......ij.......
     .......ij.......
     ......hhjh......`,
    `................
     ................
     ......2.........
     ......32..2.....
     .....23432......
     .....34543......
     ....2345432.....
     ....2345543.....
     .....o3553o.....
     .....oSeeSo.....
     ......osso......
     .......ij.......
     .......ij.......
     .......ij.......
     .......ij.......
     ......hhjh......`,
    `................
     .......2........
     .......32.......
     ......3432......
     .....234432.....
     .....34543......
     .....345432.....
     ....2345543.....
     .....o3553o.....
     .....oSeeSo.....
     ......osso......
     .......ij.......
     .......ij.......
     .......ij.......
     .......ij.......
     ......hhjh......`,
  ],
  clips: { brennen: { frames: [0, 1, 2, 3], fps: 12, loop: true } },
  material: { metall: 'osS' },
  symmetric: true,
};

const leuchtpilz: SpriteSource = {
  id: 'leuchtpilz',
  group: SCENE_GROUP,
  size: [16, 16],
  anchor: [8, 15],
  hoehe: 'kugel',
  legende: { '.': null, n: 'nacht.2', '3': 'wasser.3*', '4': 'wasser.4*', '5': 'wasser.5*', s: 'sand.4', S: 'sand.2' },
  frames: [
    `................
     ................
     ................
     ................
     ................
     ................
     ................
     ......nn........
     .....n45n.......
     ....n4554n..nn..
     ....n3443n.n45n.
     .....nssn..n34n.
     ......sS....sS..
     ......sS....sS..
     .....nsSn..nsSn.
     ................`,
  ],
  symmetric: true,
};

// ---------------------------------------------------------------------------------------------
// Figure: "wanderer" (32×32 cell, body 16×24 at cell (8, 7), feet on the anchor line y = 31)

const BODY_X = 8;
const BODY_Y = 7;
const CELL = 32;
/** Rows of the upper body part (head + torso); the leg poses fill the remaining body rows. */
const UPPER_ROWS = 18;

const FIGURE_LEGEND = {
  '.': null,
  n: 'nacht.1',
  a: 'holz.1',
  b: 'holz.2',
  c: 'holz.3',
  S: 'haut.1',
  s: 'haut.2',
  k: 'haut.3',
  K: 'haut.4',
  e: 'nacht.0',
  r: 'laub.0',
  t: 'laub.1',
  u: 'laub.2',
  v: 'laub.3',
  g: 'holz.0',
  y: 'sand.3',
  p: 'erde.1',
  q: 'erde.2',
  w: 'erde.0',
  x: 'holz.1',
} as const;

const UPPER = {
  down: `......nnnn......
         ....nnbbccnn....
         ...nbbbbcccbn...
         ..nabbbbbbcbbn..
         ..nabbbbbbbbbn..
         ..nabkkkkkkban..
         ..nakKkkkkKkan..
         ..nakekkkkekan..
         ...nkkkkkkkkn...
         ...nSkkssskSn...
         ....nnSkkSnn....
         ...nrtuvvutrn...
         ..nrtuuvvuutrn..
         .ntrtuuvvuutrtn.
         .nurtuuvvuutrun.
         .nkrggggyggggrkn.
         .nSrtuuuuuutrSn.
         ..nrttuuuuttrn..`,
  up: `......nnnn......
       ....nnbbbbnn....
       ...nbbccccbbn...
       ..nabbccccbban..
       ..nabbbccbbban..
       ..naabbbbbbaan..
       ..naabbbbbbaan..
       ..nsaabbbbaasn..
       ...naaabbaaan...
       ...nsaaaaaasn...
       ....nnSkkSnn....
       ...nrttuuttrn...
       ..nrttuuuuttrn..
       .ntrttuuuuttrtn.
       .nurttuuuuttrun.
       .nkrggggggggrkn.
       .nSrttuuuuttrSn.
       ..nrttuuuuttrn..`,
  right: `......nnnnn.....
          ....nnbbbccnn...
          ...nabbbbbcccn..
          ...nabbbbbbbccn.
          ..naabbbbbbbbbn.
          ..naabbbbkkkkkn.
          ..naabbbkkKkkkn.
          ..nnaabbkkkkekn.
          ...naabbkkkkkkkn
          ....nabSkkkkSnn.
          .....nnnSkkSn...
          .....nrtuvutn...
          ....nrttuvvutn..
          ....nrtuuvvutn..
          ....nrtuuvvutn..
          ....nggggyyggn..
          ....nrttuuuutn..
          .....nrttuutn...`,
} as const;

const LEGS = {
  front: {
    stand: `...nppqqqqppn...
            ...npqqnnqqpn...
            ...npqqnnqqpn...
            ...nwxxnnxxwn...
            ...nwxxnnxxwn...
            ....nnn..nnn....`,
    liftL: `...nppqqqqppn...
            ...npqqnnqqpn...
            ...nwxxnnqqpn...
            ...nwxxnnxxwn...
            ....nnn.nxxwn...
            .........nnn....`,
    liftR: `...nppqqqqppn...
            ...npqqnnqqpn...
            ...npqqnnxxwn...
            ...nwxxnnxxwn...
            ...nwxxn.nnn....
            ....nnn.........`,
  },
  side: {
    stand: `.....npqqqpn....
            .....npqqqpn....
            .....npqqqpn....
            .....nwxxxwn....
            .....nwxxxxwn...
            ......nnnnnn....`,
    strideA: `....npqqqqqpn...
              ...npqqn.npqqn..
              ..npqqn...npqn..
              ..nwxn....nwxxn.
              .nwxxn....nwxxwn
              ..nnn......nnnn.`,
    strideB: `....npqqqqqpn...
              ....npqqnnpqqn..
              ...npqqn.nqpn...
              ...nwxxn.nwxn...
              ..nwxxxn.nwxxn..
              ...nnnn...nnn...`,
  },
} as const;

/** Near arm of the side view (overlay on the upper body; rows 11–17 of the body box). */
const SIDE_ARM = {
  hang: `......nrtn......
         ......ntun......
         ......ntuun.....
         .......nnsKn....
         .........nn.....`,
  forward: `......nrtn......
            ......ntuun.....
            .......ntuun....
            ........nnsKn...
            ..........nn....`,
  back: `......nrtn......
         .....nutn.......
         ....nutn........
         ...nKsn.........
         ....nn..........`,
} as const;
/** First body row of the side arm overlay. */
const SIDE_ARM_ROW = 11;

interface FramePart {
  readonly upper: string;
  readonly legs: string;
  readonly arm?: string;
  /** Upper body shifted down (breathing, step contact). */
  readonly bob: number;
}

/** Composes a 32×32 cell: legs, then the (bobbed) upper body, then the near arm. */
function composeFigure(part: FramePart): string {
  const cell: string[][] = Array.from({ length: CELL }, () => Array.from({ length: CELL }, () => '.'));
  const paint = (rows: readonly string[], ox: number, oy: number): void => {
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const line = cell[oy + y];
      if (ch !== '.' && line && ox + x < CELL) line[ox + x] = ch;
    }));
  };
  paint(rasterRows(part.legs), BODY_X, BODY_Y + UPPER_ROWS);
  paint(rasterRows(part.upper), BODY_X, BODY_Y + part.bob);
  if (part.arm) paint(rasterRows(part.arm), BODY_X, BODY_Y + SIDE_ARM_ROW + part.bob);
  return cell.map((r) => r.join('')).join('\n');
}

/** Frame order per direction: idle (2) then walk (4). */
const FIGURE_FRAMES: Readonly<Record<'down' | 'up' | 'right', readonly FramePart[]>> = {
  down: [
    { upper: UPPER.down, legs: LEGS.front.stand, bob: 0 },
    { upper: UPPER.down, legs: LEGS.front.stand, bob: 1 },
    { upper: UPPER.down, legs: LEGS.front.liftL, bob: 1 },
    { upper: UPPER.down, legs: LEGS.front.stand, bob: 0 },
    { upper: UPPER.down, legs: LEGS.front.liftR, bob: 1 },
    { upper: UPPER.down, legs: LEGS.front.stand, bob: 0 },
  ],
  up: [
    { upper: UPPER.up, legs: LEGS.front.stand, bob: 0 },
    { upper: UPPER.up, legs: LEGS.front.stand, bob: 1 },
    { upper: UPPER.up, legs: LEGS.front.liftR, bob: 1 },
    { upper: UPPER.up, legs: LEGS.front.stand, bob: 0 },
    { upper: UPPER.up, legs: LEGS.front.liftL, bob: 1 },
    { upper: UPPER.up, legs: LEGS.front.stand, bob: 0 },
  ],
  right: [
    { upper: UPPER.right, legs: LEGS.side.stand, arm: SIDE_ARM.hang, bob: 0 },
    { upper: UPPER.right, legs: LEGS.side.stand, arm: SIDE_ARM.hang, bob: 1 },
    { upper: UPPER.right, legs: LEGS.side.strideA, arm: SIDE_ARM.back, bob: 1 },
    { upper: UPPER.right, legs: LEGS.side.stand, arm: SIDE_ARM.hang, bob: 0 },
    { upper: UPPER.right, legs: LEGS.side.strideB, arm: SIDE_ARM.forward, bob: 1 },
    { upper: UPPER.right, legs: LEGS.side.stand, arm: SIDE_ARM.hang, bob: 0 },
  ],
};

type Point = readonly [number, number];

/** Hand and head points in the body box, per arm pose (side) or for all frames (front/back). */
const HAND_FRONT: { readonly hand: Point; readonly nebenhand: Point } = { hand: [2, 16], nebenhand: [14, 16] };
const HAND_BACK: { readonly hand: Point; readonly nebenhand: Point } = { hand: [14, 16], nebenhand: [2, 16] };
const SIDE_HAND: Readonly<Record<keyof typeof SIDE_ARM, Point>> = { hang: [10, 15], forward: [11, 15], back: [5, 15] };
/** The far (off-)hand in profile sits just behind the body, opposite to the near arm's swing. */
const SIDE_FAR_HAND: Readonly<Record<keyof typeof SIDE_ARM, Point>> = { hang: [7, 15], forward: [5, 15], back: [9, 15] };
const HEAD_POINT: Point = [8, 5];

function toCell(p: Point, bob: number): [number, number] {
  return [BODY_X + p[0], BODY_Y + p[1] + bob];
}

function armPose(part: FramePart): keyof typeof SIDE_ARM {
  return part.arm === SIDE_ARM.forward ? 'forward' : part.arm === SIDE_ARM.back ? 'back' : 'hang';
}

const FIGURE_DIRS = ['down', 'up', 'right'] as const;
const FRAMES_PER_DIR = 6;
/** Idle breathes slowly: each of the two poses holds for three frames at 8 fps. */
const IDLE_FRAMES = [0, 0, 0, 1, 1, 1];
const IDLE_FPS = 8;
const WALK_FRAMES = [2, 3, 4, 5];
const WALK_FPS = 10;

function buildFigure(): SpriteSource {
  const frames: string[] = [];
  const hand: [number, number][] = [];
  const nebenhand: [number, number][] = [];
  const kopf: [number, number][] = [];
  for (const dir of FIGURE_DIRS) {
    for (const part of FIGURE_FRAMES[dir]) {
      frames.push(composeFigure(part));
      kopf.push(toCell(HEAD_POINT, part.bob));
      if (dir === 'right') {
        hand.push(toCell(SIDE_HAND[armPose(part)], part.bob));
        nebenhand.push(toCell(SIDE_FAR_HAND[armPose(part)], part.bob));
      } else {
        const h = dir === 'down' ? HAND_FRONT : HAND_BACK;
        hand.push(toCell(h.hand, part.bob));
        nebenhand.push(toCell(h.nebenhand, part.bob));
      }
    }
  }
  // Left: the right-facing frames mirrored; the near hand is now the left hand, so the sockets swap.
  const rightStart = FIGURE_DIRS.indexOf('right') * FRAMES_PER_DIR;
  const mirrorPoint = (p: [number, number] | undefined): [number, number] => [CELL - (p?.[0] ?? 0), p?.[1] ?? 0];
  for (let i = 0; i < FRAMES_PER_DIR; i++) {
    frames.push(mirrorRaster(frames[rightStart + i] ?? ''));
    kopf.push(mirrorPoint(kopf[rightStart + i]));
    hand.push(mirrorPoint(nebenhand[rightStart + i]));
    nebenhand.push(mirrorPoint(hand[rightStart + i]));
  }
  const dirs = [...FIGURE_DIRS, 'left'] as const;
  const clips: Record<string, { frames: number[]; fps: number; loop: boolean; events?: { frame: number; name: string }[] }> = {};
  dirs.forEach((dir, d) => {
    const base = d * FRAMES_PER_DIR;
    clips[`idle_${dir}`] = { frames: IDLE_FRAMES.map((f) => base + f), fps: IDLE_FPS, loop: true };
    clips[`walk_${dir}`] = {
      frames: WALK_FRAMES.map((f) => base + f),
      fps: WALK_FPS,
      loop: true,
      events: [
        { frame: 0, name: 'schritt' },
        { frame: 2, name: 'schritt' },
      ],
    };
  });
  return {
    id: 'wanderer',
    group: SCENE_GROUP,
    size: [CELL, CELL],
    anchor: [CELL / 2, CELL - 1],
    hoehe: 'zylinder',
    legende: FIGURE_LEGEND,
    frames,
    clips,
    sockets: { hand, nebenhand, kopf },
    symmetric: true,
  };
}

// Equipment ------------------------------------------------------------------------------------

const schwert: SpriteSource = {
  id: 'schwert',
  group: SCENE_GROUP,
  size: [24, 16],
  anchor: [12, 10],
  hoehe: 'zylinder',
  legende: { '.': null, n: 'nacht.1', c: 'stein.3', d: 'stein.4', e: 'stein.5', y: 'sand.3', Y: 'sand.1', i: 'holz.1', h: 'holz.0' },
  frames: [
    `...........nn...........
     ..........nedn..........
     ..........nedn..........
     ..........nedn..........
     ..........nedn..........
     ..........nedn..........
     ..........necn..........
     ..........nedn..........
     ........nYyyyyYn........
     ........nnnihnnn........
     ..........nihn..........
     ..........nihn..........
     ..........nyyn..........
     ...........nn...........
     ........................
     ........................`,
    `....................nen.
     ...................nedn.
     ..................nedn..
     .................nedn...
     ................nedn....
     ...........n...nedn.....
     ..........nYn.nedn......
     ...........nynedn.......
     ............nyyn........
     ...........nihyn........
     ..........nihnnYn.......
     .........nihn..n........
     ........nyYn............
     .........nn.............
     ........................
     ........................`,
  ],
  clips: { down: { frames: [0], fps: 1, loop: false }, up: { frames: [0], fps: 1, loop: false }, right: { frames: [1], fps: 1, loop: false } },
  material: { metall: 'cde' },
  symmetric: true,
};

const helm: SpriteSource = {
  id: 'helm',
  group: SCENE_GROUP,
  size: [16, 8],
  anchor: [8, 8],
  hoehe: 'kugel',
  legende: { '.': null, n: 'nacht.1', a: 'stein.1', b: 'stein.2', c: 'stein.3', d: 'stein.4', e: 'stein.5' },
  frames: [
    `.....nnnnnn.....
     ...nncddddcnn...
     ..ncddeedddcbn..
     ..ncdeddddccbn..
     .nbcddddddccbbn.
     .nbbccccccccbbn.
     nbaaaaaaaaaaaabn
     .nnnnnnnnnnnnnn.`,
    `.....nnnnnn.....
     ...nncccccdnn...
     ..ncccddddccbn..
     ..ncddddddccbn..
     .nbcddddddccbbn.
     .nbbccccccccbbn.
     nbaaaaaaaaaaaabn
     .nnnnnnnnnnnnnn.`,
    `.....nnnnnnn....
     ...nncddddccnn..
     ..ncddeeddddcbn.
     ..ncdeddddddcbn.
     .nbcddddddddcbbn
     .nbbcccccccccbbn
     .nbaaaaaaaaaaaan
     ..nnnnnnnnnnnnn.`,
  ],
  clips: { down: { frames: [0], fps: 1, loop: false }, up: { frames: [1], fps: 1, loop: false }, right: { frames: [2], fps: 1, loop: false } },
  material: { metall: 'abcde' },
  symmetric: true,
};

const handfackel: SpriteSource = {
  id: 'handfackel',
  group: SCENE_GROUP,
  size: [16, 16],
  anchor: [8, 11],
  hoehe: 'zylinder',
  legende: { '.': null, ...FLAME_LEGEND, h: 'holz.0', i: 'holz.1', j: 'holz.2', n: 'nacht.1', S: 'stein.3' },
  frames: [
    `................
     ................
     ................
     .......2........
     ......232.......
     ......3432......
     .....24543......
     .....34553......
     ......355.......
     ......nSSn......
     .......ij.......
     .......ij.......
     .......ij.......
     .......hh.......
     ................
     ................`,
    `................
     ................
     ........2.......
     .......23.......
     ......343.......
     .....23432......
     .....34543......
     .....34553......
     ......355.......
     ......nSSn......
     .......ij.......
     .......ij.......
     .......ij.......
     .......hh.......
     ................
     ................`,
    `................
     ................
     ................
     ......2.........
     ......32........
     .....2443.......
     .....34543......
     .....34553......
     ......355.......
     ......nSSn......
     .......ij.......
     .......ij.......
     .......ij.......
     .......hh.......
     ................
     ................`,
    `................
     ................
     .......2........
     .......32.......
     ......3432......
     ......34432.....
     .....34543......
     .....34553......
     ......355.......
     ......nSSn......
     .......ij.......
     .......ij.......
     .......ij.......
     .......hh.......
     ................
     ................`,
  ],
  clips: {
    down: { frames: [0, 1, 2, 3], fps: 12, loop: true },
    up: { frames: [0, 1, 2, 3], fps: 12, loop: true },
    right: { frames: [0, 1, 2, 3], fps: 12, loop: true },
  },
  material: { metall: 'nS' },
  symmetric: true,
};

// ---------------------------------------------------------------------------------------------

/** Palette rows of the scenes: master palette, seasons, corruption and two costume recolours. */
export function scenePaletteRows(): PaletteRow[] {
  return [
    identityRow('grund'),
    rampRemapRow('herbst', PALETTE_RAMPS, { gras: 'laub' }),
    rampRemapRow('winter', PALETTE_RAMPS, { gras: 'eis' }),
    rampRemapRow('verderbt', PALETTE_RAMPS, { gras: 'verderb', holz: 'nacht' }),
    rampRemapRow('tracht_blau', PALETTE_RAMPS, { laub: 'wasser', holz: 'sand' }),
    rampRemapRow('tracht_gruen', PALETTE_RAMPS, { laub: 'gras', holz: 'nacht' }),
  ];
}

export function sceneSpriteSources(): SpriteSource[] {
  return [grasBoden, erdfleck, teichUfer, teich, laubbaum, fels, grasbusch, fackel, leuchtpilz, buildFigure(), schwert, helm, handfackel];
}

let cached: AtlasData | null = null;

/** The scene atlas (built once per page; pure data, reusable across GL contexts). */
export function sceneAtlas(): AtlasData {
  cached ??= buildAtlas(sceneSpriteSources(), { ramps: PALETTE_RAMPS, paletteRows: scenePaletteRows() });
  return cached;
}
