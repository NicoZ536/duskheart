/**
 * What the map draws in a revealed cell (docs/SPIEL.md §18 "Karte"; M7-49): the generated world, not the chunks the player
 * happened to load – a revealed cell shows the same after loading as before, the tower's 80 tiles included. Per map cell a
 * terrain kind and a height level, read from the world's own samplers (`surfaceContextOf`, `carveRect`) – pure functions of
 * seed and size – and computed lazily: only revealed cells, at most a budget per call (the map screen spreads a large
 * reveal over frames). Changes the player made (dug tiles, felled trees, bases) are not drawn: at four tiles per cell the map
 * shows land, water, heights and roads; bases are markers.
 *
 * Surface: four samples per cell (tiles 1 and 3 of each axis) – two or more wet ones make it water (narrow rivers stay
 * visible), the kind of water from the deepest; else the biome of the cell's centre, the level of its centre, a road where
 * one of the world's roads crosses the cell, lava where the volcanic pools lie. Underground: the carved caves of the cell's
 * chunk (`carveRect`, once per chunk), open where at least a quarter of the cell's tiles is open.
 */
import type { GeneratedWorld } from '../../world/gen/world';
import { PLAN_BIOME_IDS } from '../../world/gen/plan/biomes';
import { createTerrainSample } from '../../world/gen/plan/sampler';
import { carveRect } from '../../world/gen/underground/carve';
import { surfaceContextOf, type SurfaceContext } from '../../world/gen/worldContext';
import { WATER_DEPTH_DEEP, WATER_DEPTH_MASK, WATER_SEA } from '../../world/model/chunk';
import { CHUNK_SIZE, LAYER_COUNT, type Layer } from '../../world/model/coords';
import type { UndergroundLayer } from '../../world/gen/underground/params';

/** Terrain kinds of a map cell. `LAND + biome index` (`PLAN_BIOME_IDS`) is land of that biome. */
export const MAP_TERRAIN = {
  /** Not computed yet (or not revealed). */
  unknown: 0,
  sea: 1,
  shallowSea: 2,
  deepWater: 3,
  shallowWater: 4,
  lava: 5,
  road: 6,
  rock: 7,
  cave: 8,
  land: 16,
} as const;

/** Most kinds (`land` + every plan biome). */
export const MAP_TERRAIN_KINDS = MAP_TERRAIN.land + PLAN_BIOME_IDS.length;

/** Sample offsets inside a cell (tiles 1 and 3 of 4 on each axis, scaled for other cell sizes). */
const SAMPLE_A = 0.25;
const SAMPLE_B = 0.75;
/** Samples per cell (the four of `SAMPLE_A`/`SAMPLE_B`), and the bits of a mask byte. */
const SAMPLES = 4;
const BYTE_BITS = 8;
/** Wet samples (of four) that make a cell water. */
const WET_SAMPLES = 2;
/** Open tiles of a cell (of 16) that make an underground cell a cave. */
const OPEN_SHARE = 0.25;

/** The terrain of one layer: kind and level per cell, and which cells are done. */
interface LayerTerrain {
  readonly kind: Uint8Array;
  readonly level: Uint8Array;
  readonly done: Uint8Array;
}

export class MapTerrain {
  /** Rises whenever cells were computed. */
  version = 0;
  private readonly layers: (LayerTerrain | null)[] = new Array<LayerTerrain | null>(LAYER_COUNT).fill(null);
  private ctx: SurfaceContext | null = null;
  private roads: Uint8Array | null = null;
  private readonly sample = createTerrainSample();
  /** Chunks of each underground layer whose caves are carved into the cells (1 = done). */
  private readonly carvedChunks: (Uint8Array | null)[] = new Array<Uint8Array | null>(LAYER_COUNT).fill(null);

  constructor(
    readonly world: GeneratedWorld,
    readonly side: number,
    readonly cellTiles: number,
  ) {}

  /** Kinds of `layer` (`MAP_TERRAIN`), row-major `side × side`. */
  kind(layer: Layer): Uint8Array {
    return this.layerOf(layer).kind;
  }

  /** Height levels of `layer` (surface 0–4; caves 0). */
  level(layer: Layer): Uint8Array {
    return this.layerOf(layer).level;
  }

  /**
   * Computes the cells of `layer` set in `mask` (bit `cy · side + cx`) that are not done, at most `budget` of them; returns
   * how many revealed cells are still open afterwards (0 = the layer's revealed cells are all drawn).
   */
  fill(layer: Layer, mask: Uint8Array, budget: number): number {
    const t = this.layerOf(layer);
    const cells = this.side * this.side;
    let left = budget;
    let open = 0;
    for (let byte = 0; byte < mask.length; byte++) {
      const bits = mask[byte] as number;
      if (bits === 0) continue;
      for (let b = 0; b < BYTE_BITS; b++) {
        if ((bits & (1 << b)) === 0) continue;
        const i = byte * BYTE_BITS + b;
        if (i >= cells || t.done[i] !== 0) continue;
        if (left <= 0) {
          open++;
          continue;
        }
        const n = layer === 0 ? this.surfaceCell(t, i) : this.caveCells(t, layer as UndergroundLayer, i);
        left -= n;
        this.version++;
      }
    }
    return open;
  }

  private layerOf(layer: Layer): LayerTerrain {
    const k = -layer;
    let t = this.layers[k];
    if (t === null || t === undefined) {
      const n = this.side * this.side;
      t = { kind: new Uint8Array(n), level: new Uint8Array(n), done: new Uint8Array(n) };
      this.layers[k] = t;
    }
    return t;
  }

  /** One surface cell; returns the cells computed (1). */
  private surfaceCell(t: LayerTerrain, i: number): number {
    const ctx = (this.ctx ??= surfaceContextOf(this.world.plan));
    const roads = (this.roads ??= this.rasterRoads());
    const ct = this.cellTiles;
    const cx = i % this.side;
    const cy = (i - cx) / this.side;
    const s = this.sample;
    let wet = 0;
    let deep = false;
    let sea = false;
    let lava = false;
    for (let k = 0; k < SAMPLES; k++) {
      const tx = Math.floor((cx + ((k & 1) === 0 ? SAMPLE_A : SAMPLE_B)) * ct);
      const ty = Math.floor((cy + ((k & 2) === 0 ? SAMPLE_A : SAMPLE_B)) * ct);
      ctx.terrain.sample(tx, ty, s);
      const depth = s.water & WATER_DEPTH_MASK;
      if (!s.land || depth !== 0) {
        wet++;
        if (!s.land || (s.water & WATER_SEA) !== 0) sea = true;
        if (!s.land || depth === WATER_DEPTH_DEEP) deep = true;
      } else if (ctx.lavaAt(tx, ty)) lava = true;
    }
    const mx = Math.floor((cx + 0.5) * ct);
    const my = Math.floor((cy + 0.5) * ct);
    ctx.terrain.sample(mx, my, s);
    t.level[i] = s.level;
    if (wet >= WET_SAMPLES) t.kind[i] = sea ? (deep ? MAP_TERRAIN.sea : MAP_TERRAIN.shallowSea) : deep ? MAP_TERRAIN.deepWater : MAP_TERRAIN.shallowWater;
    else if (roads[i] !== 0) t.kind[i] = MAP_TERRAIN.road;
    else if (lava) t.kind[i] = MAP_TERRAIN.lava;
    else t.kind[i] = MAP_TERRAIN.land + ctx.biomeAt(mx, my);
    t.done[i] = 1;
    return 1;
  }

  /** The cells of the chunk around cell `i` of an underground layer (carved once per chunk); returns the cells computed. */
  private caveCells(t: LayerTerrain, layer: UndergroundLayer, i: number): number {
    const k = -layer;
    const chunks = Math.ceil((this.side * this.cellTiles) / CHUNK_SIZE);
    let carved = this.carvedChunks[k];
    if (carved === null || carved === undefined) {
      carved = new Uint8Array(chunks * chunks);
      this.carvedChunks[k] = carved;
    }
    const per = CHUNK_SIZE / this.cellTiles;
    const cx = i % this.side;
    const cy = (i - cx) / this.side;
    const kx = Math.floor(cx / per);
    const ky = Math.floor(cy / per);
    if (carved[ky * chunks + kx] !== 0) {
      t.done[i] = 1;
      return 0;
    }
    carved[ky * chunks + kx] = 1;
    const rect = carveRect(this.world.underground, layer, kx * CHUNK_SIZE, ky * CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
    const ct = this.cellTiles;
    const need = OPEN_SHARE * ct * ct;
    let n = 0;
    for (let v = 0; v < per; v++) {
      for (let u = 0; u < per; u++) {
        const gx = kx * per + u;
        const gy = ky * per + v;
        if (gx >= this.side || gy >= this.side) continue;
        let open = 0;
        for (let y = 0; y < ct; y++) for (let x = 0; x < ct; x++) open += rect.open[(v * ct + y) * CHUNK_SIZE + u * ct + x] as number;
        const j = gy * this.side + gx;
        t.kind[j] = open >= need ? MAP_TERRAIN.cave : MAP_TERRAIN.rock;
        t.level[j] = 0;
        t.done[j] = 1;
        n++;
      }
    }
    return n;
  }

  /** 1 on every cell a road of the world crosses (its polyline walked in steps of half a tile). */
  private rasterRoads(): Uint8Array {
    const out = new Uint8Array(this.side * this.side);
    const ct = this.cellTiles;
    const mark = (x: number, y: number): void => {
      const cx = Math.floor(x / ct);
      const cy = Math.floor(y / ct);
      if (cx >= 0 && cy >= 0 && cx < this.side && cy < this.side) out[cy * this.side + cx] = 1;
    };
    for (const road of this.world.roads.roads) {
      for (let p = 0; p + 1 < road.xs.length; p++) {
        const ax = road.xs[p] as number;
        const ay = road.ys[p] as number;
        const bx = road.xs[p + 1] as number;
        const by = road.ys[p + 1] as number;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
        for (let s = 0; s <= steps; s++) mark(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
      }
    }
    return out;
  }
}
