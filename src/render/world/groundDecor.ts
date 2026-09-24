/**
 * Ground decor in groups across tile borders (M3-40, docs/ART.md §5 Salzküste; MASTERPROMPT §4.3 "kein
 * erkennbares Kachelraster"): on ground types with a rule, the presentation scatters small sprites – the
 * dune grass's tufts (`bodendeko_duenengras`) – in clusters that ignore the 16-px grid. The tileset of the
 * ground stays sparse; the tufts gather into clumps with bare sand between them.
 *
 * - The world is cut into cells of `cellTiles` × `cellTiles` tiles. A cell holds a cluster with
 *   probability `clusterChance`; its centre lies anywhere in the cell (px), its radius and its number of
 *   tufts come from the cell's hash. Tufts sit around the centre (denser towards it), large ones near the
 *   centre, small ones at the rim – so a cluster reads as one clump growing out of the sand.
 * - Everything is a pure function of the cell coordinates and the rule: every chunk (and every view of
 *   it) finds the same tufts; a tuft belongs to the chunk its anchor lies in, so chunk borders neither
 *   double nor cut them. A tuft only stands on its own ground type, on dry land without a world object.
 */
import { tileHash01 } from '../tilemap/tileSet';

/** Tile edge [px] (the world grid). */
const TILE = 16;

/** How one ground type gets its decor. */
export interface GroundDecorRule {
  /** Ground type (terrain id) the decor grows on. */
  readonly terrain: string;
  /** Sprite with the clips `klein`, `mittel`, `gross`. */
  readonly sprite: string;
  /** Edge of a cluster cell [tiles]. */
  readonly cellTiles: number;
  /** Share of cells that hold a cluster. */
  readonly clusterChance: number;
  /** Tufts per cluster [min, max]. */
  readonly tufts: readonly [number, number];
  /** Cluster radius [px, min … max]. */
  readonly radiusPx: readonly [number, number];
  /** Wind sway at the top of a tuft [px]. */
  readonly wind: number;
  /** Hash salt of the rule (independent of every other per-tile choice). */
  readonly salt: number;
}

/** The decor rules by ground type. */
export const GROUND_DECOR_RULES: readonly GroundDecorRule[] = [
  // Dune grass (Salzküste): clumps of 7–15 tufts in most 3×3-tile cells, 28–60 px across – dense groups, sand between.
  { terrain: 'duenengras', sprite: 'bodendeko_duenengras', cellTiles: 3, clusterChance: 0.8, tufts: [7, 15], radiusPx: [14, 30], wind: 0.6, salt: 0x2f000000 },
];

/** Sizes of a tuft (clip names of the decor sprite, smallest first). */
export const DECOR_SIZES = ['klein', 'mittel', 'gross'] as const;

/** A tuft: anchor [world px] and size (index into `DECOR_SIZES`). */
export interface DecorTuft {
  x: number;
  y: number;
  size: number;
}

/** Salt channels (far apart: the tile hash mixes the salt into the y coordinate). */
const CHANNEL = 0x01000000;
/** Share of the radius inside which a tuft is large, and medium. */
const LARGE_WITHIN = 0.4;
const MEDIUM_WITHIN = 0.75;

function h(rule: GroundDecorRule, gx: number, gy: number, channel: number): number {
  return tileHash01(gx, gy, rule.salt + channel * CHANNEL);
}

/**
 * The tufts of cell (gx, gy) of `rule`, written into `out` from index 0 (entries are reused, the array
 * grows only when a cluster is larger than before). Returns how many.
 */
export function tuftsOfCell(rule: GroundDecorRule, gx: number, gy: number, out: DecorTuft[]): number {
  if (h(rule, gx, gy, 0) >= rule.clusterChance) return 0;
  const cell = rule.cellTiles * TILE;
  const cxp = gx * cell + h(rule, gx, gy, 1) * cell;
  const cyp = gy * cell + h(rule, gx, gy, 2) * cell;
  const radius = rule.radiusPx[0] + (rule.radiusPx[1] - rule.radiusPx[0]) * h(rule, gx, gy, 3);
  const [lo, hi] = rule.tufts;
  const n = lo + Math.min(hi - lo, Math.floor(h(rule, gx, gy, 4) * (hi - lo + 1)));
  // The tufts spread around the centre on a rotated golden-angle spiral with jitter: no two on one spot.
  const turn = h(rule, gx, gy, 5) * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const u = (k + h(rule, gx, gy, 6 + k)) / n;
    const r = radius * Math.sqrt(u);
    const a = turn + k * GOLDEN_ANGLE;
    let t = out[k];
    if (t === undefined) {
      t = { x: 0, y: 0, size: 0 };
      out[k] = t;
    }
    t.x = Math.round(cxp + Math.cos(a) * r);
    // Flattened vertically: seen from above at an angle, a clump is wider than deep.
    t.y = Math.round(cyp + Math.sin(a) * r * FLATTEN);
    const share = r / radius;
    t.size = share < LARGE_WITHIN ? 2 : share < MEDIUM_WITHIN ? 1 : 0;
  }
  return n;
}

/** Angle between successive tufts of a cluster (the golden angle). */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Vertical squash of a cluster. */
const FLATTEN = 0.7;

/** Cells whose clusters can reach into the px rectangle [x0, x1) × [y0, y1) (cell coordinates, inclusive). */
export function cellsCovering(rule: GroundDecorRule, x0: number, y0: number, x1: number, y1: number, out: { gx0: number; gy0: number; gx1: number; gy1: number }): void {
  const cell = rule.cellTiles * TILE;
  const reach = rule.radiusPx[1];
  out.gx0 = Math.floor((x0 - reach) / cell);
  out.gy0 = Math.floor((y0 - reach) / cell);
  out.gx1 = Math.floor((x1 + reach) / cell);
  out.gy1 = Math.floor((y1 + reach) / cell);
}
