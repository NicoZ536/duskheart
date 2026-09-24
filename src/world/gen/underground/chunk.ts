/**
 * Chunk generator of the underground layers −1/−2/−3 (MASTERPROMPT §9.2 "Untergrund", §9.3,
 * §14 "Im Untergrund Erzadern als grabbares Tile-Material"; docs/WORLD.md §2, §3).
 *
 * `generateUndergroundChunk(plan, layer, cx, cy)` is a pure function of the plan and the chunk
 * address: every decision reads world tile coordinates (hashes, noise) or the carving of the chunk
 * plus `CARVE.objectMarginTiles` (itself computed with border overlap, `carve.ts`), so chunks can be
 * generated in any order and meet seamlessly.
 *
 * Fields (WORLD.md §3):
 * - `solid`: host rock of the layer (`fels`, `tiefenfels`, `glutfels`) or an ore vein `ader_<ore>`
 *   where the deposit mask and the vein pattern of that ore meet; 0 where the cave is open.
 * - `ground`: floor under every tile (what remains after mining): the layer floor with patches, the
 *   special floor in special caverns, lake bed and shore, lava.
 * - `water`: lake bit + depth for underground lakes. `biome`: the layer biome. `height`: 0.
 * - `flags`: `TILE_FLAG_RAMP` on the tile of a way up (cave entrance below the surface, foot of a
 *   shaft), `TILE_FLAG_STAIRS` on the tile of a shaft down, `TILE_FLAG_PLACE` on place slots.
 * - `object`: scatter and plants anywhere on dry floor; blocking objects (bushes, rocks, crystals,
 *   ore nodes) only on a sparse lattice and only where removing the tile keeps its neighbours
 *   4-connected (a "simple" tile), so objects never cut a cave apart.
 */
import { CONTENT } from '../../../content/index';
import { createSimplex2, type Noise2 } from '../../../engine/noise';
import { hash3, hashToUnit } from '../../../engine/rng';
import { ChunkData, TILE_FLAG_PLACE, TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_DEEP, WATER_DEPTH_SHALLOW, WATER_LAKE } from '../../model/chunk';
import { CHUNK_SIZE, type Layer } from '../../model/coords';
import { contentWorldIdTables } from '../../model/runtimeIds';
import { carveRect } from './carve';
import { LAKE_DEEP, LAKE_DRY, LAKE_RIM, LAKE_SHALLOW, lakeRaster } from './lakes';
import { createUndergroundPlan, layerPlanOf, undergroundSeed, type UndergroundInput, type UndergroundLayerPlan, type UndergroundPlan } from './network';
import { CARVE, LINKS, VEINS, isUndergroundLayer, layerParams, type LayerParams, type ObjectDensity, type UndergroundLayer } from './params';

/** Object zones of a dry floor tile. */
const ZONE_NONE = 0;
const ZONE_WAND = 1;
const ZONE_FREI = 2;
const ZONE_BESONDERS = 3;

/** One vein ore of a layer with resolved ids and noise. */
interface VeinRuntime {
  readonly terrain: number;
  readonly deposit: number;
  readonly boosted: boolean;
  readonly depositNoise: Noise2;
  readonly veinNoise: Noise2;
}

/** A placeable object with resolved id and footprint. */
interface ObjectRuntime {
  readonly object: number;
  readonly w: number;
  readonly h: number;
  /** Chance per candidate tile in zone wand / frei / besonders. */
  readonly chance: readonly [number, number, number];
}

/** Everything a layer needs per chunk, built once per plan and layer. */
interface LayerRuntime {
  readonly lp: UndergroundLayerPlan;
  readonly params: LayerParams;
  readonly biome: number;
  readonly hostRock: number;
  readonly floor: number;
  /** Floor patches: terrain where min < floor noise < max. */
  readonly patches: ReadonlyArray<{ readonly terrain: number; readonly min: number; readonly max: number }>;
  readonly lakeRim: number;
  readonly lava: number;
  readonly specialFloor: number;
  readonly floorNoise: Noise2;
  readonly veins: readonly VeinRuntime[];
  readonly scatter: readonly ObjectRuntime[];
  readonly blocking: readonly ObjectRuntime[];
  /** Lattice pitch of blocking objects (largest footprint + 1 tile gap). */
  readonly latticeX: number;
  readonly latticeY: number;
  readonly lakeNodes: readonly number[];
  readonly slotNodes: readonly number[];
  readonly scatterSalt: number;
  readonly blockSalt: number;
}

const runtimeCache = new WeakMap<UndergroundPlan, Map<UndergroundLayer, LayerRuntime>>();

function terrainId(id: string): number {
  return contentWorldIdTables().terrain.runtimeId(id);
}

function objectRuntimes(list: readonly ObjectDensity[], scale: number): ObjectRuntime[] {
  const tables = contentWorldIdTables();
  return list.map((d) => {
    const fp = CONTENT.get('worldObjects', d.id).footprint;
    return { object: tables.objects.runtimeId(d.id), w: fp.w, h: fp.h, chance: [d.wand * scale, d.frei * scale, d.besonders * scale] as const };
  });
}

function assertChanceSums(list: readonly ObjectRuntime[], what: string, layer: UndergroundLayer): void {
  for (let z = 0; z < ZONE_BESONDERS; z++) {
    const sum = list.reduce((s, o) => s + (o.chance[z] as number), 0);
    if (sum > 1) throw new RangeError(`Underground layer ${layer}: ${what} densities of zone ${z + 1} sum to ${sum} per candidate (> 1)`);
  }
}

function layerRuntime(plan: UndergroundPlan, layer: UndergroundLayer): LayerRuntime {
  let perPlan = runtimeCache.get(plan);
  if (perPlan === undefined) {
    perPlan = new Map();
    runtimeCache.set(plan, perPlan);
  }
  const cached = perPlan.get(layer);
  if (cached !== undefined) return cached;
  const p = layerParams(layer);
  const lp = layerPlanOf(plan, layer);
  const blockingDims = p.blocking.map((d) => CONTENT.get('worldObjects', d.id).footprint);
  const latticeX = Math.max(1, ...blockingDims.map((f) => f.w)) + 1;
  const latticeY = Math.max(1, ...blockingDims.map((f) => f.h)) + 1;
  const scatter = objectRuntimes(p.scatter, 1);
  const blocking = objectRuntimes(p.blocking, latticeX * latticeY);
  assertChanceSums(scatter, 'scatter', layer);
  assertChanceSums(blocking, 'blocking', layer);
  const rt: LayerRuntime = {
    lp,
    params: p,
    biome: contentWorldIdTables().biomes.runtimeId(p.biome),
    hostRock: terrainId(p.hostRock),
    floor: terrainId(p.floor),
    patches: p.floorPatches.map((f) => {
      if ((f.above === undefined) === (f.below === undefined)) throw new RangeError(`Underground ${layer}: floor patch ${f.terrain} needs exactly one of above/below`);
      return { terrain: terrainId(f.terrain), min: f.above ?? Number.NEGATIVE_INFINITY, max: f.below ?? Number.POSITIVE_INFINITY };
    }),
    lakeRim: terrainId(p.lakeRim),
    lava: terrainId('lava'),
    specialFloor: terrainId(p.special.floor),
    floorNoise: createSimplex2(undergroundSeed(plan.seed, layer, 'boden')),
    veins: p.veins.map((v) => ({
      terrain: terrainId(`ader_${v.ore}`),
      deposit: v.deposit,
      boosted: p.special.oreBoost.includes(v.ore),
      depositNoise: createSimplex2(undergroundSeed(plan.seed, layer, `lager.${v.ore}`)),
      veinNoise: createSimplex2(undergroundSeed(plan.seed, layer, `ader.${v.ore}`)),
    })),
    scatter,
    blocking,
    latticeX,
    latticeY,
    lakeNodes: lp.nodes.map((n, i) => (n.feature === 'see' || n.feature === 'lavasee' ? i : -1)).filter((i) => i >= 0),
    slotNodes: plan.slots.filter((s) => s.layer === layer).map((s) => s.node),
    scatterSalt: undergroundSeed(plan.seed, layer, 'streu'),
    blockSalt: undergroundSeed(plan.seed, layer, 'hindernis'),
  };
  perPlan.set(layer, rt);
  return rt;
}

/** Index of the first vein whose deposit and vein pattern meet at a tile, or −1. */
function rawVein(rt: LayerRuntime, tx: number, ty: number, boosted: boolean): number {
  const fd = VEINS.depositFrequency;
  const fv = VEINS.veinFrequency;
  for (let k = 0; k < rt.veins.length; k++) {
    const v = rt.veins[k] as VeinRuntime;
    const threshold = boosted && v.boosted ? v.deposit - rt.params.oreBoostAmount : v.deposit;
    if (v.depositNoise(tx * fd, ty * fd) < threshold) continue;
    if (1 - Math.abs(v.veinNoise(tx * fv, ty * fv)) > VEINS.ridgeThreshold) return k;
  }
  return -1;
}

/** x, y offsets of the four edge neighbours. */
const N4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Solid material of a closed tile: a vein where its deposit and vein pattern meet and a 4-neighbour
 * carries the same ore (no single specks), else host rock. `boostedAt` tells whether a tile lies
 * near a special cavern that widens the deposits of its ores.
 */
function solidAt(rt: LayerRuntime, tx: number, ty: number, boostedAt: (tx: number, ty: number) => boolean): number {
  const k = rawVein(rt, tx, ty, boostedAt(tx, ty));
  if (k < 0) return rt.hostRock;
  for (const [dx, dy] of N4) if (rawVein(rt, tx + dx, ty + dy, boostedAt(tx + dx, ty + dy)) === k) return (rt.veins[k] as VeinRuntime).terrain;
  return rt.hostRock;
}

/** Base floor with patches. */
function baseFloor(rt: LayerRuntime, tx: number, ty: number): number {
  if (rt.patches.length === 0) return rt.floor;
  const f = CARVE.floorFrequency;
  const n = rt.floorNoise(tx * f, ty * f);
  let floor = rt.floor;
  for (const patch of rt.patches) if (n > patch.min && n < patch.max) floor = patch.terrain;
  return floor;
}

/**
 * Whether blocking tile `i` keeps its passable 4-neighbours connected through its 8-ring (a
 * "simple" tile of digital topology): then no path between other tiles depends on it.
 */
function isSimpleTile(pass: Uint8Array, w: number, i: number): boolean {
  const ring = [i - w, i - w + 1, i + 1, i + w + 1, i + w, i + w - 1, i - 1, i - w - 1];
  let open4 = 0;
  let joined = 0;
  for (let k = 0; k < ring.length; k += 2) {
    if (pass[ring[k] as number] !== 1) continue;
    open4++;
    if (pass[ring[k + 1] as number] === 1 && pass[ring[(k + 2) % ring.length] as number] === 1) joined++;
  }
  if (open4 === 0) return true;
  const groups = open4 === joined ? 1 : open4 - joined;
  return groups === 1;
}

/** Picks the object of a zone by a uniform number, or −1. */
function pick(list: readonly ObjectRuntime[], zone: number, u: number): number {
  let acc = 0;
  for (let k = 0; k < list.length; k++) {
    acc += (list[k] as ObjectRuntime).chance[zone - 1] as number;
    if (u < acc) return k;
  }
  return -1;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * Generates one chunk of an underground layer. Pure: depends only on the plan and the address.
 * Throws `RangeError` for the surface layer (generated by the surface chunk generator).
 */
export function generateUndergroundChunk(plan: UndergroundPlan, layer: Layer, cx: number, cy: number): ChunkData {
  if (!isUndergroundLayer(layer)) throw new RangeError(`generateUndergroundChunk: layer ${String(layer)} is not an underground layer`);
  const chunk = new ChunkData(layer, cx, cy);
  const rt = layerRuntime(plan, layer);
  const nodes = rt.lp.nodes;
  const om = CARVE.objectMarginTiles;
  const W = CHUNK_SIZE + 2 * om;
  const N = W * W;
  const bx = cx * CHUNK_SIZE;
  const by = cy * CHUNK_SIZE;
  const x0 = bx - om;
  const y0 = by - om;
  const carved = carveRect(plan, layer, x0, y0, W, W);
  const open = carved.open;

  // Lakes overlapping the rectangle.
  const lake = new Uint8Array(N);
  const lava = new Uint8Array(N);
  for (const ni of rt.lakeNodes) {
    const r = lakeRaster(plan, layer, ni);
    if (r.x0 >= x0 + W || r.y0 >= y0 + W || r.x0 + r.w <= x0 || r.y0 + r.h <= y0) continue;
    for (let y = Math.max(y0, r.y0); y < Math.min(y0 + W, r.y0 + r.h); y++) {
      for (let x = Math.max(x0, r.x0); x < Math.min(x0 + W, r.x0 + r.w); x++) {
        const c = r.cells[(y - r.y0) * r.w + (x - r.x0)] as number;
        if (c === LAKE_DRY) continue;
        const i = (y - y0) * W + (x - x0);
        lake[i] = c;
        if (r.lava && c !== LAKE_RIM) lava[i] = 1;
      }
    }
  }

  // Links and place slots: flags on chunk tiles, object-free reserve around them.
  const reserved = new Uint8Array(N);
  const reserve = (tx: number, ty: number, radius: number): void => {
    for (let y = Math.max(y0, ty - radius); y <= Math.min(y0 + W - 1, ty + radius); y++) {
      for (let x = Math.max(x0, tx - radius); x <= Math.min(x0 + W - 1, tx + radius); x++) reserved[(y - y0) * W + (x - x0)] = 1;
    }
  };
  const inChunk = (tx: number, ty: number): boolean => tx >= bx && ty >= by && tx < bx + CHUNK_SIZE && ty < by + CHUNK_SIZE;
  for (const link of plan.links) {
    const up = link.lower === layer;
    if (!up && link.upper !== layer) continue;
    reserve(link.tx, link.ty, LINKS.reserveRadius);
    if (inChunk(link.tx, link.ty)) {
      const i = (link.ty - by) * CHUNK_SIZE + (link.tx - bx);
      chunk.flags[i] = (chunk.flags[i] as number) | (up ? TILE_FLAG_RAMP : TILE_FLAG_STAIRS);
    }
  }
  for (const ni of rt.slotNodes) {
    const n = nodes[ni];
    if (n === undefined) continue;
    const r = n.coreRadius;
    for (let y = Math.max(y0, Math.floor(n.y - r)); y <= Math.min(y0 + W - 1, Math.floor(n.y + r)); y++) {
      for (let x = Math.max(x0, Math.floor(n.x - r)); x <= Math.min(x0 + W - 1, Math.floor(n.x + r)); x++) {
        const dx = x + 0.5 - n.x;
        const dy = y + 0.5 - n.y;
        if (dx * dx + dy * dy >= r * r) continue;
        reserved[(y - y0) * W + (x - x0)] = 1;
        if (inChunk(x, y)) {
          const i = (y - by) * CHUNK_SIZE + (x - bx);
          chunk.flags[i] = (chunk.flags[i] as number) | TILE_FLAG_PLACE;
        }
      }
    }
  }

  // Terrain of the chunk tiles.
  const special = rt.params.special.kind;
  const isSpecial = (i: number): boolean => {
    const ni = carved.node[i] as number;
    return ni >= 0 && nodes[ni]?.feature === special;
  };
  const boostedAt = (tx: number, ty: number): boolean => isSpecial((ty - y0) * W + (tx - x0));
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const tx = bx + lx;
      const ty = by + ly;
      const i = (ly + om) * W + (lx + om);
      const t = ly * CHUNK_SIZE + lx;
      chunk.biome[t] = rt.biome;
      const code = lake[i] as number;
      if (lava[i] === 1) chunk.ground[t] = rt.lava;
      else if (code === LAKE_SHALLOW || code === LAKE_DEEP) {
        chunk.ground[t] = rt.lakeRim;
        chunk.water[t] = WATER_LAKE | (code === LAKE_DEEP ? WATER_DEPTH_DEEP : WATER_DEPTH_SHALLOW);
      } else if (code === LAKE_RIM) chunk.ground[t] = rt.lakeRim;
      else if (isSpecial(i)) chunk.ground[t] = rt.specialFloor;
      else chunk.ground[t] = baseFloor(rt, tx, ty);
      if (open[i] === 0) chunk.solid[t] = solidAt(rt, tx, ty, boostedAt);
    }
  }

  // Objects: passable and dry masks over the rectangle, zones, blocking lattice, scatter.
  const pass = new Uint8Array(N);
  const dry = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (open[i] === 0 || lava[i] === 1) continue;
    const code = lake[i] as number;
    if (code !== LAKE_DEEP) pass[i] = 1;
    if (code === LAKE_DRY || code === LAKE_RIM) dry[i] = 1;
  }
  const zoneOf = (x: number, y: number): number => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= W - 1) return ZONE_NONE;
    const i = y * W + x;
    if (dry[i] === 0 || reserved[i] === 1) return ZONE_NONE;
    if (isSpecial(i)) return ZONE_BESONDERS;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (open[i + dy * W + dx] === 0) return ZONE_WAND;
    return ZONE_FREI;
  };
  const layerIndex = -layer;
  const blockedBy = new Int32Array(N).fill(-1);
  const anchorOf = new Int32Array(N).fill(-1);
  for (let y = om - 1; y <= om + CHUNK_SIZE; y++) {
    const ty = y0 + y;
    if (mod(ty, rt.latticeY) !== 0) continue;
    for (let x = om - 1; x <= om + CHUNK_SIZE; x++) {
      const tx = x0 + x;
      if (mod(tx, rt.latticeX) !== 0) continue;
      const zone = zoneOf(x, y);
      if (zone === ZONE_NONE) continue;
      const k = pick(rt.blocking, zone, hashToUnit(hash3(tx, ty, layerIndex, rt.blockSalt)));
      if (k < 0) continue;
      const o = rt.blocking[k] as ObjectRuntime;
      // Footprint east (+x) and north (−y) of the anchor; each tile must be dry, free and simple.
      const tiles: number[] = [];
      let ok = true;
      for (let dy = 0; dy < o.h && ok; dy++) {
        for (let dx = 0; dx < o.w && ok; dx++) {
          const fx = x + dx;
          const fy = y - dy;
          const j = fy * W + fx;
          ok = fx >= 1 && fy >= 1 && fx < W - 1 && fy < W - 1 && dry[j] === 1 && reserved[j] === 0;
          if (ok) {
            ok = isSimpleTile(pass, W, j);
            if (ok) {
              pass[j] = 0;
              tiles.push(j);
            }
          }
        }
      }
      for (const j of tiles) pass[j] = 1;
      if (!ok) continue;
      anchorOf[y * W + x] = k;
      for (const j of tiles) blockedBy[j] = k;
    }
  }
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const x = lx + om;
      const y = ly + om;
      const i = y * W + x;
      const t = ly * CHUNK_SIZE + lx;
      const anchored = anchorOf[i] as number;
      if (anchored >= 0) {
        chunk.object[t] = (rt.blocking[anchored] as ObjectRuntime).object;
        continue;
      }
      if (blockedBy[i] !== -1) continue;
      const zone = zoneOf(x, y);
      if (zone === ZONE_NONE) continue;
      const k = pick(rt.scatter, zone, hashToUnit(hash3(bx + lx, by + ly, layerIndex, rt.scatterSalt)));
      if (k >= 0) chunk.object[t] = (rt.scatter[k] as ObjectRuntime).object;
    }
  }
  return chunk;
}

const planByInput = new WeakMap<UndergroundInput, UndergroundPlan>();

/**
 * Convenience form of the contract "(world seed, size, surface entrance candidates) → chunk": builds
 * the plan once per input object and generates the chunk. Pure for a given input.
 */
export function generateUndergroundChunkFor(input: UndergroundInput, layer: Layer, cx: number, cy: number): ChunkData {
  let plan = planByInput.get(input);
  if (plan === undefined) {
    plan = createUndergroundPlan(input);
    planByInput.set(input, plan);
  }
  return generateUndergroundChunk(plan, layer, cx, cy);
}
