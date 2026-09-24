/**
 * M2-13 acceptance "Konnektivität jedes Höhlensystems zu ≥ 1 Eingang": every chunk of all three
 * underground layers of whole small worlds (without and with a land extent) is generated and
 * stitched; a flood fill from the ways up of each layer (cave entrances for −1, shaft feet for −2/−3)
 * must reach every walkable tile (dry or shallow floor without a blocking object) and every open
 * tile at all. The shafts' upper ends lie on walkable tiles of the layer above, so every cave is
 * connected to the surface. Also checks what the layers must contain: lakes (water −1/−2, lava −3),
 * the special caverns' objects, exposed veins of every ore, place slots and shafts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldSizePreset } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { TILE_FLAG_PLACE, TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_DEEP, waterDepth } from '../../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { worldDimensions } from '../../../src/world/model/worldSize';
import {
  LAYER_PARAMS,
  UNDERGROUND_LAYERS,
  createUndergroundPlan,
  generateUndergroundChunk,
  proposeEntranceCandidates,
  type UndergroundExtent,
  type UndergroundLayer,
  type UndergroundPlan,
} from '../../../src/world/gen/underground/index';

const PRESET: WorldSizePreset = 'small';
const N = worldDimensions(PRESET).tiles;
const TABLES = contentWorldIdTables();
const LAVA = TABLES.terrain.runtimeId('lava');

/** A round island covering the middle of the world (plan cells of 8 tiles), with a bay in the east. */
function islandExtent(): UndergroundExtent {
  const cellTiles = 8;
  const width = N / cellTiles;
  const mask = new Uint8Array(width * width);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - width / 2;
      const dy = y + 0.5 - width / 2;
      const inBay = x > width * 0.62 && Math.abs(dy) < width * 0.08;
      if (dx * dx + dy * dy < (width * 0.38) ** 2 && !inBay) mask[y * width + x] = 1;
    }
  }
  return { cellTiles, width, height: width, mask };
}

/** Stitched fields of one whole layer. */
interface LayerMap {
  readonly open: Uint8Array;
  readonly walk: Uint8Array;
  readonly up: number[];
  readonly down: number[];
  readonly lakeTiles: number;
  readonly lavaTiles: number;
  readonly placeTiles: number;
  readonly objects: Map<string, number>;
  readonly exposedVeins: Map<string, number>;
  /** Tiles of blocking object footprints that are not open floor. */
  readonly footprintsOffFloor: number;
  /** Walkable floor tiles per ground terrain id. */
  readonly floors: ReadonlyMap<string, number>;
}

function stitch(plan: UndergroundPlan, layer: UndergroundLayer): LayerMap {
  const open = new Uint8Array(N * N);
  const walk = new Uint8Array(N * N);
  const solid = new Uint8Array(N * N);
  const up: number[] = [];
  const down: number[] = [];
  const objects = new Map<string, number>();
  const floors = new Map<string, number>();
  let lakeTiles = 0;
  let lavaTiles = 0;
  let placeTiles = 0;
  const blockers: [number, number, number, number][] = [];
  const chunks = N / CHUNK_SIZE;
  for (let cy = 0; cy < chunks; cy++) {
    for (let cx = 0; cx < chunks; cx++) {
      const c = generateUndergroundChunk(plan, layer, cx, cy);
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        const tx = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
        const ty = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
        const t = ty * N + tx;
        solid[t] = c.solid[i] as number;
        const f = c.flags[i] as number;
        if ((f & TILE_FLAG_RAMP) !== 0) up.push(t);
        if ((f & TILE_FLAG_STAIRS) !== 0) down.push(t);
        if ((f & TILE_FLAG_PLACE) !== 0) placeTiles++;
        if (c.solid[i] !== 0) continue;
        open[t] = 1;
        const depth = waterDepth(c.water[i] as number);
        if (depth > 0) lakeTiles++;
        if (c.ground[i] === LAVA) {
          lavaTiles++;
          continue;
        }
        if (depth !== WATER_DEPTH_DEEP) {
          walk[t] = 1;
          const g = TABLES.terrain.stringId(c.ground[i] as number);
          floors.set(g, (floors.get(g) ?? 0) + 1);
        }
        const obj = c.object[i] as number;
        if (obj !== 0) {
          const id = TABLES.objects.stringId(obj);
          objects.set(id, (objects.get(id) ?? 0) + 1);
          const o = CONTENT.get('worldObjects', id);
          if (o.blocking) blockers.push([tx, ty, o.footprint.w, o.footprint.h]);
        }
      }
    }
  }
  let footprintsOffFloor = 0;
  for (const [tx, ty, w, h] of blockers) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const t = (ty - dy) * N + tx + dx;
        if (walk[t] !== 1) footprintsOffFloor++;
        walk[t] = 0;
      }
    }
  }
  const exposedVeins = new Map<string, number>();
  for (let t = 0; t < N * N; t++) {
    const s = solid[t] as number;
    if (s === 0) continue;
    const id = TABLES.terrain.stringId(s);
    if (!id.startsWith('ader_')) continue;
    const x = t % N;
    if ((x > 0 && walk[t - 1] === 1) || (x < N - 1 && walk[t + 1] === 1) || walk[t - N] === 1 || walk[t + N] === 1) exposedVeins.set(id, (exposedVeins.get(id) ?? 0) + 1);
  }
  return { open, walk, up, down, lakeTiles, lavaTiles, placeTiles, objects, exposedVeins, footprintsOffFloor, floors };
}

/** Tiles of `mask` not 4-connected to any seed through `mask`. */
function unreached(mask: Uint8Array, seeds: readonly number[]): number {
  const seen = new Uint8Array(mask.length);
  const queue: number[] = [];
  for (const s of seeds) {
    if (mask[s] === 1 && seen[s] === 0) {
      seen[s] = 1;
      queue.push(s);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head] as number;
    const x = t % N;
    for (const u of [x > 0 ? t - 1 : -1, x < N - 1 ? t + 1 : -1, t - N, t + N]) {
      if (u < 0 || u >= mask.length || mask[u] !== 1 || seen[u] === 1) continue;
      seen[u] = 1;
      queue.push(u);
    }
  }
  let missing = 0;
  for (let t = 0; t < mask.length; t++) if (mask[t] === 1 && seen[t] === 0) missing++;
  return missing;
}

const CASES: ReadonlyArray<{ name: string; seed: number; extent?: UndergroundExtent }> = [
  { name: 'ohne Landmaske', seed: 20260924 },
  { name: 'Insel mit Bucht', seed: 777, extent: islandExtent() },
];

/** Generating and stitching 3 × 1024 chunks takes a few seconds. */
const STITCH_TIMEOUT_MS = 60_000;

describe.each(CASES)('Untergrund einer kleinen Welt ($name)', ({ seed, extent }) => {
  let plan: UndergroundPlan;
  const maps = new Map<UndergroundLayer, LayerMap>();
  beforeAll(() => {
    const entranceCandidates = proposeEntranceCandidates(seed, PRESET, extent);
    plan = createUndergroundPlan(extent === undefined ? { seed, preset: PRESET, entranceCandidates } : { seed, preset: PRESET, entranceCandidates, extent });
    for (const layer of UNDERGROUND_LAYERS) maps.set(layer, stitch(plan, layer));
  }, STITCH_TIMEOUT_MS);

  it.each(UNDERGROUND_LAYERS)('Ebene %i: every cave is connected to a way up', (layer) => {
    const m = maps.get(layer) as LayerMap;
    const links = plan.links.filter((l) => l.lower === layer);
    expect(links.length).toBeGreaterThan(0);
    expect(m.up.sort((a, b) => a - b)).toEqual(links.map((l) => l.ty * N + l.tx).sort((a, b) => a - b));
    for (const t of m.up) expect(m.walk[t], `way up at ${t % N}, ${Math.floor(t / N)} is walkable`).toBe(1);
    let walkable = 0;
    for (const v of m.walk) walkable += v;
    expect(walkable).toBeGreaterThan(N * N * 0.01);
    expect(m.footprintsOffFloor, 'blocking objects stand on walkable floor only').toBe(0);
    expect(unreached(m.walk, m.up), 'walkable tiles without a way to a way up').toBe(0);
    expect(unreached(m.open, m.up), 'open tiles sealed off from every way up').toBe(0);
  });

  it('shafts lead down from walkable tiles of the layer above', () => {
    for (const layer of [-1, -2] as const) {
      const m = maps.get(layer) as LayerMap;
      const shafts = plan.links.filter((l) => l.upper === layer);
      expect(shafts.length).toBeGreaterThan(0);
      expect(m.down.sort((a, b) => a - b)).toEqual(shafts.map((l) => l.ty * N + l.tx).sort((a, b) => a - b));
      for (const t of m.down) expect(m.walk[t]).toBe(1);
    }
    expect((maps.get(-3) as LayerMap).down).toEqual([]);
  });

  it.each(UNDERGROUND_LAYERS)('Ebene %i: lakes, special caverns, exposed veins, slots', (layer) => {
    const m = maps.get(layer) as LayerMap;
    const p = LAYER_PARAMS[layer];
    if (p.lake.kind === 'lava') {
      expect(m.lavaTiles).toBeGreaterThan(200);
      expect(m.lakeTiles).toBe(0);
    } else {
      expect(m.lakeTiles).toBeGreaterThan(200);
      expect(m.lavaTiles).toBe(0);
    }
    expect(m.placeTiles).toBeGreaterThan(100);
    for (const v of p.veins) expect(m.exposedVeins.get(`ader_${v.ore}`) ?? 0, `exposed ader_${v.ore}`).toBeGreaterThan(5);
    // The objects that fill the special caverns show up in numbers (glowcaps in the Pilzhain etc.).
    const specialObject = [...p.scatter, ...p.blocking].reduce((a, b) => (b.besonders > a.besonders ? b : a));
    expect(m.objects.get(specialObject.id) ?? 0, specialObject.id).toBeGreaterThan(50);
    for (const d of [...p.scatter, ...p.blocking]) expect(m.objects.get(d.id) ?? 0, d.id).toBeGreaterThan(0);
    // Every floor patch shows up (−1: bare cave floor and clay pockets, §9.3 "Lehm").
    for (const f of p.floorPatches) expect(m.floors.get(f.terrain) ?? 0, f.terrain).toBeGreaterThan(100);
    if (layer === -1) expect(m.floors.get('lehm') ?? 0).toBeGreaterThan(100);
    else expect(m.floors.get('lehm') ?? 0).toBe(0);
  });
});
