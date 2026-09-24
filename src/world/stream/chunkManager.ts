/**
 * Chunk streaming (docs/WORLD.md §5, M2-22): which chunks are resident, loading them in a worker
 * around the camera, unloading with hysteresis per layer, and what has to be saved.
 *
 * Residency
 * - `update(layer, cx, cy)` once per frame with the camera chunk. When the camera enters another
 *   chunk or layer, the load square of that layer (`loadRadius[layer]`, Chebyshev) is requested
 *   nearest first, queued requests are re-prioritized, and chunks farther than the load radius plus
 *   the layer's hysteresis ring are unloaded. The most recently visited other layers
 *   (`retainedLayers`) keep their chunks around their last camera position, older layers are
 *   unloaded. Chunks pinned by the active zone are never unloaded.
 * - Loading goes through a `JobQueue` (worker, or in-thread with the same code, see
 *   `stream/worker.ts`): results become resident inside `update()` within the frame budget.
 * - `ensure(layer, cx, cy)` makes a chunk resident synchronously (generation in this thread) for
 *   the simulation, which cannot wait for a worker: chunk contents are a pure function of plan,
 *   address and diff, so the result is identical to the worker path and the simulation stays
 *   deterministic however late the worker is. A pending job for that chunk is cancelled.
 *
 * Modifications and saving
 * - Each resident chunk keeps its generated baseline (8 KiB). On unload a changed chunk leaves its
 *   diff against the baseline in memory (`diffChunk`), so reloading it restores the change without
 *   touching storage; unchanged chunks leave nothing behind.
 * - `collectChanges()` (between two ticks) lists exactly the chunks whose content differs from
 *   what storage holds: new or changed diffs to write and chunks back at their generated state
 *   whose record must be deleted. `markSaved(set)` is called after the transaction committed.
 *   Detection compares content hashes, so systems may write chunk arrays directly.
 * - `loadStored(diffs)` seeds a fresh manager with the diffs of a save; they are applied in the
 *   worker when their chunks load.
 * - `frozenAtTick` of unloaded chunks is kept in a table (saved by the active zone's participant
 *   `world-chunks`, since unchanged chunks have no record).
 *
 * `update()` does not allocate while the camera stays in its chunk and no result arrives.
 */
import { Fnv1a64 } from '../../engine/binary';
import type { JobHandle, JobQueue } from '../../engine/workerBridge';
import { ChunkData, chunkHash } from '../model/chunk';
import { LAYER_COUNT, chunkKey, layerIndex, packChunkId, parseChunkKey, type Layer } from '../model/coords';
import { chunkInWorld, type WorldDimensions } from '../model/worldSize';
import { chunkDistance, resolveStreamConfig, type StreamConfig } from './config';
import { chunkDiffHash, diffChunk, setObjectStateQuads, type ChunkDiff } from './diff';
import { loadChunk, type ChunkGenerateFn, type ChunkWorkerApi, type LoadedChunk } from './worker';

/** A resident chunk with its bookkeeping. */
interface Resident {
  readonly id: number;
  readonly chunk: ChunkData;
  /** The chunk as generated (for diffs). */
  readonly baseline: ChunkData;
  /** Hash of the content storage holds for this chunk; `null` = content differs from storage. */
  cleanHash: string | null;
  /** Pinned by the active zone: never unloaded. */
  pinned: boolean;
}

interface Loading {
  readonly handle: JobHandle;
  readonly layer: Layer;
  readonly cx: number;
  readonly cy: number;
  /** The request carried an unsaved diff (the loaded content differs from storage). */
  readonly fromPending: boolean;
}

/** What one `update()` did (the object is reused by the next call). */
export interface StreamFrameStats {
  /** Load jobs submitted. */
  requested: number;
  /** Load jobs cancelled (chunk left the unload ring or the layer). */
  cancelled: number;
  /** Chunks that became resident from finished jobs. */
  integrated: number;
  /** Chunks unloaded. */
  unloaded: number;
  /** Resident chunks after the frame. */
  resident: number;
  /** Chunks still loading. */
  loading: number;
  /** Main-thread time spent in the job queue [ms]. */
  jobMs: number;
}

/** One record to write (`diff`) or delete (`diff === null`: back to the generated state). */
export interface ChunkChange {
  /** Chunk key `layer:cx:cy`. */
  readonly key: string;
  readonly diff: ChunkDiff | null;
}

/** Result of `collectChanges`: the writes of one save; pass it to `markSaved` after the commit. */
export interface ChunkChangeSet {
  /** Records to write or delete, sorted by key. */
  readonly writes: readonly ChunkChange[];
}

interface ChangeBookkeeping {
  readonly cleaned: ReadonlyArray<{ readonly entry: Resident; readonly hash: string }>;
  readonly pendingTaken: ReadonlyArray<{ readonly id: number; readonly diff: ChunkDiff | null }>;
}

/** Options of a `ChunkManager`. */
export interface ChunkManagerOptions<Plan> {
  /** World plan handed to the generator (sent to the worker once). */
  readonly plan: Plan;
  /** The chunk generator `(plan, layer, cx, cy) → ChunkData`; runs in this thread for `ensure`. */
  readonly generate: ChunkGenerateFn<Plan>;
  /** Loads chunks asynchronously (worker executor, or in-thread executor in Node). */
  readonly jobs: JobQueue<ChunkWorkerApi<Plan>>;
  /** World extent: chunks outside are never loaded. */
  readonly world: WorldDimensions;
  /** Radii, hysteresis and retention (defaults: `STREAM_DEFAULTS`). */
  readonly config?: Partial<StreamConfig>;
}

/** Order of chunk keys in change sets (plain code unit order, platform independent). */
function compareKeys(a: ChunkChange, b: ChunkChange): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Resident chunks of the world, streamed around the camera. */
export class ChunkManager<Plan> {
  readonly world: WorldDimensions;
  readonly config: StreamConfig;
  private readonly plan: Plan;
  private readonly generate: ChunkGenerateFn<Plan>;
  private readonly jobs: JobQueue<ChunkWorkerApi<Plan>>;
  private readonly resident = new Map<number, Resident>();
  private readonly loading = new Map<number, Loading>();
  /** Diffs storage holds (mirror of the chunk records). */
  private readonly stored = new Map<number, ChunkDiff>();
  private readonly storedHashes = new Map<number, string>();
  /** Unloaded chunks whose content differs from storage (`null` = back to generated). */
  private readonly pendingDiffs = new Map<number, ChunkDiff | null>();
  /** `frozenAtTick` of unloaded chunks (only values ≠ 0). */
  private readonly frozenTicks = new Map<number, number>();
  private readonly bookkeeping = new WeakMap<ChunkChangeSet, ChangeBookkeeping>();
  private cameraLayer: Layer | null = null;
  private focusCx = 0;
  private focusCy = 0;
  /** Last camera chunk per layer index (`hasFocus` tells whether the camera was ever there). */
  private readonly layerFocusX = new Int32Array(LAYER_COUNT);
  private readonly layerFocusY = new Int32Array(LAYER_COUNT);
  private readonly hasFocus = new Uint8Array(LAYER_COUNT);
  /** Layers by last camera visit, most recent first. */
  private readonly recency: Layer[] = [];
  private unloadDue = false;
  private failure: Error | null = null;
  private syncLoadCount = 0;
  private readonly unloadScratch: Resident[] = [];
  private readonly stats: StreamFrameStats = { requested: 0, cancelled: 0, integrated: 0, unloaded: 0, resident: 0, loading: 0, jobMs: 0 };
  /** Scratch stats of `trim` (separate from the per-frame stats `update` reports). */
  private readonly trimStats: StreamFrameStats = { requested: 0, cancelled: 0, integrated: 0, unloaded: 0, resident: 0, loading: 0, jobMs: 0 };

  constructor(options: ChunkManagerOptions<Plan>) {
    this.plan = options.plan;
    this.generate = options.generate;
    this.jobs = options.jobs;
    this.world = options.world;
    this.config = resolveStreamConfig(options.config);
    this.jobs.submit('init', [options.plan], {
      priority: Number.NEGATIVE_INFINITY,
      onDone: () => undefined,
      onError: (err) => {
        this.failure = new Error(`Chunk worker init failed: ${err.message}`);
      },
    });
  }

  // --- queries --------------------------------------------------------------------------------

  /** The resident chunk at an address, if loaded. */
  get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    return this.resident.get(packChunkId(layer, cx, cy))?.chunk;
  }

  /** The resident chunk with a packed id, if loaded. */
  getById(id: number): ChunkData | undefined {
    return this.resident.get(id)?.chunk;
  }

  /** Number of resident chunks (all layers). */
  get residentCount(): number {
    return this.resident.size;
  }

  /** Number of resident chunks of one layer. */
  residentOn(layer: Layer): number {
    let n = 0;
    for (const e of this.resident.values()) if (e.chunk.layer === layer) n++;
    return n;
  }

  /** Number of chunks with a load job. */
  get loadingCount(): number {
    return this.loading.size;
  }

  /** Whether a chunk has a load job. */
  isLoading(layer: Layer, cx: number, cy: number): boolean {
    return this.loading.has(packChunkId(layer, cx, cy));
  }

  /** Chunks made resident synchronously by `ensure` (the worker was not fast enough). */
  get syncLoads(): number {
    return this.syncLoadCount;
  }

  /** Calls `fn` for every resident chunk (no particular order). */
  forEachResident(fn: (chunk: ChunkData) => void): void {
    for (const e of this.resident.values()) fn(e.chunk);
  }

  /** Keys of the chunks storage holds a diff for, sorted. */
  storedKeys(): string[] {
    return [...this.stored.values()].map((d) => chunkKey(d.layer, d.cx, d.cy)).sort();
  }

  /** Number of unloaded chunks whose changes are not saved yet. */
  get unsavedUnloaded(): number {
    return this.pendingDiffs.size;
  }

  // --- streaming ------------------------------------------------------------------------------

  /**
   * Once per frame with the camera chunk: re-plans loads and unloads when the camera changed chunk
   * or layer, then lets the job queue deliver results within the frame budget. Rethrows a failed
   * load (generator error) with the chunk address.
   */
  update(layer: Layer, cx: number, cy: number): StreamFrameStats {
    const s = this.stats;
    s.requested = 0;
    s.cancelled = 0;
    s.integrated = 0;
    s.unloaded = 0;
    if (layer !== this.cameraLayer || cx !== this.focusCx || cy !== this.focusCy) this.refocus(layer, cx, cy, s);
    else if (this.unloadDue) this.unloadOutside(s);
    s.jobMs = this.jobs.frame().elapsedMs;
    s.resident = this.resident.size;
    s.loading = this.loading.size;
    const failure = this.failure;
    if (failure !== null) {
      this.failure = null;
      throw failure;
    }
    return s;
  }

  /**
   * Makes a chunk resident now (generated in this thread if it is not loaded yet) and returns it.
   * Used by the simulation (active zone), which must not depend on worker timing.
   */
  ensure(layer: Layer, cx: number, cy: number): ChunkData {
    const id = packChunkId(layer, cx, cy);
    const present = this.resident.get(id);
    if (present !== undefined) return present.chunk;
    if (!chunkInWorld(this.world, cx, cy)) throw new RangeError(`ChunkManager.ensure: chunk ${chunkKey(layer, cx, cy)} lies outside the world (${this.world.chunks}² chunks)`);
    const job = this.loading.get(id);
    if (job !== undefined) {
      this.jobs.cancel(job.handle);
      this.loading.delete(id);
    }
    const fromPending = this.pendingDiffs.has(id);
    const loaded = loadChunk(this.generate, this.plan, { layer, cx, cy, diff: this.diffFor(id, fromPending) });
    this.syncLoadCount++;
    return this.integrate(id, loaded, fromPending).chunk;
  }

  /**
   * Unloads every unpinned chunk the camera rings do not keep, exactly as the next `update()` would.
   * Without any camera (headless simulations, where nothing streams) that is every unpinned chunk,
   * so chunks the active zone froze do not pile up. Returns the number of unloaded chunks.
   */
  trim(): number {
    const s = this.trimStats;
    s.unloaded = 0;
    this.unloadOutside(s);
    return s.unloaded;
  }

  /** Pins a resident chunk (active zone): it stays resident until unpinned. */
  pin(chunk: ChunkData): void {
    this.entryOf(chunk).pinned = true;
  }

  /** Releases a pin; the chunk unloads with the next `update()` if the camera is far away. */
  unpin(chunk: ChunkData): void {
    this.entryOf(chunk).pinned = false;
    this.unloadDue = true;
  }

  private entryOf(chunk: ChunkData): Resident {
    const e = this.resident.get(chunk.id);
    if (e === undefined || e.chunk !== chunk) throw new Error(`ChunkManager: chunk ${chunk.key} is not resident`);
    return e;
  }

  private diffFor(id: number, fromPending: boolean): ChunkDiff | null {
    return fromPending ? (this.pendingDiffs.get(id) ?? null) : (this.stored.get(id) ?? null);
  }

  private unloadRadius(li: number): number {
    return (this.config.loadRadius[li] as number) + (this.config.unloadHysteresis[li] as number);
  }

  private refocus(layer: Layer, cx: number, cy: number, s: StreamFrameStats): void {
    const li = layerIndex(layer);
    if (layer !== this.cameraLayer) {
      const at = this.recency.indexOf(layer);
      if (at >= 0) this.recency.splice(at, 1);
      this.recency.unshift(layer);
    }
    this.cameraLayer = layer;
    this.focusCx = cx;
    this.focusCy = cy;
    this.layerFocusX[li] = cx;
    this.layerFocusY[li] = cy;
    this.hasFocus[li] = 1;
    const load = this.config.loadRadius[li] as number;
    const unload = this.unloadRadius(li);
    for (const [id, l] of this.loading) {
      if (l.layer !== layer || chunkDistance(l.cx, l.cy, cx, cy) > unload) {
        this.jobs.cancel(l.handle);
        this.loading.delete(id);
        s.cancelled++;
      } else {
        const dx = l.cx - cx;
        const dy = l.cy - cy;
        this.jobs.setPriority(l.handle, dx * dx + dy * dy);
      }
    }
    for (let dy = -load; dy <= load; dy++) {
      for (let dx = -load; dx <= load; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!chunkInWorld(this.world, x, y)) continue;
        const id = packChunkId(layer, x, y);
        if (this.resident.has(id) || this.loading.has(id)) continue;
        this.request(id, layer, x, y, dx * dx + dy * dy);
        s.requested++;
      }
    }
    this.unloadOutside(s);
  }

  private request(id: number, layer: Layer, cx: number, cy: number, priority: number): void {
    const fromPending = this.pendingDiffs.has(id);
    const handle = this.jobs.submit('load', [{ layer, cx, cy, diff: this.diffFor(id, fromPending) }], {
      priority,
      onDone: (loaded) => this.onLoaded(id, loaded),
      onError: (err) => {
        this.loading.delete(id);
        this.failure = new Error(`Loading chunk ${chunkKey(layer, cx, cy)} failed: ${err.message}`);
      },
    });
    this.loading.set(id, { handle, layer, cx, cy, fromPending });
  }

  private onLoaded(id: number, loaded: LoadedChunk): void {
    const l = this.loading.get(id);
    if (l === undefined || this.resident.has(id)) return;
    this.loading.delete(id);
    this.integrate(id, loaded, l.fromPending);
    this.stats.integrated++;
  }

  private integrate(id: number, loaded: LoadedChunk, fromPending: boolean): Resident {
    const chunk = new ChunkData(loaded.layer, loaded.cx, loaded.cy, loaded.tiles);
    setObjectStateQuads(chunk, loaded.objects);
    const baseline = new ChunkData(loaded.layer, loaded.cx, loaded.cy, loaded.baseline);
    setObjectStateQuads(baseline, loaded.baselineObjects);
    chunk.frozenAtTick = this.frozenTicks.get(id) ?? 0;
    this.frozenTicks.delete(id);
    if (fromPending) this.pendingDiffs.delete(id);
    const entry: Resident = { id, chunk, baseline, cleanHash: fromPending ? null : loaded.hash, pinned: false };
    this.resident.set(id, entry);
    return entry;
  }

  /** Whether a resident chunk of `layer` at (cx, cy) stays: camera ring, or a retained layer's ring. */
  private keeps(layer: Layer, cx: number, cy: number): boolean {
    const li = layerIndex(layer);
    if (this.hasFocus[li] === 0) return false;
    if (layer !== this.cameraLayer) {
      const rank = this.recency.indexOf(layer);
      // recency[0] is the camera layer; the next `retainedLayers` entries are retained.
      if (rank < 1 || rank > this.config.retainedLayers) return false;
    }
    return chunkDistance(cx, cy, this.layerFocusX[li] as number, this.layerFocusY[li] as number) <= this.unloadRadius(li);
  }

  private unloadOutside(s: StreamFrameStats): void {
    this.unloadDue = false;
    const out = this.unloadScratch;
    for (const e of this.resident.values()) {
      if (!e.pinned && !this.keeps(e.chunk.layer, e.chunk.cx, e.chunk.cy)) out.push(e);
    }
    for (const e of out) this.unload(e);
    s.unloaded += out.length;
    out.length = 0;
  }

  private unload(e: Resident): void {
    if (e.cleanHash === null || chunkHash(e.chunk) !== e.cleanHash) {
      const diff = diffChunk(e.baseline, e.chunk);
      const storedHash = this.storedHashes.get(e.id);
      const matchesStorage = diff === null ? storedHash === undefined : storedHash === chunkDiffHash(diff);
      if (matchesStorage) this.pendingDiffs.delete(e.id);
      else this.pendingDiffs.set(e.id, diff);
    }
    if (e.chunk.frozenAtTick !== 0) this.frozenTicks.set(e.id, e.chunk.frozenAtTick);
    this.resident.delete(e.id);
  }

  // --- saving ---------------------------------------------------------------------------------

  /**
   * Seeds a fresh manager with the diffs of a save (already remapped to the current runtime ids).
   * Throws if chunks were loaded or changed before.
   */
  loadStored(diffs: Iterable<ChunkDiff>): void {
    if (this.resident.size > 0 || this.loading.size > 0 || this.pendingDiffs.size > 0 || this.stored.size > 0) {
      throw new Error('ChunkManager.loadStored: only a fresh manager can take the diffs of a save');
    }
    for (const d of diffs) {
      const id = packChunkId(d.layer, d.cx, d.cy);
      if (!chunkInWorld(this.world, d.cx, d.cy)) throw new RangeError(`ChunkManager.loadStored: chunk ${chunkKey(d.layer, d.cx, d.cy)} lies outside the world`);
      if (this.stored.has(id)) throw new Error(`ChunkManager.loadStored: two diffs for chunk ${chunkKey(d.layer, d.cx, d.cy)}`);
      this.stored.set(id, d);
      this.storedHashes.set(id, chunkDiffHash(d));
    }
  }

  /**
   * The storage the next save writes into holds nothing of this world (a world saved for the first time
   * into this store, or under another id): every change against the generated world counts as unsaved –
   * diffs of a save this manager was seeded with, unloaded changes and resident ones – so the next
   * `collectChanges` lists all of them, not only those since the last save.
   */
  forgetStorage(): void {
    for (const [id, diff] of this.stored) if (!this.pendingDiffs.has(id) && !this.resident.has(id)) this.pendingDiffs.set(id, diff);
    this.stored.clear();
    this.storedHashes.clear();
    for (const e of this.resident.values()) e.cleanHash = null;
  }

  /**
   * The chunk records one save has to write (between two ticks): unloaded chunks with unsaved diffs
   * and resident chunks whose content differs from storage. Chunks that equal their stored record
   * (or are unchanged and unstored) are not listed.
   */
  collectChanges(): ChunkChangeSet {
    const writes: ChunkChange[] = [];
    const cleaned: Array<{ entry: Resident; hash: string }> = [];
    const pendingTaken: Array<{ id: number; diff: ChunkDiff | null }> = [];
    for (const [id, diff] of this.pendingDiffs) {
      pendingTaken.push({ id, diff });
      if (diff !== null || this.stored.has(id)) writes.push({ key: this.keyOf(id, diff), diff });
    }
    for (const e of this.resident.values()) {
      const hash = chunkHash(e.chunk);
      if (e.cleanHash !== null && hash === e.cleanHash) continue;
      const diff = diffChunk(e.baseline, e.chunk);
      const storedHash = this.storedHashes.get(e.id);
      const matchesStorage = diff === null ? storedHash === undefined : storedHash === chunkDiffHash(diff);
      if (!matchesStorage) writes.push({ key: e.chunk.key, diff });
      cleaned.push({ entry: e, hash });
    }
    writes.sort(compareKeys);
    const set: ChunkChangeSet = { writes };
    this.bookkeeping.set(set, { cleaned, pendingTaken });
    return set;
  }

  /** Records that the writes of `set` are committed to storage. */
  markSaved(set: ChunkChangeSet): void {
    const b = this.bookkeeping.get(set);
    if (b === undefined) throw new Error('ChunkManager.markSaved: change set was not collected by this manager or is already marked');
    this.bookkeeping.delete(set);
    for (const w of set.writes) {
      const c = parseChunkKey(w.key);
      const id = packChunkId(c.layer, c.cx, c.cy);
      if (w.diff !== null) {
        this.stored.set(id, w.diff);
        this.storedHashes.set(id, chunkDiffHash(w.diff));
      } else {
        this.stored.delete(id);
        this.storedHashes.delete(id);
      }
    }
    for (const p of b.pendingTaken) {
      if (this.pendingDiffs.has(p.id) && this.pendingDiffs.get(p.id) === p.diff) this.pendingDiffs.delete(p.id);
    }
    for (const c of b.cleaned) {
      if (this.resident.get(c.entry.id) === c.entry) c.entry.cleanHash = c.hash;
    }
  }

  private keyOf(id: number, diff: ChunkDiff | null): string {
    if (diff !== null) return chunkKey(diff.layer, diff.cx, diff.cy);
    const stored = this.stored.get(id) as ChunkDiff;
    return chunkKey(stored.layer, stored.cx, stored.cy);
  }

  /**
   * Digest of every change against the generated world (resident, unloaded and stored), independent
   * of which chunks are resident: equal worlds hash equal (determinism tests, replays).
   */
  contentHash(): string {
    const diffs = new Map<number, string>();
    for (const [id, hash] of this.storedHashes) diffs.set(id, hash);
    for (const [id, diff] of this.pendingDiffs) {
      if (diff === null) diffs.delete(id);
      else diffs.set(id, chunkDiffHash(diff));
    }
    for (const e of this.resident.values()) {
      const diff = diffChunk(e.baseline, e.chunk);
      if (diff === null) diffs.delete(e.id);
      else diffs.set(e.id, chunkDiffHash(diff));
    }
    const h = new Fnv1a64();
    for (const id of [...diffs.keys()].sort((a, b) => a - b)) {
      h.update(Float64Array.of(id));
      h.update(new TextEncoder().encode(diffs.get(id) as string));
    }
    return h.hex();
  }

  // --- frozen ticks (participant `world-chunks`) ------------------------------------------------

  /** Calls `fn(id, tick)` for every chunk with `frozenAtTick ≠ 0`, resident or not. */
  forEachFrozenTick(fn: (id: number, tick: number) => void): void {
    for (const [id, tick] of this.frozenTicks) fn(id, tick);
    for (const e of this.resident.values()) if (e.chunk.frozenAtTick !== 0) fn(e.id, e.chunk.frozenAtTick);
  }

  /** Replaces all `frozenAtTick` values (load): resident chunks take theirs, the rest go to the table. */
  restoreFrozenTicks(ticks: ReadonlyMap<number, number>): void {
    this.frozenTicks.clear();
    for (const [id, tick] of ticks) if (tick !== 0 && !this.resident.has(id)) this.frozenTicks.set(id, tick);
    for (const e of this.resident.values()) e.chunk.frozenAtTick = ticks.get(e.id) ?? 0;
  }
}
