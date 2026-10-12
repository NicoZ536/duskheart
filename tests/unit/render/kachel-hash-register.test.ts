/**
 * M7-115: the chunk builders on the main thread (terrain mesh, object and decor lists) without garbage of their own. The
 * tile hash reaches them through a register (`tileHashInto` → `TILE_HASH[0]`) and as a whole-number bit (`tileHashBit`)
 * instead of a fraction returned by a call – bit-identical to `tileHash01` –, the water corners without a closure per
 * tile, the cliff frames without dropping their array. On the route of fluessiges-laufen these were the largest posts of
 * the objects surviving the scavenger.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { TILE_HASH, tileHash01, tileHashBit, tileHashInto } from '../../../src/render/tilemap/tileSet';
import { GROUND_DECOR_RULES, tuftsOfCell, type DecorTuft } from '../../../src/render/world/groundDecor';
import { objectAnchor } from '../../../src/render/world/objects';
import { WorldRenderTables } from '../../../src/render/world/tables';
import { seabedHollowAt, seabedMotifAt, TerrainMeshBuilder, wallMirrored } from '../../../src/render/world/terrainMesh';
import type { ChunkLookup } from '../../../src/render/world/window';
import { ChunkData, WATER_DEPTH_DEEP, WATER_DEPTH_SHALLOW } from '../../../src/world/model/chunk';
import type { Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

/** Mean bytes between two heap samples (small: almost every allocation is seen). */
const SAMPLING_INTERVAL = 16;
/** Pause for the background compiler before another window [ms]. */
const COMPILER_PAUSE_MS = 200;
/** Windows at most (one-off allocations of the engine land in some, an allocation per call in all). */
const MAX_WINDOWS = 4;
const CS = 32;
const UINT32 = 2 ** 32;

let session: Session;
beforeAll(async () => {
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
});
afterAll(() => session.disconnect());

/** Bytes allocated per call below the function named `name` of this file, best of up to `MAX_WINDOWS` windows. */
async function bytesPerCall(name: string, run: () => void, calls: number): Promise<{ best: number; report: string }> {
  run();
  run();
  const windows: Array<{ per: number; top: unknown }> = [];
  do {
    if (windows.length > 0) await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
    await session.post('HeapProfiler.collectGarbage');
    await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as never);
    run();
    const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
    const alloc = pathAllocation(profile, (f) => f.functionName === name && /kachel-hash-register/.test(f.url));
    windows.push({ per: alloc.inPath / calls, top: alloc.top });
  } while ((windows[windows.length - 1] as { per: number }).per >= 1 && windows.length < MAX_WINDOWS);
  return { best: Math.min(...windows.map((w) => w.per)), report: windows.map((w, i) => `window ${i + 1}: ${w.per.toFixed(2)} B/call ${JSON.stringify(w.top)}`).join('; ') };
}

describe('Kachel-Hash über ein Register (M7-115)', () => {
  it('tileHashInto and tileHashBit give exactly what tileHash01 gives', () => {
    const salts = [0, 1, 0x2c1b3c6d, 0x5bd1e995, 0x68e31da4, 0x7f4a7c15, 0x3c6ef372 + 21 * 0x01000000, -7];
    let n = 0;
    for (const salt of salts) {
      for (let wy = -260; wy < 260; wy += 3) {
        for (let wx = -260; wx < 260; wx += 3) {
          tileHashInto(wx, wy, salt);
          const h = tileHash01(wx, wy, salt);
          if (TILE_HASH[0] !== h) throw new Error(`tileHashInto(${wx}, ${wy}, ${salt}) = ${TILE_HASH[0]} ≠ ${h}`);
          if (tileHashBit(wx, wy, salt) !== (Math.floor(h * UINT32) & 1)) throw new Error(`tileHashBit(${wx}, ${wy}, ${salt})`);
          n++;
        }
      }
    }
    expect(n).toBe(salts.length * 174 * 174);
  });

  it('the hash users of the builders allocate nothing: seabed motifs and hollows, wall mirroring, object anchors, ground tufts', async () => {
    const anchor = { x: 0, y: 0 };
    const def = { blocking: false, footprintW: 1, jitter: true };
    const tufts: DecorTuft[] = [];
    const rule = GROUND_DECOR_RULES[0];
    if (rule === undefined) throw new Error('keine Bodendeko-Regel');
    let sink = 0;
    const CELLS = 64;
    const hashUsers = (): void => {
      for (let ty = 0; ty < CELLS; ty++) {
        for (let tx = 0; tx < CELLS; tx++) {
          if (seabedMotifAt(tx, ty)) sink++;
          if (seabedHollowAt(tx, ty)) sink++;
          if (wallMirrored(0, tx, ty)) sink++;
          objectAnchor(def, tx, ty, anchor);
          sink += anchor.x + tuftsOfCell(rule, tx, ty, tufts);
        }
      }
    };
    const m = await bytesPerCall('hashUsers', hashUsers, CELLS * CELLS);
    expect(sink).toBeGreaterThan(0);
    // Each fraction through a call was a 16-byte number object: the seabed hollow alone asked 13 hashes per tile.
    expect(m.best, m.report).toBeLessThan(1);
  });
});

describe('Chunk-Mesh ohne Müll je Kachel (M7-115)', () => {
  const ids = contentWorldIdTables();
  const T = (id: string): number => ids.terrain.runtimeId(id);
  const B = (id: string): number => ids.biomes.runtimeId(id);

  /** 3×3 surface chunks: sea in the west (shallow to deep), a beach, a plateau of height 2 with cliffs on grass. */
  class Coast implements ChunkLookup {
    readonly chunks = new Map<number, ChunkData>();
    constructor() {
      for (let cy = -1; cy <= 1; cy++) {
        for (let cx = -1; cx <= 1; cx++) {
          const c = new ChunkData(0 as Layer, cx, cy);
          for (let i = 0; i < CS * CS; i++) {
            const tx = cx * CS + (i % CS);
            const ty = cy * CS + Math.floor(i / CS);
            c.biome[i] = B('gruenhain');
            if (tx < 6) {
              c.ground[i] = T('meeresgrund');
              c.water[i] = tx < -10 ? WATER_DEPTH_DEEP : WATER_DEPTH_SHALLOW;
            } else c.ground[i] = tx < 12 ? T('sand') : T('gras');
            if (tx >= 16 && tx < 26 && ty >= 4 && ty < 20) c.height[i] = 2;
          }
          this.chunks.set((cx + 1) * 3 + (cy + 1), c);
        }
      }
    }
    get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
      return layer === 0 && Math.abs(cx) <= 1 && Math.abs(cy) <= 1 ? this.chunks.get((cx + 1) * 3 + (cy + 1)) : undefined;
    }
  }

  it('builds a sea and beach chunk with nothing allocated per tile, a cliff chunk with only the wall records of the autotiler', async () => {
    const mod = generatedAtlasModule();
    if (mod === null) return;
    const builder = new TerrainMeshBuilder(new WorldRenderTables(manifestFromGenerated(mod)));
    const coast = new Coast();
    const sea = coast.get(0 as Layer, -1, 0) as ChunkData;
    const cliffs = coast.get(0 as Layer, 0, 0) as ChunkData;
    let instances = 0;
    const BUILDS = 40;
    const seaBuilds = (): void => {
      for (let k = 0; k < BUILDS; k++) instances += builder.build(sea, coast).count;
    };
    const cliffBuilds = (): void => {
      for (let k = 0; k < BUILDS; k++) instances += builder.build(cliffs, coast).count;
    };
    const s = await bytesPerCall('seaBuilds', seaBuilds, BUILDS);
    const c = await bytesPerCall('cliffBuilds', cliffBuilds, BUILDS);
    expect(instances).toBeGreaterThan(0);
    // Before: a closure per water tile (some 15 KB per build of this chunk), a number object per hash. Left: the mesh the build
    // returns (its typed arrays and record, ≈ 0.4 KB on the heap) – 16 B for one in ten of the 1 024 tiles would exceed this.
    expect(s.best, s.report).toBeLessThan(1024);
    // Cliffs: a new frame array per cliff tile (≈ 15 KB per build of this chunk) and a number object per hash and per call of
    // the autotiler are gone; left are the wall records `wandAn` returns (src/world/autotile.ts), ≈ 8 KB per build here.
    expect(c.best, c.report).toBeLessThan(12 * 1024);
  });
});
