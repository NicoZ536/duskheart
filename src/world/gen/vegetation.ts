/**
 * World generation step 7, part 2 (M2-10, MASTERPROMPT §9.2.7, §9.3, §14): vegetation and ground
 * scatter per chunk – forest trees, rocks, common plants and decoration of each surface biome.
 *
 * - Species come from the content (src/content/worldObjects.ts): trees (except the fruit trees,
 *   which are deposits), the rocks `fels_*_<biome>`, the ambient plants (`RESOURCES.ambientPlants`)
 *   and every `deko_*` of the biome. `VEGETATION` sets the densities per biome, `SPECIES` weights,
 *   grounds and water rules per object.
 * - Blue-noise scatter: a tile is a candidate of a layer where the world's blue-noise tile lies below
 *   the layer's density; forests breathe with a low-frequency noise. Every block of one blue-noise
 *   tile edge (64 tiles) reads the tile at its own seeded offset per layer, so the pattern does not
 *   repeat every two chunks (a fixed offset would put the same rocks at the same spots of every
 *   block); at block borders two objects may come closer than blue noise would allow, which the
 *   conflict rules below resolve.
 * - Transition strips mix vegetation: the tile's dithered biome (what the chunk's `biome` field
 *   shows) decides, so a Grünhain–Frostkamm strip grows beeches and firs side by side (taiga).
 * - Blocking objects (trees, rocks, cacti) keep a ring of open ground and never touch another
 *   blocking object (`chunkWindow.ts`): they never cut a path. Conflicts between candidates are
 *   resolved by a seeded priority – a candidate is placed when no conflicting candidate has a higher
 *   one. Every decision reads only tiles within a fixed margin, so neighbouring chunks agree on the
 *   objects at their border in any generation order.
 */
import { WORLD_OBJECTS, worldObjectSchema, type WorldObject } from '../../content/worldObjects';
import type { Noise2 } from '../../engine/noise';
import { hash2, hash3, hashToUnit } from '../../engine/rng';
import type { ChunkData } from '../model/chunk';
import { CHUNK_SIZE } from '../model/coords';
import type { RuntimeIdTable } from '../model/runtimeIds';
import { blockingFits, OCC_BLOCK, OCC_LOOSE, OCC_NONE, type TileWindow } from './chunkWindow';
import type { GroundRules } from './chunkGround';
import { PLAN_BIOME_IDS } from './plan/index';
import { depositKind } from './resources';
import { genNoise, genSeed, type SurfaceContext } from './worldContext';
import { blueNoiseAt } from './sampling';

/** Densities of one surface biome [candidates per tile]. */
export interface BiomeVegetation {
  /** Trees at forest factor 1. */
  readonly trees: number;
  /** Forest swing: the tree density varies by ± this share with the forest noise [fraction]. */
  readonly forestSwing: number;
  /** Highest level with trees (tree line). */
  readonly treeLine: number;
  /** Blocking rocks. */
  readonly rocks: number;
  /** Share of large rocks among the rocks [fraction]. */
  readonly largeRocks: number;
  /** Blocking plants (cacti). */
  readonly blockingPlants: number;
  /** Non-blocking plants (fibre grass, marram, reeds). */
  readonly plants: number;
  /** Ground scatter. */
  readonly deko: number;
}

/**
 * Densities per surface biome (§9.3 features): Grünhain mixed forest and meadows; Salzküste sparse
 * pines behind the dunes; Nebelmoor willows and mangroves at the water; Frostkamm conifer forest up to
 * the tree line; Glutsand date palms, cacti and rocks; Aschenschlund lone ash trees on rocky ash;
 * Scherbenhain crystal forest; Nachtherz barren crater with rocks and scatter.
 */
export const VEGETATION: Readonly<Record<string, BiomeVegetation>> = {
  gruenhain: { trees: 0.075, forestSwing: 0.9, treeLine: 4, rocks: 0.005, largeRocks: 0.3, blockingPlants: 0, plants: 0.035, deko: 0.07 },
  salzkueste: { trees: 0.018, forestSwing: 0.9, treeLine: 2, rocks: 0.006, largeRocks: 0.35, blockingPlants: 0, plants: 0.05, deko: 0.035 },
  nebelmoor: { trees: 0.04, forestSwing: 0.8, treeLine: 2, rocks: 0.003, largeRocks: 0.25, blockingPlants: 0, plants: 0.06, deko: 0.06 },
  frostkamm: { trees: 0.06, forestSwing: 0.8, treeLine: 3, rocks: 0.01, largeRocks: 0.4, blockingPlants: 0, plants: 0.015, deko: 0.035 },
  glutsand: { trees: 0.006, forestSwing: 1, treeLine: 4, rocks: 0.008, largeRocks: 0.4, blockingPlants: 0.01, plants: 0, deko: 0.03 },
  aschenschlund: { trees: 0.012, forestSwing: 1, treeLine: 4, rocks: 0.012, largeRocks: 0.45, blockingPlants: 0, plants: 0, deko: 0.05 },
  scherbenhain: { trees: 0.04, forestSwing: 0.8, treeLine: 4, rocks: 0.006, largeRocks: 0.35, blockingPlants: 0, plants: 0, deko: 0.06 },
  nachtherz: { trees: 0, forestSwing: 0, treeLine: 0, rocks: 0.01, largeRocks: 0.4, blockingPlants: 0, plants: 0, deko: 0.05 },
};

/** Per-object rules of the ambient scatter. */
interface SpeciesRule {
  /** Relative weight among the species of its layer and biome [weight]. */
  readonly weight?: number;
  /** Grounds the object grows on (default: any walkable ground). */
  readonly grounds?: readonly string[];
  /** Whether water must lie within `SCATTER.nearWaterTiles`. */
  readonly nearWater?: boolean;
}

/** Grounds of forest trees: not on sand, ice or bog mud. */
const FOREST_GROUND = ['gras', 'erde', 'schnee', 'torf', 'asche', 'kristallboden'] as const;

/** Species rules (weights, grounds, water) of the ambient objects. */
export const SPECIES: Readonly<Record<string, SpeciesRule>> = {
  baum_eiche: { weight: 3, grounds: FOREST_GROUND },
  baum_buche: { weight: 2, grounds: FOREST_GROUND },
  baum_birke: { weight: 2, grounds: FOREST_GROUND },
  baum_kiefer: { weight: 1.5, grounds: [...FOREST_GROUND, 'sand', 'duenengras'] },
  baum_weide: { weight: 2, grounds: [...FOREST_GROUND, 'moorschlamm'], nearWater: true },
  baum_mangrove: { weight: 2, grounds: ['moorschlamm', 'torf', 'gras', 'erde'], nearWater: true },
  baum_tanne: { weight: 3, grounds: FOREST_GROUND },
  baum_dattelpalme: { weight: 1, grounds: ['sand', 'erde'] },
  baum_aschebaum: { weight: 1, grounds: ['asche', 'erde'] },
  baum_lichtbaum: { weight: 1, grounds: ['kristallboden', 'gras'] },
  pflanze_fasergras: { weight: 2, grounds: ['gras', 'erde', 'torf', 'schnee'] },
  pflanze_strandhafer: { weight: 3, grounds: ['sand', 'duenengras'] },
  pflanze_schilf: { weight: 3, grounds: ['moorschlamm', 'torf', 'gras', 'erde'], nearWater: true },
  pflanze_kaktus: { weight: 1, grounds: ['sand', 'erde'] },
  deko_muscheln: { grounds: ['sand'] },
  deko_tang: { grounds: ['sand'] },
  deko_treibholz: { grounds: ['sand'] },
  deko_eisbrocken: { grounds: ['schnee', 'eis'] },
  deko_moorgras: { weight: 2, grounds: ['moorschlamm', 'torf', 'gras'] },
  deko_blumen: { weight: 2, grounds: ['gras'] },
  deko_graeser: { weight: 2, grounds: ['gras', 'erde', 'sand'] },
  deko_laub: { weight: 1.5, grounds: ['gras', 'erde'] },
};

export const SCATTER = {
  /** Distance to water for near-water species [tiles, Chebyshev]. */
  nearWaterTiles: 3,
  /** Wavelength of the forest noise [tiles per cycle]. Woods and clearings of a few chunks. */
  forestWavelengthTiles: 96,
  /** Margin of candidate anchors around the decided anchors [tiles]: the conflict reach of two footprints. */
  conflictTiles: 2,
} as const;

/** Scatter layers (each reads the blue-noise tile at its own offsets per block). */
const LAYER_TREES = 0;
const LAYER_ROCKS = 1;
const LAYER_BLOCKING_PLANTS = 2;
const LAYER_PLANTS = 3;
const LAYER_DEKO = 4;
/** Bit shift of the second offset taken from a block hash (the first uses the low bits). */
const BLOCK_OFFSET_SHIFT = 16;

/** An ambient species resolved for placement. */
interface Species {
  readonly id: string;
  readonly runtime: number;
  readonly weight: number;
  readonly blocking: boolean;
  readonly fw: number;
  readonly fh: number;
  /** 1 per ground runtime id the species accepts (empty = any). */
  readonly grounds: Uint8Array | null;
  readonly nearWater: boolean;
}

/** Species pools of one biome. */
interface BiomePools {
  readonly density: BiomeVegetation;
  readonly trees: readonly Species[];
  readonly smallRocks: readonly Species[];
  readonly largeRocks: readonly Species[];
  readonly blockingPlants: readonly Species[];
  readonly plants: readonly Species[];
  readonly deko: readonly Species[];
}

const PARSED: readonly WorldObject[] = WORLD_OBJECTS.map((o) => worldObjectSchema.parse(o));

/** Ambient objects of a biome by layer (content-driven). */
export function ambientSpecies(biome: string): { trees: string[]; rocks: string[]; blockingPlants: string[]; plants: string[]; deko: string[] } {
  const of = (o: WorldObject): boolean => o.biomes.includes(biome) && depositKind(o) === null;
  return {
    trees: PARSED.filter((o) => o.kind === 'baum' && of(o)).map((o) => o.id),
    rocks: PARSED.filter((o) => o.kind === 'fels' && of(o)).map((o) => o.id),
    blockingPlants: PARSED.filter((o) => o.kind === 'pflanze' && o.blocking && of(o)).map((o) => o.id),
    plants: PARSED.filter((o) => o.kind === 'pflanze' && !o.blocking && of(o)).map((o) => o.id),
    deko: PARSED.filter((o) => o.kind === 'deko' && of(o)).map((o) => o.id),
  };
}

/** Whether a species accepts the ground and the water rule at (tx, ty). */
function accepts(s: Species, ground: number, win: TileWindow, tx: number, ty: number): boolean {
  if (s.grounds !== null && s.grounds[ground] !== 1) return false;
  return !s.nearWater || win.waterNear(tx, ty, SCATTER.nearWaterTiles);
}

/** Picks a species by weight with the uniform value `u` among those accepting the tile. */
function pick(pool: readonly Species[], u: number, ground: number, win: TileWindow, tx: number, ty: number): Species | null {
  let total = 0;
  for (const s of pool) if (accepts(s, ground, win, tx, ty)) total += s.weight;
  if (total <= 0) return null;
  let t = u * total;
  for (const s of pool) {
    if (!accepts(s, ground, win, tx, ty)) continue;
    t -= s.weight;
    if (t < 0) return s;
  }
  return null;
}

/** Ambient scatter of one world (resolved species, noises, scratch arrays). */
export class AmbientScatter {
  private readonly pools: BiomePools[];
  private readonly forest: Noise2;
  private readonly prioSalt: number;
  private readonly pickSalt: number;
  private readonly sizeSalt: number;
  private readonly blockSalt: number;
  /** Candidates per window tile: species index + 1 into `candSpecies` (0 none). */
  private readonly cand: Int32Array;
  private readonly candPrio: Uint32Array;
  private readonly candSpecies: Species[] = [];
  /** Largest tree, rock and blocking-plant densities of any biome. */
  private readonly maxTrees: number;
  private readonly maxRocks: number;
  private readonly maxBlockingPlants: number;

  constructor(
    private readonly ctx: SurfaceContext,
    private readonly ground: GroundRules,
    objects: RuntimeIdTable,
    terrain: RuntimeIdTable,
    windowCapacity: number,
  ) {
    const resolve = (id: string): Species => {
      const o = PARSED.find((x) => x.id === id) as WorldObject;
      const rule = SPECIES[id] ?? {};
      let grounds: Uint8Array | null = null;
      if (rule.grounds !== undefined) {
        grounds = new Uint8Array(terrain.size + 1);
        for (const g of rule.grounds) grounds[terrain.runtimeId(g)] = 1;
      }
      return { id, runtime: objects.runtimeId(id), weight: rule.weight ?? 1, blocking: o.blocking, fw: o.footprint.w, fh: o.footprint.h, grounds, nearWater: rule.nearWater === true };
    };
    this.pools = PLAN_BIOME_IDS.map((b) => {
      const sp = ambientSpecies(b);
      const density = VEGETATION[b];
      if (density === undefined) throw new Error(`Vegetation: no densities for biome "${b}"`);
      return {
        density,
        trees: sp.trees.map(resolve),
        smallRocks: sp.rocks.filter((id) => id.startsWith('fels_klein_')).map(resolve),
        largeRocks: sp.rocks.filter((id) => id.startsWith('fels_gross_')).map(resolve),
        blockingPlants: sp.blockingPlants.map(resolve),
        plants: sp.plants.map(resolve),
        deko: sp.deko.map(resolve),
      };
    });
    this.maxTrees = Math.max(...this.pools.map((p) => p.density.trees * (1 + p.density.forestSwing)));
    this.maxRocks = Math.max(...this.pools.map((p) => p.density.rocks));
    this.maxBlockingPlants = Math.max(...this.pools.map((p) => p.density.blockingPlants));
    this.forest = genNoise(ctx.plan.seed, 'wald');
    this.prioSalt = genSeed(ctx.plan.seed, 'streuung.vorrang');
    this.pickSalt = genSeed(ctx.plan.seed, 'streuung.art');
    this.sizeSalt = genSeed(ctx.plan.seed, 'streuung.groesse');
    this.blockSalt = genSeed(ctx.plan.seed, 'streuung.block');
    this.cand = new Int32Array(windowCapacity);
    this.candPrio = new Uint32Array(windowCapacity);
  }

  /** Blue-noise value of a layer at a tile: the tile read at the seeded offset of the tile's block. */
  private blue(layer: number, tx: number, ty: number): number {
    const size = this.ctx.blue.size;
    const h = hash3(Math.floor(tx / size), Math.floor(ty / size), layer, this.blockSalt);
    return blueNoiseAt(this.ctx.blue, tx + (h % size), ty + ((h >>> BLOCK_OFFSET_SHIFT) % size));
  }

  /** Blocking candidate at an anchor tile, or null. */
  private blockingCandidate(win: TileWindow, tx: number, ty: number, occ: (x: number, y: number) => number): Species | null {
    // Cheap tests first: blue noise against the largest densities, then against the biome's.
    const bt = this.blue(LAYER_TREES, tx, ty);
    const br = this.blue(LAYER_ROCKS, tx, ty);
    const bp = this.blue(LAYER_BLOCKING_PLANTS, tx, ty);
    if (bt >= this.maxTrees && br >= this.maxRocks && bp >= this.maxBlockingPlants) return null;
    const b = win.biomeOf(tx, ty);
    const pool = this.pools[b] as BiomePools;
    const d = pool.density;
    if (bt >= d.trees * (1 + d.forestSwing) && br >= d.rocks && bp >= d.blockingPlants) return null;
    if (!win.land(tx, ty)) return null;
    const level = win.level(tx, ty);
    const i = win.at(tx, ty);
    if (win.water[i] !== 0) return null;
    const ground = this.ground.groundAt(tx, ty, true, level, 0, b);
    const u = hashToUnit(hash2(tx, ty, this.pickSalt));
    let s: Species | null = null;
    if (level <= d.treeLine && d.trees > 0) {
      const f = 1 + d.forestSwing * this.forest(tx / SCATTER.forestWavelengthTiles, ty / SCATTER.forestWavelengthTiles);
      if (bt < d.trees * f) s = pick(pool.trees, u, ground, win, tx, ty);
    }
    if (s === null && br < d.rocks) s = pick(hashToUnit(hash2(tx, ty, this.sizeSalt)) < d.largeRocks ? pool.largeRocks : pool.smallRocks, u, ground, win, tx, ty);
    if (s === null && bp < d.blockingPlants) s = pick(pool.blockingPlants, u, ground, win, tx, ty);
    if (s === null) return null;
    return blockingFits(win, tx, ty, s.fw, s.fh, level, occ) ? s : null;
  }

  /**
   * Places the ambient objects of the chunk at (x0, y0): `occ` holds the window occupancy of deposit
   * nodes (`OCC_*`, window-indexed) and receives the placed objects; anchors inside the chunk are
   * written to `out.object`, `grounds` holds the ground runtime id of every chunk tile.
   */
  placeChunk(win: TileWindow, x0: number, y0: number, occ: Uint8Array, grounds: Uint8Array, out: ChunkData): void {
    const occAt = (x: number, y: number): number => (win.contains(x, y) ? (occ[(y - win.y0) * win.w + (x - win.x0)] as number) : OCC_NONE);
    const m = SCATTER.conflictTiles;
    // Decided anchors: footprints (≤ 2 wide east, ≤ 2 high north) that reach into the chunk.
    const dx0 = x0 - 1;
    const dx1 = x0 + CHUNK_SIZE - 1;
    const dy0 = y0;
    const dy1 = y0 + CHUNK_SIZE;
    // Candidates within the conflict reach of the decided anchors.
    this.candSpecies.length = 0;
    for (let ty = dy0 - m; ty <= dy1 + m; ty++) {
      for (let tx = dx0 - m; tx <= dx1 + m; tx++) {
        const wi = (ty - win.y0) * win.w + (tx - win.x0);
        this.cand[wi] = 0;
        const s = this.blockingCandidate(win, tx, ty, occAt);
        if (s === null) continue;
        this.candSpecies.push(s);
        this.cand[wi] = this.candSpecies.length;
        this.candPrio[wi] = hash2(tx, ty, this.prioSalt) >>> 0;
      }
    }
    // Local maxima of the priority among conflicting candidates win.
    for (let ty = dy0; ty <= dy1; ty++) {
      for (let tx = dx0; tx <= dx1; tx++) {
        const wi = (ty - win.y0) * win.w + (tx - win.x0);
        const k = this.cand[wi] as number;
        if (k === 0) continue;
        const s = this.candSpecies[k - 1] as Species;
        const prio = this.candPrio[wi] as number;
        let wins = true;
        for (let oy = ty - m; oy <= ty + m && wins; oy++) {
          for (let ox = tx - m; ox <= tx + m && wins; ox++) {
            if (ox === tx && oy === ty) continue;
            const wj = (oy - win.y0) * win.w + (ox - win.x0);
            const kj = this.cand[wj] as number;
            if (kj === 0) continue;
            const o = this.candSpecies[kj - 1] as Species;
            // Footprints dilated by one tile intersect?
            const conflict = ox <= tx + s.fw && ox + o.fw - 1 >= tx - 1 && oy - o.fh + 1 <= ty + 1 && oy >= ty - s.fh;
            if (!conflict) continue;
            const pj = this.candPrio[wj] as number;
            if (pj > prio || (pj === prio && wj < wi)) wins = false;
          }
        }
        if (!wins) continue;
        for (let fy = ty - s.fh + 1; fy <= ty; fy++) for (let fx = tx; fx < tx + s.fw; fx++) if (win.contains(fx, fy)) occ[(fy - win.y0) * win.w + (fx - win.x0)] = OCC_BLOCK;
        if (tx >= x0 && ty >= y0 && tx < x0 + CHUNK_SIZE && ty < y0 + CHUNK_SIZE) out.object[(ty - y0) * CHUNK_SIZE + (tx - x0)] = s.runtime;
      }
    }
    // Plants and scatter on the free chunk tiles.
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const ty = y0 + ly;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tx = x0 + lx;
        const i = ly * CHUNK_SIZE + lx;
        if (out.object[i] !== 0) continue;
        const wi = (ty - win.y0) * win.w + (tx - win.x0);
        if (occ[wi] !== OCC_NONE) continue;
        const bpl = this.blue(LAYER_PLANTS, tx, ty);
        const bdk = this.blue(LAYER_DEKO, tx, ty);
        const b = win.biomeOf(tx, ty);
        const d = (this.pools[b] as BiomePools).density;
        if (bpl >= d.plants && bdk >= d.deko) continue;
        const level = win.level(tx, ty);
        if (!win.free(tx, ty, level)) continue;
        const pool = this.pools[b] as BiomePools;
        const ground = grounds[i] as number;
        const u = hashToUnit(hash2(tx, ty, this.pickSalt));
        let s: Species | null = null;
        if (bpl < d.plants) s = pick(pool.plants, u, ground, win, tx, ty);
        if (s === null && bdk < d.deko) s = pick(pool.deko, u, ground, win, tx, ty);
        if (s === null) continue;
        out.object[i] = s.runtime;
        occ[wi] = OCC_LOOSE;
      }
    }
  }
}
