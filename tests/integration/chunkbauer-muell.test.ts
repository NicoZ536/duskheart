/**
 * M7-115: the chunk builders of the main thread on the real world – the terrain mesh, the object and the ground-decor lists
 * of 256 surface chunks of the world scene, built in the steady state (after three passes for the optimising compiler) –
 * allocate a fraction of what they did: no number object per tile hash (`tileHashInto`, `tileHashBit`), no closure per water
 * tile, no new frame array per cliff tile. Before: 57 KB per chunk (waterCorners 26, seabed and tuft hashes 16, cliffs 4);
 * the objects that survive the scavenger on the route of fluessiges-laufen came largely from here.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../tools/bench/heap';
import { generatedAtlasModule, manifestFromGenerated } from '../../src/render/assets/generated';
import { WorldObjectLayer } from '../../src/render/world/objects';
import { ChunkSignatures } from '../../src/render/world/signature';
import { WorldRenderTables } from '../../src/render/world/tables';
import { TerrainMeshBuilder } from '../../src/render/world/terrainMesh';
import { WORLD_SCENE_PRESET, WORLD_SCENE_SEED } from '../../src/render/world/worldHost';
import type { ChunkLookup } from '../../src/render/world/window';
import { generateChunk } from '../../src/world/gen/chunk';
import { generateWorld } from '../../src/world/gen/world';
import type { ChunkData } from '../../src/world/model/chunk';
import type { Layer } from '../../src/world/model/coords';

/** Mean bytes between two heap samples. */
const SAMPLING_INTERVAL = 64;
/** Chunks of one pass: every second chunk of the 32 × 32 chunks of the small world, 256 in all. */
const SPAN = 32;
const STEP = 2;
/**
 * Budget per chunk [B]: the lists a build hands over (typed arrays of the mesh and the object lists, their headers ≈ 1 KB),
 * the wall records of the autotiler (`wandAn`, src/world/autotile.ts) and the objects of growing lists; measured
 * 17–19 KB (2026-10-12). Before M7-115: 57 KB – a closure per water tile adds ≈ 25 KB, a number object per tuft hash ≈ 10 KB.
 */
const MAX_BYTES_PER_CHUNK = 24 * 1024;

let session: Session;
beforeAll(async () => {
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
});
afterAll(() => session.disconnect());

describe('Chunk-Bauer im Hauptthread (M7-115)', () => {
  it('terrain mesh, objects and ground decor of 256 world chunks: a few KB per chunk', async () => {
    const mod = generatedAtlasModule();
    if (mod === null) return;
    const tables = new WorldRenderTables(manifestFromGenerated(mod));
    const world = generateWorld(WORLD_SCENE_SEED, WORLD_SCENE_PRESET);
    // The chunks around the measured ones, generated beforehand; looked up by number, not by string key.
    const chunks = new Map<number, ChunkData>();
    const key = (cx: number, cy: number): number => (cx + 1) * 64 + (cy + 1);
    for (let cy = -1; cy <= SPAN; cy++) for (let cx = -1; cx <= SPAN; cx++) chunks.set(key(cx, cy), generateChunk(world, 0 as Layer, cx, cy));
    const lookup: ChunkLookup = { get: (layer, cx, cy) => (layer === 0 ? chunks.get(key(cx, cy)) : undefined) };
    let instances = 0;
    const buildPass = (): void => {
      const mesh = new TerrainMeshBuilder(tables);
      const objects = new WorldObjectLayer(tables);
      const signatures = new ChunkSignatures();
      for (let cy = 0; cy < SPAN; cy += STEP) {
        for (let cx = 0; cx < SPAN; cx += STEP) {
          const c = chunks.get(key(cx, cy)) as ChunkData;
          instances += mesh.build(c, lookup).count;
          instances += objects.listOf(c, signatures).decorCount;
        }
      }
    };
    for (let w = 0; w < 3; w++) buildPass();
    await session.post('HeapProfiler.collectGarbage');
    await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as never);
    buildPass();
    const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
    const alloc = pathAllocation(profile, (f) => f.functionName === 'buildPass' && /chunkbauer-muell/.test(f.url));
    const chunkCount = (SPAN / STEP) ** 2;
    const perChunk = alloc.inPath / chunkCount;
    console.info(`Chunk-Bauer: ${(perChunk / 1024).toFixed(1)} KB je Chunk, ${instances} Instanzen; größte Posten ${JSON.stringify(alloc.top)}`);
    expect(instances).toBeGreaterThan(0);
    expect(perChunk, JSON.stringify(alloc.top)).toBeLessThan(MAX_BYTES_PER_CHUNK);
  });
});
