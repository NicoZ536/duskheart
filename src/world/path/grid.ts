/**
 * The tile grid of a path search (M6-16, docs/SPIEL.md §12): one 16 bit word per tile, the region a request
 * snapshots (`PathGrid`) and the rules of the mover classes (`PathProfile`).
 *
 * **Tile words** hold what a search needs of a tile, derived from the collision grid (src/world/collision/tiles.ts)
 * and the chunk arrays (docs/WORLD.md §3):
 * - bits 0–5: the collision categories (`BLOCK_*`, same bits as the collision info); a closed door's own
 *   `BLOCK_SOLID` is replaced by `PATH_DOOR`, so a creature that opens doors can pass it;
 * - bits 6–8: the height level (0–4);
 * - `PATH_CONNECTOR`: the tile belongs to a ramp or stairs; `PATH_LINK`: a connector with a connector one level up
 *   or down among its eight neighbours (the only tiles where a walker changes level);
 * - `PATH_WATER`: open (unfrozen) water of any depth – swimmers need it;
 * - `PATH_LIGHT`: brighter than the request's `avoidLightAbove` (set per request, shadow brood §12.4).
 *
 * **Steps** (the same rules for every search and for the reference in the tests): a mover steps to one of the eight
 * neighbours when the target passes its profile (`blocked`/`required` bits); walkers (land, swimmers, amphibians)
 * keep their level except between two connectors one level apart (`levelsJoin`, like `blocksMover` of the collision);
 * a diagonal step needs both tiles beside it passable, not a closed door, and – for walkers – on joined levels with
 * both ends (no corner cutting: a body of radius ~ half a tile would scrape the corner). Fliers ignore levels.
 * Costs are fixed point: a straight step `STEP_STRAIGHT`, a diagonal one `STEP_DIAGONAL` (≈ √2), entering a closed
 * door adds `BALANCE.ai.path.doorCostTiles` tiles.
 */
import { BALANCE } from '../../content/balance';
import { CHUNK_SHIFT, CHUNK_SIZE, type Layer } from '../model/coords';
import { MOVER_CLASSES, type MoverClass, type PathResult, type PathStatus } from './types';

/*
 * The collision categories with the bits of src/world/collision/tiles.ts (`BLOCK_*`; tests/unit/world/pfad.test.ts
 * checks they agree). They are repeated here instead of imported: the path worker (path.worker.ts) loads this module,
 * and the collision module brings the whole content catalogue with it, which the worker never needs.
 */
const BLOCK_SOLID = 0b1;
const BLOCK_OBJECT = 0b10;
const BLOCK_HAZARD = 0b100;
const BLOCK_DEEP_WATER = 0b1000;
const BLOCK_WALL = 0b1_0000;
const BLOCK_VOID = 0b10_0000;
const BLOCK_ALL = BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD | BLOCK_DEEP_WATER | BLOCK_WALL | BLOCK_VOID;

/** Collision categories (bits 0–5, as in the collision info). */
export const PATH_BLOCK_BITS = BLOCK_ALL;
/** Bit position of the height level. */
export const PATH_LEVEL_SHIFT = 6;
/** Height level bits. */
export const PATH_LEVEL_BITS = 0b1_1100_0000;
/** Ramp or stairs. */
export const PATH_CONNECTOR = 0b10_0000_0000;
/** A closed door or gate (its own `BLOCK_SOLID` removed). */
export const PATH_DOOR = 0b100_0000_0000;
/** Open water of any depth. */
export const PATH_WATER = 0b1000_0000_0000;
/** A connector next to a connector one level up or down. */
export const PATH_LINK = 0b1_0000_0000_0000;
/** Too bright for the request (set per request). */
export const PATH_LIGHT = 0b10_0000_0000_0000;
if (PATH_LEVEL_BITS >> PATH_LEVEL_SHIFT < BALANCE.world.maxHeightLevel || (PATH_LEVEL_BITS & PATH_BLOCK_BITS) !== 0) throw new RangeError('Pfad: Höhenstufen passen nicht in die Kachelwörter');

/** Word of a tile outside the world, outside the allowed chunks or in a chunk that is not loaded. */
export const PATH_VOID_WORD = BLOCK_VOID;

/** Cost of a straight step [fixed point: 1000 per tile]. */
export const STEP_STRAIGHT = 1000;
/** Cost of a diagonal step: √2 × 1000, rounded down (keeps the octile heuristic admissible). */
export const STEP_DIAGONAL = 1414;
/** Octile heuristic: extra cost of a diagonal over a straight step. */
const DIAGONAL_EXTRA = STEP_DIAGONAL - STEP_STRAIGHT;
/** Unreachable distance (fits an Int32Array with room for one more step). */
export const PATH_INFINITY = 0x3fff_ffff;

/** Extra cost of entering a closed door [fixed point]. */
export const DOOR_COST = BALANCE.ai.path.doorCostTiles * STEP_STRAIGHT;

/** Height level of a word. */
export function wordLevel(w: number): number {
  return (w & PATH_LEVEL_BITS) >> PATH_LEVEL_SHIFT;
}

/** Whether a walker may step between two tiles' levels: the same level, or two connectors one level apart. */
export function levelsJoin(a: number, b: number): boolean {
  const la = a & PATH_LEVEL_BITS;
  const lb = b & PATH_LEVEL_BITS;
  if (la === lb) return true;
  if ((a & PATH_CONNECTOR) === 0 || (b & PATH_CONNECTOR) === 0) return false;
  const d = (la - lb) >> PATH_LEVEL_SHIFT;
  return d === 1 || d === -1;
}

/** Octile distance between two tiles [fixed point]: the admissible heuristic of every search. */
export function octile(dx: number, dy: number): number {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  return ax > ay ? STEP_STRAIGHT * ax + DIAGONAL_EXTRA * ay : STEP_STRAIGHT * ay + DIAGONAL_EXTRA * ax;
}

// ---------------------------------------------------------------------------------------------
// Mover profiles
// ---------------------------------------------------------------------------------------------

/** How a mover class and its door rule read the tile words. */
export interface PathProfile {
  /** Dense index 0–7 (mover class × doors) – abstract graph caches are kept per profile. */
  readonly index: number;
  readonly mover: MoverClass;
  readonly opensDoors: boolean;
  /** Word bits that block (categories, `PATH_DOOR` unless the mover opens doors; `PATH_LIGHT` is added per request). */
  readonly blocked: number;
  /** Word bits a tile must have (swimmers: `PATH_WATER`). */
  readonly required: number;
  /** Walkers keep their level except along ramps and stairs; fliers ignore levels. */
  readonly walk: boolean;
  /** Tiles a jump never passes: level links (walkers) and doors (door openers) – their steps differ. */
  readonly special: number;
}

/**
 * Categories that block each mover class (§19.4 "Sonderregeln für Schwimmer und Flieger"):
 * - `land`: everything the collision blocks for land creatures (`LAND_CREATURE_RULES`: rock, objects, lava, deep
 *   water, cliff faces, void);
 * - `schwimmer`: open water only (deep water is its element), no rock, objects, lava, cliff faces or void;
 * - `amphibie`: land and water;
 * - `flieger`: flies over objects, lava, water and cliff faces at any level; rock, walls and closed doors
 *   (`BLOCK_SOLID`) and the void stop it.
 */
const MOVER_BLOCKS: Readonly<Record<MoverClass, number>> = Object.freeze({
  land: BLOCK_ALL,
  schwimmer: BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD | BLOCK_WALL | BLOCK_VOID,
  amphibie: BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD | BLOCK_WALL | BLOCK_VOID,
  flieger: BLOCK_SOLID | BLOCK_VOID,
});
/** Word bits each class needs. */
const MOVER_REQUIRES: Readonly<Record<MoverClass, number>> = Object.freeze({ land: 0, schwimmer: PATH_WATER, amphibie: 0, flieger: 0 });

/** Categories that block a mover class (steering and the collision rules of creatures use the same table). */
export function moverBlockMask(mover: MoverClass): number {
  return MOVER_BLOCKS[mover];
}

const PROFILES: readonly PathProfile[] = MOVER_CLASSES.flatMap((mover, m) =>
  [false, true].map((opensDoors) => {
    const walk = mover !== 'flieger';
    return Object.freeze({
      index: m * 2 + (opensDoors ? 1 : 0),
      mover,
      opensDoors,
      blocked: MOVER_BLOCKS[mover] | (opensDoors ? 0 : PATH_DOOR),
      required: MOVER_REQUIRES[mover],
      walk,
      special: (walk ? PATH_LINK : 0) | (opensDoors ? PATH_DOOR : 0),
    });
  }),
);

/** Number of profiles (mover classes × door rule). */
export const PATH_PROFILE_COUNT = PROFILES.length;

/** Index of a mover class in `MOVER_CLASSES` (−1 for an unknown one). */
export function moverIndex(mover: MoverClass): number {
  return MOVER_CLASSES.indexOf(mover);
}

/** The profile of a mover class and door rule. */
export function pathProfile(mover: MoverClass, opensDoors: boolean): PathProfile {
  const m = moverIndex(mover);
  if (m < 0) throw new RangeError(`Pfad: unbekannte Fortbewegung „${String(mover)}“`);
  return PROFILES[m * 2 + (opensDoors ? 1 : 0)] as PathProfile;
}

/** The profile with dense index `index`. */
export function profileAt(index: number): PathProfile {
  const p = PROFILES[index];
  if (p === undefined) throw new RangeError(`Pfad: kein Profil ${index}`);
  return p;
}

// ---------------------------------------------------------------------------------------------
// The searched region
// ---------------------------------------------------------------------------------------------

/**
 * A snapshot of the tiles a request may use: a window of whole chunks on one layer, row-major tile words, a version
 * per chunk (the abstract graph caches key their data by it; 0 = a void chunk) and per chunk whether it or a
 * neighbour holds a special tile (jumps check the neighbours of a tile only there). The arrays grow and are reused.
 */
export class PathGrid {
  layer: Layer = 0;
  /** Window origin [chunks]. */
  cx0 = 0;
  cy0 = 0;
  /** Window size [chunks]. */
  cw = 0;
  ch = 0;
  /** Window size [tiles]. */
  width = 0;
  height = 0;
  /** Tile words, row-major, `width × height` used. */
  words: Uint16Array = new Uint16Array(0);
  /** Version of each window chunk (row-major, `cw × ch`); 0 = void. */
  versions: Int32Array = new Int32Array(0);
  /** Per window chunk: 1 if it or one of its eight neighbours holds a `PATH_LINK` or `PATH_DOOR` tile. */
  special: Uint8Array = new Uint8Array(0);

  /** Sets the window and makes room for its tiles (contents undefined until filled). */
  reset(layer: Layer, cx0: number, cy0: number, cw: number, ch: number): void {
    this.layer = layer;
    this.cx0 = cx0;
    this.cy0 = cy0;
    this.cw = cw;
    this.ch = ch;
    this.width = cw << CHUNK_SHIFT;
    this.height = ch << CHUNK_SHIFT;
    const tiles = this.width * this.height;
    if (this.words.length < tiles) this.words = new Uint16Array(grow(this.words.length, tiles));
    const chunks = cw * ch;
    if (this.versions.length < chunks) {
      this.versions = new Int32Array(grow(this.versions.length, chunks));
      this.special = new Uint8Array(this.versions.length);
    }
  }

  /** World tile x of the window's first column. */
  get tx0(): number {
    return this.cx0 << CHUNK_SHIFT;
  }

  /** World tile y of the window's first row. */
  get ty0(): number {
    return this.cy0 << CHUNK_SHIFT;
  }

  /**
   * Recomputes `PATH_LINK` from the connectors and levels inside the window (grids built by hand; the service's
   * snapshots get them from the per-chunk cache, which also looks across the window's edge).
   */
  markLinks(): void {
    const { width, height, words } = this;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const w = words[i] as number;
        if ((w & PATH_CONNECTOR) === 0) {
          words[i] = w & ~PATH_LINK;
          continue;
        }
        let link = false;
        for (let oy = -1; oy <= 1 && !link; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox;
            const ny = y + oy;
            if ((ox === 0 && oy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const n = words[ny * width + nx] as number;
            const d = (n & PATH_LEVEL_BITS) - (w & PATH_LEVEL_BITS);
            if ((n & PATH_CONNECTOR) !== 0 && (d === 1 << PATH_LEVEL_SHIFT || d === -1 << PATH_LEVEL_SHIFT)) {
              link = true;
              break;
            }
          }
        }
        words[i] = link ? w | PATH_LINK : w & ~PATH_LINK;
      }
    }
  }

  /** Recomputes `special` from the words (after they were filled). */
  markSpecials(): void {
    const { cw, ch, width, words, special } = this;
    special.fill(0, 0, cw * ch);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        let found = false;
        for (let y = 0; y < CHUNK_SIZE && !found; y++) {
          const row = ((cy << CHUNK_SHIFT) + y) * width + (cx << CHUNK_SHIFT);
          for (let x = 0; x < CHUNK_SIZE; x++) {
            if (((words[row + x] as number) & (PATH_LINK | PATH_DOOR)) !== 0) {
              found = true;
              break;
            }
          }
        }
        if (!found) continue;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx >= 0 && ny >= 0 && nx < cw && ny < ch) special[ny * cw + nx] = 1;
          }
        }
      }
    }
  }
}

/** Grown capacity: at least `needed`, doubling from `current`. */
export function grow(current: number, needed: number): number {
  let n = Math.max(current, CHUNK_SIZE);
  while (n < needed) n *= 2;
  return n;
}

/** Numeric codes of the path states (worker messages carry numbers). */
export const PATH_STATUS_CODES = ['found', 'partial', 'none'] as const satisfies readonly PathStatus[];

/** A reusable path result. */
export function createPathResult(capacity = CHUNK_SIZE): PathResult {
  return { status: 'none', tiles: new Int32Array(capacity * 2), steps: 0, expanded: 0 };
}

/** Makes room for `steps` steps in `out.tiles` (keeps nothing). */
export function reservePathTiles(out: PathResult, steps: number): void {
  if (out.tiles.length < steps * 2) out.tiles = new Int32Array(grow(out.tiles.length, steps * 2));
}

/** Makes room for `steps` steps in `out.tiles`, keeping the tiles written so far. */
export function reservePathTilesKeep(out: PathResult, steps: number): void {
  if (out.tiles.length >= steps * 2) return;
  const bigger = new Int32Array(grow(out.tiles.length, steps * 2));
  bigger.set(out.tiles);
  out.tiles = bigger;
}

/** Copies `from` into `to` (growing `to.tiles` when needed). */
export function copyPathResult(from: PathResult, to: PathResult): void {
  reservePathTiles(to, from.steps);
  to.status = from.status;
  to.steps = from.steps;
  to.expanded = from.expanded;
  for (let i = 0; i < from.steps * 2; i++) to.tiles[i] = from.tiles[i] as number;
}
