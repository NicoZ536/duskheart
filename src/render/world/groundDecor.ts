/**
 * Ground decor in groups across tile borders (M3-40, docs/ART.md §5 Salzküste; MASTERPROMPT §4.3 "kein
 * erkennbares Kachelraster"): on ground types with a rule, the presentation scatters small sprites – the
 * dune grass's tufts (`bodendeko_duenengras`) – in clusters that ignore the 16-px grid. The tileset of the
 * ground stays sparse; the tufts gather into clumps with bare sand between them. Since M7-61 the first biome gets the
 * same treatment: grass clumps, daisy and buttercup patches on the Grünhain meadow, shells and pebbles on the
 * Salzküste beach – each rule limited to its biomes (grounds are shared between biomes) and, for flowers, its seasons.
 *
 * - The world is cut into cells of `cellTiles` × `cellTiles` tiles. A cell holds a cluster with
 *   probability `clusterChance`; its centre lies anywhere in the cell (px), its radius and its number of
 *   tufts come from the cell's hash. Tufts sit around the centre (denser towards it), large ones near the
 *   centre, small ones at the rim – so a cluster reads as one clump growing out of the sand.
 * - Everything is a pure function of the cell coordinates and the rule: every chunk (and every view of
 *   it) finds the same tufts; a tuft belongs to the chunk its anchor lies in, so chunk borders neither
 *   double nor cut them. A tuft only stands on its own ground type, on dry land without a world object, in its
 *   rule's biomes (the tile's own biome) and seasons.
 */
import type { SeasonId } from '../../content/balance';
import { TILE_HASH, tileHashInto } from '../tilemap/tileSet';

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
  /**
   * Biomes the decor grows in (M7-61; omitted: wherever its ground lies). Grounds are shared – the Grünhain's meadow
   * flowers do not belong on the grass of the Nebelmoor or the Frostkamm tundra, the Salzküste's flotsam not on the
   * Glutsand's dunes (docs/ART.md §5: each biome its own identity).
   */
  readonly biomes?: readonly string[];
  /** Seasons the decor shows in (M7-61; omitted: all year) – meadow flowers bloom from spring to summer. */
  readonly seasons?: readonly SeasonId[];
  /**
   * Only on wild, level, dry ground (M7-61): not on a cliff edge, not beside a height step or water (its tile and the
   * neighbours inside the chunk on one level and dry – a tuft reaches 6 px to each side and would hang over the rim, onto the
   * wall or into the shore's foam) and not inside a place's area (the hand-built layouts of §21 keep their own ground).
   */
  readonly wildOnly?: boolean;
}

/** The decor rules by ground type. */
export const GROUND_DECOR_RULES: readonly GroundDecorRule[] = [
  // Dune grass (Salzküste): clumps of 7–15 tufts in most 3×3-tile cells, 28–60 px across – dense groups, sand between.
  { terrain: 'duenengras', sprite: 'bodendeko_duenengras', cellTiles: 3, clusterChance: 0.8, tufts: [7, 15], radiusPx: [14, 30], wind: 0.6, salt: 0x2f000000 },
  // Grünhain meadow (M7-61, docs/ART.md §5 "satte Grüns"): lush grass clumps – dark blades with light tips – in more than
  // half of the 4×4-tile cells, 8–15 overlapping tufts 28–52 px across: the even field breaks into darker, denser patches
  // with open meadow between.
  { terrain: 'gras', sprite: 'bodendeko_wiesengras', cellTiles: 4, clusterChance: 0.55, tufts: [8, 15], radiusPx: [14, 26], wind: 0.5, salt: 0x0a3c9e17, biomes: ['gruenhain'], wildOnly: true },
  // Daisies (accent `sand.4` "Rahmblüten") in loose patches of 4–9, in almost every other 6×6-tile cell, spring and summer.
  { terrain: 'gras', sprite: 'bodendeko_gaensebluemchen', cellTiles: 6, clusterChance: 0.45, tufts: [4, 9], radiusPx: [10, 24], wind: 0.3, salt: 0x11d7b4c6, biomes: ['gruenhain'], seasons: ['fruehling', 'sommer'], wildOnly: true },
  // Buttercups (accent `laub.4` "Blütengold"), rarer and smaller patches than the daisies, spring and summer.
  { terrain: 'gras', sprite: 'bodendeko_butterblumen', cellTiles: 7, clusterChance: 0.3, tufts: [3, 7], radiusPx: [8, 18], wind: 0.3, salt: 0x1621f0a5, biomes: ['gruenhain'], seasons: ['fruehling', 'sommer'], wildOnly: true },
  // Salzküste beach (M7-61): shells, pebbles and a starfish now and then in loose groups of 3–7 in every other 4×4-tile
  // cell – the beach tile's even ripple pattern breaks up; the Glutsand's sand stays bare.
  { terrain: 'sand', sprite: 'bodendeko_strandgut', cellTiles: 4, clusterChance: 0.55, tufts: [3, 7], radiusPx: [8, 22], wind: 0, salt: 0x1b9d3e71, biomes: ['salzkueste'], wildOnly: true },
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

/**
 * The hash of channel `channel` of cell (gx, gy) into the register `TILE_HASH[0]` – read right after the call: a fraction
 * returned by a call becomes a new number object in V8's baseline code and in builders too large to inline it (M7-115).
 */
function hashInto(rule: GroundDecorRule, gx: number, gy: number, channel: number): void {
  tileHashInto(gx, gy, rule.salt + channel * CHANNEL);
}

/**
 * The tufts of cell (gx, gy) of `rule`, written into `out` from index 0 (entries are reused, the array
 * grows only when a cluster is larger than before). Returns how many.
 */
export function tuftsOfCell(rule: GroundDecorRule, gx: number, gy: number, out: DecorTuft[]): number {
  hashInto(rule, gx, gy, 0);
  if ((TILE_HASH[0] as number) >= rule.clusterChance) return 0;
  const cell = rule.cellTiles * TILE;
  hashInto(rule, gx, gy, 1);
  const cxp = gx * cell + (TILE_HASH[0] as number) * cell;
  hashInto(rule, gx, gy, 2);
  const cyp = gy * cell + (TILE_HASH[0] as number) * cell;
  hashInto(rule, gx, gy, 3);
  const radius = rule.radiusPx[0] + (rule.radiusPx[1] - rule.radiusPx[0]) * (TILE_HASH[0] as number);
  const lo = rule.tufts[0];
  const hi = rule.tufts[1];
  hashInto(rule, gx, gy, 4);
  const n = lo + Math.min(hi - lo, Math.floor((TILE_HASH[0] as number) * (hi - lo + 1)));
  // The tufts spread around the centre on a rotated golden-angle spiral with jitter: no two on one spot.
  hashInto(rule, gx, gy, 5);
  const turn = (TILE_HASH[0] as number) * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    hashInto(rule, gx, gy, 6 + k);
    const u = (k + (TILE_HASH[0] as number)) / n;
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

/** Every tuft size counts one (`tuftsNear`). */
const EACH_ONCE: readonly number[] = DECOR_SIZES.map(() => 1);

/**
 * How many tufts of `rule` stand within `radius` px of (x, y) – each counted with its size's entry of `weights`
 * (`DECOR_SIZES` order; default one each): tufts whose tile passes `stands` (the object layer's own test: the rule's
 * ground, dry, without a world object). Allocates; for the debug scenarios (M5-69: where the dune grass is dense enough
 * for the figure to bend it), not for the frame.
 */
export function tuftsNear(rule: GroundDecorRule, x: number, y: number, radius: number, stands: (tx: number, ty: number) => boolean, weights: readonly number[] = EACH_ONCE): number {
  const cells = { gx0: 0, gy0: 0, gx1: 0, gy1: 0 };
  cellsCovering(rule, x - radius, y - radius, x + radius, y + radius, cells);
  const tufts: DecorTuft[] = [];
  let count = 0;
  for (let gy = cells.gy0; gy <= cells.gy1; gy++) {
    for (let gx = cells.gx0; gx <= cells.gx1; gx++) {
      const n = tuftsOfCell(rule, gx, gy, tufts);
      for (let k = 0; k < n; k++) {
        const t = tufts[k] as DecorTuft;
        if ((t.x - x) ** 2 + (t.y - y) ** 2 <= radius * radius && stands(Math.floor(t.x / TILE), Math.floor(t.y / TILE))) count += weights[t.size] ?? 1;
      }
    }
  }
  return count;
}

/** Cells whose clusters can reach into the px rectangle [x0, x1) × [y0, y1) (cell coordinates, inclusive). */
export function cellsCovering(rule: GroundDecorRule, x0: number, y0: number, x1: number, y1: number, out: { gx0: number; gy0: number; gx1: number; gy1: number }): void {
  const cell = rule.cellTiles * TILE;
  const reach = rule.radiusPx[1];
  out.gx0 = Math.floor((x0 - reach) / cell);
  out.gy0 = Math.floor((y0 - reach) / cell);
  out.gx1 = Math.floor((x1 + reach) / cell);
  out.gy1 = Math.floor((y1 + reach) / cell);
}
