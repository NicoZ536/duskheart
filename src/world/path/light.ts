/**
 * Light for the path finding (M6-28, §12.4 "Meidet Licht > 0,5"; docs/SPIEL.md §11 "Schattenbrut-Licht"): the
 * shadow brood plans around tiles brighter than its `avoidLightAbove`. The service asks a sampler once per request
 * for the tiles of the searched window; the gameplay light map (src/world/lightmap, the light system's
 * `mapFor(sim)`) is the source.
 *
 * `lightListSampler` (M6-16b/c) is the one the game uses: a tile can only be brighter than the threshold where a light
 * reaches it, as long as the ambient light cannot exceed the threshold anywhere on the layer – at night and underground,
 * when shadow brood is about. It then asks the map only for the tiles within the reach of each light of the layer
 * (a torch: 13 × 13 tiles) instead of every tile of the window (up to 5 × 5 chunks = 25 600 tiles). By day it falls back
 * to the per-tile form. Both give the same marks (tests/unit/game/schattenbrut.test.ts compares them).
 *
 * Within the reach it asks the map only where the tile can be brighter at all (M6-16b): a light adds at most
 * `intensity × lightFalloff(distance from the flame)` – the map's own distance, its cone factor is at most 1 and a wall
 * only takes light away. Ambient bound plus these upper bounds of every light at or below the threshold means dark
 * without a query; a torch on its stake at night (threshold 0,5) leaves about 25 of its 169 tiles to ask, a camp fire
 * about 60 of 289. Every query evaluates the light map (occlusion, distance, cone).
 */
import { lightFalloff } from '../../engine/lightFalloff';
import type { MapLight } from '../lightmap/lightmap';
import { TILE_PX, type Layer } from '../model/coords';

/** Marks bright tiles for a path request. */
export interface PathLightSampler {
  /**
   * Sets `out[y × w + x]` to 1 for every tile (tx0 + x, ty0 + y) of the rectangle whose light level is above
   * `threshold` and to 0 for the rest.
   */
  markBright(layer: Layer, tx0: number, ty0: number, w: number, h: number, threshold: number, out: Uint8Array): void;
}

/** The part of the gameplay light map a sampler reads: the level at a tile's centre. */
export interface TileLightLevels {
  tileLevel(layer: Layer, tx: number, ty: number): number;
  /**
   * Whether the level of tile (tx, ty) is above `threshold`: `tileLevel(…) > threshold` without handing the level back
   * through the call (M6-16f – a level returned from a call that is not inlined is a new heap number; the samplers ask
   * thousands of tiles). Optional: the game's light map has it, levels without it are compared by the sampler.
   */
  brighter?(layer: Layer, tx: number, ty: number, threshold: number): boolean;
}

/**
 * A sampler over tile levels, one query per tile (`GameplayLightMap.tileLevel`, the value the light stage and the
 * spawn rules read). A shadow brood's window is a few chunks around it and its prey, so the per-tile form is enough.
 */
export function tileLevelSampler(levels: () => TileLightLevels): PathLightSampler {
  return new TileLevelSampler({ levels });
}

/** Where a sampler gets the tile levels of the current stamp. */
interface LevelSource {
  levels(): TileLightLevels;
}

/**
 * `tileLevelSampler` as a class over a level source (M6-16f): the game's source is an object with methods (the creatures'
 * light), so every world runs the same code and a tile query stays inlined in the loop – no closure made per world whose
 * call target would change with the next one.
 */
class TileLevelSampler implements PathLightSampler {
  constructor(private readonly source: LevelSource) {}

  markBright(layer: Layer, tx0: number, ty0: number, w: number, h: number, threshold: number, out: Uint8Array): void {
    const map = this.source.levels();
    if (map.brighter !== undefined) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) out[row + x] = map.brighter(layer, tx0 + x, ty0 + y, threshold) ? 1 : 0;
      }
      return;
    }
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) out[row + x] = map.tileLevel(layer, tx0 + x, ty0 + y) > threshold ? 1 : 0;
    }
  }
}

/** What `lightListSampler` reads: the light list and tile levels of the same stamp, and a bound of the ambient light. */
export interface LightListInputs {
  /** The lights of this stamp (the list the light map evaluates). */
  lights(): readonly MapLight[];
  /** Tile levels of the same stamp (ambient + lights). */
  levels(): TileLightLevels;
  /**
   * Largest ambient light any tile of `layer` can have now (§12.1: the weather only dims the day, so the calendar's
   * light without weather bounds it; caves: the cave ambient).
   */
  ambientBound(layer: Layer): number;
}

/**
 * Slack of the upper bound [light level]: the bound sums the squares of the distance in another order than the map
 * (`lightDistance`: dx² + dy² + dz²) – a rounding apart. A bound this close to the threshold asks the map.
 */
const BOUND_SLACK = 1e-9;

/** Tiles of the window a sampler handles: the reach of a light, clipped (scratch, written by `reachOf`). */
class Reach {
  x0 = 0;
  x1 = -1;
  y0 = 0;
  y1 = -1;
}

/**
 * The window tiles whose centre (t + ½) can lie within the radius of `l`: t from ⌊(x − r)⌋ to ⌊(x + r)⌋ in tile units,
 * clipped to the window (empty: `x1 < x0`).
 */
function reachOf(l: MapLight, tx0: number, ty0: number, w: number, h: number, out: Reach): void {
  const r = l.radius / TILE_PX;
  const cx = l.x / TILE_PX;
  const cy = l.y / TILE_PX;
  out.x0 = Math.max(tx0, Math.floor(cx - r));
  out.x1 = Math.min(tx0 + w - 1, Math.floor(cx + r));
  out.y0 = Math.max(ty0, Math.floor(cy - r));
  out.y1 = Math.min(ty0 + h - 1, Math.floor(cy + r));
}

/** Whether a light can add to the tiles of `layer` (the map skips the others too). */
function shines(l: MapLight, layer: Layer): boolean {
  return l.layer === layer && l.radius > 0 && l.intensity > 0;
}

/**
 * A sampler that visits only the tiles lights reach and asks the map only where their upper bound exceeds the threshold
 * (see module comment). Exact: a tile outside every light's radius holds its ambient light alone (the falloff is zero
 * at the radius, `lightFalloff`), which is at most the bound; a tile inside holds at most the ambient bound plus the
 * upper bounds of the lights. Allocates only when a window larger than every one before needs a larger scratch.
 */
export function lightListSampler(inputs: LightListInputs): PathLightSampler {
  return new LightListSampler(inputs);
}

/** `lightListSampler` as a class over its inputs (one code for every world, M6-16f; see `TileLevelSampler`). */
class LightListSampler implements PathLightSampler {
  private readonly perTile: PathLightSampler;
  private readonly reach = new Reach();
  /** Per window tile: ambient bound plus the upper bounds of the lights; −∞ once the map was asked. */
  private bound = new Float64Array(0);

  constructor(private readonly inputs: LightListInputs) {
    this.perTile = new TileLevelSampler(inputs);
  }

  markBright(layer: Layer, tx0: number, ty0: number, w: number, h: number, threshold: number, out: Uint8Array): void {
    const inputs = this.inputs;
    const ambient = inputs.ambientBound(layer);
    if (ambient > threshold) {
      this.perTile.markBright(layer, tx0, ty0, w, h, threshold, out);
      return;
    }
    const n = w * h;
    out.fill(0, 0, n);
    const lights = inputs.lights();
    if (lights.length === 0) return;
    if (this.bound.length < n) this.bound = new Float64Array(n);
    const bound = this.bound;
    const reach = this.reach;
    bound.fill(ambient, 0, n);
    for (let k = 0; k < lights.length; k++) {
      const l = lights[k] as MapLight;
      if (!shines(l, layer)) continue;
      reachOf(l, tx0, ty0, w, h, reach);
      for (let ty = reach.y0; ty <= reach.y1; ty++) {
        const row = (ty - ty0) * w - tx0;
        const dy = l.y - (ty + 0.5) * TILE_PX;
        const dyz = dy * dy + l.height * l.height;
        for (let tx = reach.x0; tx <= reach.x1; tx++) {
          const dx = l.x - (tx + 0.5) * TILE_PX;
          bound[row + tx] = (bound[row + tx] as number) + l.intensity * lightFalloff(Math.sqrt(dx * dx + dyz), l.radius);
        }
      }
    }
    const limit = threshold - BOUND_SLACK;
    const map = inputs.levels();
    for (let k = 0; k < lights.length; k++) {
      const l = lights[k] as MapLight;
      if (!shines(l, layer)) continue;
      reachOf(l, tx0, ty0, w, h, reach);
      for (let ty = reach.y0; ty <= reach.y1; ty++) {
        const row = (ty - ty0) * w - tx0;
        for (let tx = reach.x0; tx <= reach.x1; tx++) {
          const i = row + tx;
          if (!((bound[i] as number) > limit)) continue;
          bound[i] = Number.NEGATIVE_INFINITY;
          if (map.brighter !== undefined ? map.brighter(layer, tx, ty, threshold) : map.tileLevel(layer, tx, ty) > threshold) out[i] = 1;
        }
      }
    }
  }
}
