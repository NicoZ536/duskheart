/**
 * Chunk loading as worker jobs (docs/WORLD.md §5 "Generierung/Deserialisierung im Worker").
 *
 * `loadChunk(generate, plan, request)` is the one code path for every chunk that becomes resident:
 * generate the chunk from the world plan (`(plan, layer, cx, cy) → ChunkData`, WORLD.md §2), keep a
 * copy as baseline, apply the stored diff (if any) and hash the result. The worker runs it through
 * `serveChunkWorker`; the main thread runs the very same function through the in-thread executor or
 * `ChunkManager.ensure`, so worker and in-thread results are identical by construction.
 *
 * The worker entry of the game binds the real generator:
 * `serveChunkWorker(self, generateChunk)` in a `*.worker.ts` module (docs/ARCHITEKTUR.md "Welt").
 */
import { createRpcServer, rpcTransfer, type RpcPort, type RpcServer, type RpcTransfer } from '../../engine/workerBridge';
import { ChunkData, chunkHash } from '../model/chunk';
import type { Layer } from '../model/coords';
import { applyChunkDiff, objectStateQuads, setObjectStateQuads, type ChunkDiff } from './diff';

/** The chunk generator contract (WORLD.md §2): a pure function of plan and address. */
export type ChunkGenerateFn<Plan> = (plan: Plan, layer: Layer, cx: number, cy: number) => ChunkData;

/** Which chunk to load and the diff to apply on top of the generated state. */
export interface ChunkLoadRequest {
  readonly layer: Layer;
  readonly cx: number;
  readonly cy: number;
  readonly diff: ChunkDiff | null;
}

/** A loaded chunk in transferable form (all buffers move to the receiver). */
export interface LoadedChunk {
  readonly layer: Layer;
  readonly cx: number;
  readonly cy: number;
  /** Tile data of the chunk (generated + diff), `CHUNK_BYTES` long. */
  readonly tiles: ArrayBuffer;
  /** Tile data as generated (baseline for later diffs). */
  readonly baseline: ArrayBuffer;
  /** Object states of the chunk as quadruples. */
  readonly objects: Float64Array;
  /** Object states as generated. */
  readonly baselineObjects: Float64Array;
  /** `chunkHash` of the loaded chunk. */
  readonly hash: string;
}

/** Generates, applies the diff and hashes one chunk (the shared worker/in-thread code path). */
export function loadChunk<Plan>(generate: ChunkGenerateFn<Plan>, plan: Plan, request: ChunkLoadRequest): LoadedChunk {
  const { layer, cx, cy, diff } = request;
  const generated = generate(plan, layer, cx, cy);
  if (!(generated instanceof ChunkData) || generated.layer !== layer || generated.cx !== cx || generated.cy !== cy) {
    throw new RangeError(`Chunk generator returned ${generated instanceof ChunkData ? generated.key : String(generated)} for ${layer}:${cx}:${cy}`);
  }
  // Copies: the generator keeps whatever it returned, the receiver gets its own buffers.
  const baseline = generated.buffer.slice(0);
  const baselineObjects = objectStateQuads(generated);
  const current = new ChunkData(layer, cx, cy, generated.buffer.slice(0));
  setObjectStateQuads(current, baselineObjects);
  if (diff !== null) applyChunkDiff(current, diff);
  return { layer, cx, cy, tiles: current.buffer, baseline, objects: objectStateQuads(current), baselineObjects, hash: chunkHash(current) };
}

/** Buffers of a loaded chunk to transfer. */
export function loadedChunkTransfer(loaded: LoadedChunk): Transferable[] {
  return [loaded.tiles, loaded.baseline, loaded.objects.buffer, loaded.baselineObjects.buffer];
}

/** RPC API of the chunk worker. */
export interface ChunkWorkerApi<Plan> {
  /** Stores the world plan (sent once; later loads use it). */
  init(plan: Plan): boolean;
  /** Loads one chunk (see `loadChunk`); buffers are transferred. */
  load(request: ChunkLoadRequest): RpcTransfer<LoadedChunk>;
}

/** Handlers of the chunk worker (worker entry and in-thread executor). */
export function createChunkWorkerHandlers<Plan>(generate: ChunkGenerateFn<Plan>): ChunkWorkerApi<Plan> {
  let plan: { value: Plan } | null = null;
  return {
    init(p: Plan): boolean {
      plan = { value: p };
      return true;
    },
    load(request: ChunkLoadRequest): RpcTransfer<LoadedChunk> {
      if (plan === null) throw new Error('Chunk worker: load before init (no world plan)');
      const loaded = loadChunk(generate, plan.value, request);
      return rpcTransfer(loaded, loadedChunkTransfer(loaded));
    },
  };
}

/** Serves the chunk worker API on `port` (the worker's global scope in a `*.worker.ts` entry). */
export function serveChunkWorker<Plan>(port: RpcPort, generate: ChunkGenerateFn<Plan>): RpcServer {
  return createRpcServer<ChunkWorkerApi<Plan>>(createChunkWorkerHandlers(generate), port);
}
