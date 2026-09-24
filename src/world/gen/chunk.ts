/**
 * Chunk generator (docs/WORLD.md §2 step 2, M2-14): `generateChunk(world, layer, cx, cy) → ChunkData`,
 * a pure function of the generated world and the chunk address – chunks can be generated in any
 * order, in a worker or in this thread, and meet seamlessly.
 *
 * Surface (layer 0), per tile (WORLD.md §3):
 * - `height`, `water` and the ramp/stairs/ford flags from the plan sampler; `biome` = the dithered
 *   biome of the transition strips (`worldContext.biomeAt`); `ground` from `chunkGround.ts`.
 * - Places: `TILE_FLAG_PLACE` on location discs, `TILE_FLAG_STAIRS` on the tile of a cave mouth
 *   (the way down, matching the underground's way up at the same tile).
 * - Roads: paved corridor tiles become `strasse` with `TILE_FLAG_ROAD`, decayed ones keep their
 *   ground; corridor and bridge tiles over river water carry `TILE_FLAG_BRIDGE`.
 * - `TILE_FLAG_CLIFF_EDGE` on the upper tile of every height step (not between two ramp tiles).
 * - `object`: the deposit nodes of the world plan, then the ambient scatter (`vegetation.ts`).
 * Underground layers (−1 … −3) come from the cave generator (src/world/gen/underground).
 *
 * The derived data of a world (samplers, indices, scratch windows) is built once per world object
 * and cached in a `WeakMap`; the scratch arrays are reused, so a chunk allocates only its own data.
 */
import { contentWorldIdTables } from '../model/runtimeIds';
import { ChunkData, TILE_FLAG_BRIDGE, TILE_FLAG_CLIFF_EDGE, TILE_FLAG_PLACE, TILE_FLAG_RAMP, TILE_FLAG_ROAD, TILE_FLAG_STAIRS, WATER_RIVER } from '../model/chunk';
import { CHUNK_SIZE, type Layer } from '../model/coords';
import { PLAN_BIOME_IDS } from './plan/index';
import { generateUndergroundChunk } from './underground/index';
import { OCC_BLOCK, OCC_LOOSE, TileWindow } from './chunkWindow';
import { createGroundRules, type GroundRules } from './chunkGround';
import { OBJECTS_BY_ID } from './resources';
import { AmbientScatter } from './vegetation';
import { createReservations, createSurfaceContext, RES_BRIDGE, RES_CAVE, RES_PLACE, RES_ROAD, type Reservations, type SurfaceContext } from './worldContext';
import { slotDiscs } from './locations';
import { roadSegments } from './roads';
import { bridgeSegments } from './validate';
import type { GeneratedWorld } from './world';

/** Window margins around a chunk [tiles]: west, east, south, north (ring, conflict reach, cliff faces). */
export const CHUNK_WINDOW = {
  west: 4,
  east: 5,
  south: 4,
  north: 8,
} as const;

/** Chunk edge (module-local copy for the hot loops). */
const CS = CHUNK_SIZE;
const WINDOW_W = CHUNK_SIZE + CHUNK_WINDOW.west + CHUNK_WINDOW.east;
const WINDOW_H = CHUNK_SIZE + CHUNK_WINDOW.north + CHUNK_WINDOW.south;
const CONNECTOR = TILE_FLAG_RAMP | TILE_FLAG_STAIRS;

/** Derived data of one world for the chunk generator. */
interface ChunkRuntime {
  readonly ctx: SurfaceContext;
  readonly reservations: Reservations;
  readonly win: TileWindow;
  readonly ground: GroundRules;
  readonly scatter: AmbientScatter;
  /** Biome runtime id per plan biome index. */
  readonly biomeIds: Uint8Array;
  /** Object runtime id, footprint and blocking per deposit object index. */
  readonly depositRuntime: Uint16Array;
  readonly depositW: Uint8Array;
  readonly depositH: Uint8Array;
  readonly depositBlocking: Uint8Array;
  /** Window occupancy scratch. */
  readonly occ: Uint8Array;
  /** Ground ids of the chunk tiles (scratch). */
  readonly grounds: Uint8Array;
}

const runtimes = new WeakMap<GeneratedWorld, ChunkRuntime>();

/** Builds (once per world object) the chunk generator's derived data. */
function runtimeOf(world: GeneratedWorld): ChunkRuntime {
  const cached = runtimes.get(world);
  if (cached !== undefined) return cached;
  const tables = contentWorldIdTables();
  const ctx = createSurfaceContext(world.plan);
  const reservations = createReservations(world.seed, world.plan.grid, { discs: slotDiscs(world.locations), roads: roadSegments(world.roads), bridges: bridgeSegments(world.bridges) });
  const ground = createGroundRules(ctx, tables.terrain);
  const res = world.resources;
  const depositRuntime = new Uint16Array(res.objects.length);
  const depositW = new Uint8Array(res.objects.length);
  const depositH = new Uint8Array(res.objects.length);
  const depositBlocking = new Uint8Array(res.objects.length);
  res.objects.forEach((id, i) => {
    const o = OBJECTS_BY_ID.get(id);
    if (o === undefined) throw new RangeError(`Chunk generator: deposit object "${id}" is not in the content`);
    depositRuntime[i] = tables.objects.runtimeId(id);
    depositW[i] = o.footprint.w;
    depositH[i] = o.footprint.h;
    depositBlocking[i] = o.blocking ? 1 : 0;
  });
  const rt: ChunkRuntime = {
    ctx,
    reservations,
    win: new TileWindow(ctx, reservations, WINDOW_W, WINDOW_H),
    ground,
    scatter: new AmbientScatter(ctx, ground, tables.objects, tables.terrain, WINDOW_W * WINDOW_H),
    biomeIds: Uint8Array.from(PLAN_BIOME_IDS.map((id) => tables.biomes.runtimeId(id))),
    depositRuntime,
    depositW,
    depositH,
    depositBlocking,
    occ: new Uint8Array(WINDOW_W * WINDOW_H),
    grounds: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
  };
  runtimes.set(world, rt);
  return rt;
}

/** Generates one chunk of any layer (WORLD.md §2 contract `(plan, layer, cx, cy) → ChunkData`). */
export function generateChunk(world: GeneratedWorld, layer: Layer, cx: number, cy: number): ChunkData {
  if (layer !== 0) return generateUndergroundChunk(world.underground, layer, cx, cy);
  return generateSurfaceChunk(runtimeOf(world), world, cx, cy);
}

/** Marks the deposit nodes around the window in the occupancy and writes those inside the chunk. */
function placeDeposits(rt: ChunkRuntime, world: GeneratedWorld, x0: number, y0: number, out: ChunkData): void {
  const { win, occ } = rt;
  const res = world.resources;
  const cx0 = Math.max(0, Math.floor(win.x0 / CHUNK_SIZE));
  const cy0 = Math.max(0, Math.floor(win.y0 / CHUNK_SIZE));
  const cx1 = Math.min(res.chunks - 1, Math.floor((win.x0 + win.w - 1) / CHUNK_SIZE));
  const cy1 = Math.min(res.chunks - 1, Math.floor((win.y0 + win.h - 1) / CHUNK_SIZE));
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const b = cy * res.chunks + cx;
      for (let j = res.bucketStart[b] as number; j < (res.bucketStart[b + 1] as number); j++) {
        const n = res.bucketItems[j] as number;
        const x = res.nodeX[n] as number;
        const y = res.nodeY[n] as number;
        const o = res.nodeObject[n] as number;
        const w = rt.depositW[o] as number;
        const h = rt.depositH[o] as number;
        const blocking = rt.depositBlocking[o] === 1;
        for (let fy = y - h + 1; fy <= y; fy++) {
          for (let fx = x; fx < x + w; fx++) {
            if (!win.contains(fx, fy)) continue;
            occ[(fy - win.y0) * win.w + (fx - win.x0)] = blocking ? OCC_BLOCK : OCC_LOOSE;
            if (!blocking) break;
          }
        }
        if (x >= x0 && y >= y0 && x < x0 + CHUNK_SIZE && y < y0 + CHUNK_SIZE) out.object[(y - y0) * CHUNK_SIZE + (x - x0)] = rt.depositRuntime[o] as number;
      }
    }
  }
}

function generateSurfaceChunk(rt: ChunkRuntime, world: GeneratedWorld, cx: number, cy: number): ChunkData {
  const chunk = new ChunkData(0, cx, cy);
  const x0 = cx * CS;
  const y0 = cy * CS;
  const { win, ground, grounds } = rt;
  win.reset(x0 - CHUNK_WINDOW.west, y0 - CHUNK_WINDOW.north, WINDOW_W, WINDOW_H);
  rt.occ.fill(0);
  const strasse = ground.ids.strasse;
  for (let ly = 0; ly < CS; ly++) {
    const ty = y0 + ly;
    for (let lx = 0; lx < CS; lx++) {
      const tx = x0 + lx;
      const i = ly * CS + lx;
      const wi = win.at(tx, ty);
      const land = win.land(tx, ty);
      const level = land ? (win.levels[wi] as number) : 0;
      const water = win.water[wi] as number;
      const res = win.res[wi] as number;
      let flags = win.flags[wi] as number;
      const biome = win.biomeOf(tx, ty);
      let g = ground.groundAt(tx, ty, land, level, water, biome);
      if ((res & RES_PLACE) !== 0) flags |= TILE_FLAG_PLACE;
      if ((res & RES_CAVE) !== 0) flags |= TILE_FLAG_STAIRS;
      if ((res & (RES_ROAD | RES_BRIDGE)) !== 0 && (water & WATER_RIVER) !== 0) flags |= TILE_FLAG_BRIDGE;
      else if ((res & RES_ROAD) !== 0 && water === 0 && rt.reservations.paved(tx, ty)) {
        g = strasse;
        flags |= TILE_FLAG_ROAD;
      }
      // Cliff edge: a lower 4-neighbour, unless both tiles belong to a ramp or stairs.
      if (land && (lowerNeighbour(win, tx + 1, ty, level, wi) || lowerNeighbour(win, tx - 1, ty, level, wi) || lowerNeighbour(win, tx, ty + 1, level, wi) || lowerNeighbour(win, tx, ty - 1, level, wi))) {
        flags |= TILE_FLAG_CLIFF_EDGE;
      }
      chunk.height[i] = level;
      chunk.water[i] = water;
      chunk.biome[i] = rt.biomeIds[biome] as number;
      chunk.ground[i] = g;
      chunk.flags[i] = flags;
      grounds[i] = g;
    }
  }
  placeDeposits(rt, world, x0, y0, chunk);
  rt.scatter.placeChunk(win, x0, y0, rt.occ, grounds, chunk);
  return chunk;
}

/** Whether the land tile (x, y) lies below `level` and does not continue the ramp/stairs of window tile `wi`. */
function lowerNeighbour(win: TileWindow, x: number, y: number, level: number, wi: number): boolean {
  if (!win.land(x, y)) return false;
  const j = win.at(x, y);
  if ((win.levels[j] as number) >= level) return false;
  return !(((win.flags[wi] as number) & CONNECTOR) !== 0 && ((win.flags[j] as number) & CONNECTOR) !== 0);
}
