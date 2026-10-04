/**
 * The deterministic path service of the simulation (M6-16, docs/SPIEL.md §12, ADR-0080).
 *
 * - `request(req, tick)` returns a ticket. The request is **admitted** in the first tick with room in the per-tick
 *   budget (`BALANCE.ai.path.requestsPerTick` requests, `nodesPerTick` nodes as the sum of their node limits; the
 *   first request of a tick always fits) – requests over budget wait in a FIFO queue. Its ready tick is known at once:
 *   `readyTick = admitTick + BALANCE.ai.pathLatencyTicks`, because the budget bookkeeping only depends on the order
 *   of the requests.
 * - Admitting takes the **snapshot**: the tile words of a window of chunks around start and goal (from the per-chunk
 *   cache, `PathTileCache`), light marks for shadow brood, the search parameters. With a job queue the snapshot goes
 *   to the path worker as well.
 * - `poll(ticket, tick)` returns nothing before the ready tick. From then on it returns the worker's answer if it has
 *   arrived, else it computes the same pure function (`findPath`) on the same snapshot in this thread. The result
 *   therefore never depends on when (or whether) the worker answered; the worker only saves the simulation's time.
 * - `update(tick)` admits the queued requests whose tick has come (call it once per tick; `request` and `poll` catch up
 *   on their own). `cancel(ticket)` drops a request. `frame()` drives the worker's job queue once per rendered frame.
 * - Pending requests are simulation state: `serialize()` stores queued requests as they are and admitted ones with
 *   their result (computed on the spot if the worker has not answered), so that a loaded game delivers exactly what the
 *   uninterrupted one would; the owner of the service saves it with its participant.
 * - Allocation: tickets, snapshots and results are pooled; the in-thread path allocates nothing per request once the
 *   pools and arrays have grown. On the worker route the job messages are pooled too (`PathJobMessage`): each snapshot is
 *   copied into reused arrays that move to the worker and come back with its answer (also the answer of a job given up
 *   meanwhile, `onDropped`), and the job's argument list, options and handlers are made once per message. What remains
 *   per request belongs to the bridge: the queue's job record, the RPC call and the structured clone of the message (its
 *   objects, not its buffers).
 *
 * Tickets are pooled objects: after `poll` returned a result or after `cancel`, the ticket is spent and its holder
 * drops it. A delivered result belongs to the service and stays valid until the next `request`.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import type { Entity } from '../../engine/ecs';
import type { JobHandle } from '../../engine/workerBridge';
import type { CollisionGrid } from '../collision/tiles';
import { CHUNK_SHIFT, CHUNK_SIZE, isLayer, type Layer } from '../model/coords';
import { PathTileCache } from './cache';
import { PathDebugLog, type PathDebugPath } from './log';
import type { PathDoorSource } from './doors';
import { PathContext, PathJobBuffers, PathSnapshot, decodeAnswer, findPath, type PathJob } from './find';
import { PATH_LIGHT, PATH_STATUS_CODES, copyPathResult, createPathResult, grow, pathProfile } from './grid';
import type { PathLightSampler } from './light';
import { MOVER_CLASSES, type MoverClass, type PathRequest, type PathResult, type PathTicket } from './types';
import type { PathJobs } from './worker';

/** Save format version of `serialize()`. */
export const PATH_SERVICE_SAVE_VERSION = 1;

const FREE = 0;
const QUEUED = 1;
const ADMITTED = 2;
const ANSWERED = 3;

/** One pending request (the ticket its owner holds). */
class PathSlot implements PathTicket {
  id = 0;
  owner: Entity = 0;
  readyTick = 0;
  state = FREE;
  admitTick = 0;
  layer: Layer = 0;
  fromTx = 0;
  fromTy = 0;
  toTx = 0;
  toTy = 0;
  mover: MoverClass = 'land';
  opensDoors = false;
  /** `avoidLightAbove`, NaN for none. */
  lightAbove = Number.NaN;
  maxNodes = 0;
  snapshot: PathSnapshot | null = null;
  job: JobHandle | null = null;
  /** The message of `job` (its arrays, handlers and options). */
  message: PathJobMessage | null = null;
  byWorker = false;
  readonly result: PathResult = createPathResult();
}

/**
 * The message of one worker job and how the service hears of it: the reused arrays (`PathJobBuffers`), the argument list
 * and the job options with handlers bound once (`PathService.takeMessage`) – a request on the worker route makes no
 * closure, array, options object or buffer of its own (M6 review perf:path-worker-message-alloc). It serves one slot at a
 * time; a slot that gives its job up (cancelled, computed in this thread) lets it go, and the message returns to the pool
 * as soon as its arrays do: at once while the job still waits in the queue, else with the dropped answer.
 */
class PathJobMessage extends PathJobBuffers {
  /** The slot the message works for, `null` when given up or free. */
  slot: PathSlot | null = null;
  readonly args: [job: PathJob] = [this.job];
  options: PathJobOptions | null = null;
}

/** The options a message submits its job with (one object per message). */
interface PathJobOptions {
  readonly transfer: ArrayBuffer[];
  readonly onDone: (answer: PathJob) => void;
  readonly onError: (error: Error) => void;
  readonly onDropped: (answer: PathJob) => void;
}

/** Options of a `PathService`. */
export interface PathServiceOptions {
  /** The world's collision grid (the game: `WorldCollision.grid`, built once the world exists). */
  readonly grid: CollisionGrid | (() => CollisionGrid);
  /**
   * Chunks a path may use (the game: the active zone's chunks – deterministic, unlike which chunks happen to be
   * resident). Default: every loaded chunk.
   */
  readonly chunkAllowed?: ((layer: Layer, cx: number, cy: number) => boolean) | null;
  /** Closed doors (the building's structures). */
  readonly doors?: PathDoorSource | null;
  /** Light for requests with `avoidLightAbove`. */
  readonly light?: PathLightSampler | null;
  /** The worker's job queue (browser). Without it every path is computed in this thread at its ready tick. */
  readonly jobs?: PathJobs | null;
  /** Keep the last path per owner for the debug overlay. */
  readonly debug?: boolean;
}

/** Counters of the service (tests, bench, debug view). */
export interface PathServiceStats {
  requested: number;
  admitted: number;
  /** Results the worker delivered before they were needed. */
  byWorker: number;
  /** Results computed in this thread (no worker, or it was late). */
  inThread: number;
  cancelled: number;
  /** Nodes expanded by the results delivered so far. */
  expanded: number;
  /**
   * Job messages made for the worker route: the pool grows to the jobs queued and in flight at once, not with the
   * requests (M6 review perf:path-worker-message-alloc).
   */
  jobMessages: number;
}

const safeInt = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const pendingSchema = z
  .object({
    id: safeInt.positive(),
    owner: safeInt.nonnegative(),
    readyTick: safeInt,
    admitTick: safeInt,
    layer: safeInt.refine(isLayer, 'unbekannte Ebene'),
    fromTx: safeInt,
    fromTy: safeInt,
    toTx: safeInt,
    toTy: safeInt,
    mover: z.enum(MOVER_CLASSES),
    opensDoors: z.boolean(),
    avoidLightAbove: z.number().finite().nullable(),
    maxNodes: safeInt.positive(),
    result: z.object({ status: z.enum(PATH_STATUS_CODES), tiles: z.array(safeInt), expanded: safeInt.nonnegative() }).strict().nullable(),
  })
  .strict();
/** Saved state of a `PathService`. */
export const pathServiceSnapshotSchema = z
  .object({
    nextId: safeInt.positive(),
    cursorTick: safeInt,
    cursorRequests: safeInt.nonnegative(),
    cursorNodes: safeInt.nonnegative(),
    pending: z.array(pendingSchema),
  })
  .strict();
/** Saved state of a `PathService`. */
export type PathServiceSnapshot = z.output<typeof pathServiceSnapshotSchema>;

/** The path service (see module comment). */
export class PathService {
  readonly tiles: PathTileCache;
  readonly context = new PathContext();
  readonly stats: PathServiceStats = { requested: 0, admitted: 0, byWorker: 0, inThread: 0, cancelled: 0, expanded: 0, jobMessages: 0 };
  private readonly gridOf: () => CollisionGrid;
  private chunkAllowed: ((layer: Layer, cx: number, cy: number) => boolean) | null;
  private light: PathLightSampler | null;
  private readonly jobs: PathJobs | null;
  private debugLog: PathDebugLog | null;
  private nextId = 1;
  private cursorTick = Number.MIN_SAFE_INTEGER;
  private cursorRequests = 0;
  private cursorNodes = 0;
  /** Slots in use, ordered by id. */
  private readonly live: PathSlot[] = [];
  private liveCount = 0;
  // Pools as stacks with a count: `pop` would shrink an array's store and the next `push` allocate a new one.
  private readonly spareSlots: PathSlot[] = [];
  private spareSlotCount = 0;
  private readonly spareSnapshots: PathSnapshot[] = [];
  private spareSnapshotCount = 0;
  private readonly spareMessages: PathJobMessage[] = [];
  private spareMessageCount = 0;
  // FIFO of queued slots (with the id they had when queued).
  private queueSlots: Array<PathSlot | null> = [];
  private queueIds = new Float64Array(0);
  private queueHead = 0;
  private queueTail = 0;
  private lightMask = new Uint8Array(0);
  private readonly range = new Int32Array(2);

  constructor(options: PathServiceOptions) {
    const grid = options.grid;
    this.gridOf = typeof grid === 'function' ? grid : () => grid;
    this.chunkAllowed = options.chunkAllowed ?? null;
    this.light = options.light ?? null;
    this.jobs = options.jobs ?? null;
    this.debugLog = options.debug === true ? new PathDebugLog(BALANCE.ai.path.debugOwners) : null;
    this.tiles = new PathTileCache({ grid: this.gridOf, doors: options.doors ?? null });
    const p = BALANCE.ai.path;
    if (p.maxWindowChunks < 2 * p.windowMarginChunks + 1) throw new RangeError('PathService: the window must hold the start chunk and its margin');
  }

  // ---------------------------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------------------------

  /** Sets the door source (the building system); every cached chunk is rebuilt. */
  useDoors(doors: PathDoorSource | null): void {
    this.tiles.setDoors(doors);
  }

  /** Sets the light sampler for requests with `avoidLightAbove`. */
  useLight(light: PathLightSampler | null): void {
    this.light = light;
  }

  /** Sets which chunks paths may use. */
  useChunkFilter(allowed: ((layer: Layer, cx: number, cy: number) => boolean) | null): void {
    this.chunkAllowed = allowed;
  }

  /** A collision-relevant tile changed (`WorldCollision.addChangeListener`). */
  invalidateTile(layer: Layer, tx: number, ty: number): void {
    this.tiles.invalidateTile(layer, tx, ty);
  }

  /** Something anywhere in a chunk changed. */
  invalidateChunk(layer: Layer, cx: number, cy: number): void {
    this.tiles.invalidateChunk(layer, cx, cy);
  }

  /** Drives the worker's job queue: sends snapshots, delivers answers (once per rendered frame; no-op without worker). */
  frame(): void {
    this.jobs?.frame();
  }

  // ---------------------------------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------------------------------

  /** Requests a path in tick `tick` (see module comment). */
  request(req: PathRequest, tick: number): PathTicket {
    checkRequest(req);
    this.admitDue(tick);
    const slot = this.takeSlot();
    slot.id = this.nextId++;
    slot.owner = req.owner;
    slot.layer = req.layer as Layer;
    slot.fromTx = req.fromTx;
    slot.fromTy = req.fromTy;
    slot.toTx = req.toTx;
    slot.toTy = req.toTy;
    slot.mover = req.mover;
    slot.opensDoors = req.opensDoors;
    slot.lightAbove = req.avoidLightAbove ?? Number.NaN;
    slot.maxNodes = Math.min(req.maxNodes, BALANCE.ai.path.maxNodesPerRequest);
    slot.byWorker = false;
    slot.admitTick = this.book(tick, slot.maxNodes);
    slot.readyTick = slot.admitTick + BALANCE.ai.pathLatencyTicks;
    this.addLive(slot);
    this.stats.requested++;
    if (slot.admitTick <= tick) this.admit(slot, tick);
    else this.enqueue(slot);
    return slot;
  }

  /** Admits the queued requests whose admission tick has come. */
  update(tick: number): void {
    this.admitDue(tick);
  }

  /**
   * The result of a ticket from its ready tick on, else `null`. A delivered result spends the ticket; it stays valid
   * until the next `request`.
   */
  poll(ticket: PathTicket, tick: number): PathResult | null {
    const slot = this.own(ticket);
    if (tick < slot.readyTick) return null;
    this.admitDue(tick);
    if (slot.state === ADMITTED) this.compute(slot);
    if (this.debugLog !== null) this.debugLog.record(slot.owner, slot.layer, tick, slot.fromTx, slot.fromTy, slot.toTx, slot.toTy, slot.result, slot.byWorker);
    this.stats.expanded += slot.result.expanded;
    this.release(slot);
    return slot.result;
  }

  /** Drops a pending request. Returns whether it was still pending. */
  cancel(ticket: PathTicket): boolean {
    const slot = ticket as PathSlot;
    if (!(slot instanceof PathSlot) || slot.state === FREE || !this.isLive(slot)) return false;
    this.stats.cancelled++;
    this.release(slot);
    return true;
  }

  /** Number of pending requests (queued, admitted or answered). */
  get pending(): number {
    return this.liveCount;
  }

  /** Number of requests waiting for their admission tick. */
  get queued(): number {
    let n = 0;
    for (let i = 0; i < this.liveCount; i++) if ((this.live[i] as PathSlot).state === QUEUED) n++;
    return n;
  }

  /** The pending ticket with `id` (owners find theirs again after loading), or `undefined`. */
  ticket(id: number): PathTicket | undefined {
    for (let i = 0; i < this.liveCount; i++) if ((this.live[i] as PathSlot).id === id) return this.live[i];
    return undefined;
  }

  // ---------------------------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------------------------

  /** Switches the debug log of the last path per owner on or off (off forgets it). */
  setDebug(on: boolean): void {
    if (on && this.debugLog === null) this.debugLog = new PathDebugLog(BALANCE.ai.path.debugOwners);
    if (!on) this.debugLog = null;
  }

  /** Visits the last path of every owner (debug log on). */
  forEachDebugPath(visit: (path: PathDebugPath) => void): void {
    this.debugLog?.forEach(visit);
  }

  /** The last path of `owner` (debug log on), if kept. */
  debugPathOf(owner: Entity): PathDebugPath | undefined {
    return this.debugLog?.pathOf(owner);
  }

  /** Visits the pending requests: owner, layer, start, goal and ready tick (the overlay draws what is still planned). */
  forEachPending(visit: (ticket: PathTicket, layer: Layer, fromTx: number, fromTy: number, toTx: number, toTy: number) => void): void {
    for (let i = 0; i < this.liveCount; i++) {
      const s = this.live[i] as PathSlot;
      visit(s, s.layer, s.fromTx, s.fromTy, s.toTx, s.toTy);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------------------------

  /**
   * The pending requests: queued ones as requests, admitted ones with their result (computed now when the worker has
   * not answered – the same result it would give at the ready tick).
   */
  serialize(): PathServiceSnapshot {
    const pending: PathServiceSnapshot['pending'] = [];
    for (let i = 0; i < this.liveCount; i++) {
      const s = this.live[i] as PathSlot;
      if (s.state === ADMITTED) this.compute(s);
      const r = s.result;
      pending.push({
        id: s.id,
        owner: s.owner,
        readyTick: s.readyTick,
        admitTick: s.admitTick,
        layer: s.layer,
        fromTx: s.fromTx,
        fromTy: s.fromTy,
        toTx: s.toTx,
        toTy: s.toTy,
        mover: s.mover,
        opensDoors: s.opensDoors,
        avoidLightAbove: Number.isNaN(s.lightAbove) ? null : s.lightAbove,
        maxNodes: s.maxNodes,
        result: s.state === QUEUED ? null : { status: r.status, tiles: Array.from(r.tiles.subarray(0, r.steps * 2)), expanded: r.expanded },
      });
    }
    return { nextId: this.nextId, cursorTick: this.cursorTick, cursorRequests: this.cursorRequests, cursorNodes: this.cursorNodes, pending };
  }

  /** Restores `serialize()` output; every current request is dropped. */
  deserialize(data: unknown): void {
    const snap = pathServiceSnapshotSchema.parse(data);
    while (this.liveCount > 0) this.release(this.live[this.liveCount - 1] as PathSlot);
    this.queueHead = 0;
    this.queueTail = 0;
    this.nextId = snap.nextId;
    this.cursorTick = snap.cursorTick;
    this.cursorRequests = snap.cursorRequests;
    this.cursorNodes = snap.cursorNodes;
    const sorted = [...snap.pending].sort((a, b) => a.id - b.id);
    for (const p of sorted) {
      const slot = this.takeSlot();
      slot.id = p.id;
      slot.owner = p.owner;
      slot.readyTick = p.readyTick;
      slot.admitTick = p.admitTick;
      slot.layer = p.layer as Layer;
      slot.fromTx = p.fromTx;
      slot.fromTy = p.fromTy;
      slot.toTx = p.toTx;
      slot.toTy = p.toTy;
      slot.mover = p.mover;
      slot.opensDoors = p.opensDoors;
      slot.lightAbove = p.avoidLightAbove ?? Number.NaN;
      slot.maxNodes = p.maxNodes;
      slot.byWorker = false;
      this.addLive(slot);
      if (p.result === null) {
        this.enqueue(slot);
        continue;
      }
      const steps = p.result.tiles.length >> 1;
      const r = slot.result;
      if (r.tiles.length < steps * 2) r.tiles = new Int32Array(grow(r.tiles.length, steps * 2));
      for (let i = 0; i < steps * 2; i++) r.tiles[i] = p.result.tiles[i] as number;
      r.status = p.result.status;
      r.steps = steps;
      r.expanded = p.result.expanded;
      slot.state = ANSWERED;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  /** Books a request of `nodes` into the budget from tick `tick` on; returns its admission tick. */
  private book(tick: number, nodes: number): number {
    const p = BALANCE.ai.path;
    if (this.cursorTick < tick) {
      this.cursorTick = tick;
      this.cursorRequests = 0;
      this.cursorNodes = 0;
    }
    if (this.cursorRequests >= p.requestsPerTick || (this.cursorRequests > 0 && this.cursorNodes + nodes > p.nodesPerTick)) {
      this.cursorTick++;
      this.cursorRequests = 0;
      this.cursorNodes = 0;
    }
    this.cursorRequests++;
    this.cursorNodes += nodes;
    return this.cursorTick;
  }

  private admitDue(tick: number): void {
    while (this.queueHead < this.queueTail) {
      const slot = this.queueSlots[this.queueHead] as PathSlot | null;
      const id = this.queueIds[this.queueHead] as number;
      if (slot !== null && slot.id === id && slot.state === QUEUED && slot.admitTick > tick) return;
      this.queueSlots[this.queueHead] = null;
      this.queueHead++;
      if (slot !== null && slot.id === id && slot.state === QUEUED) this.admit(slot, tick);
    }
    this.queueHead = 0;
    this.queueTail = 0;
  }

  private enqueue(slot: PathSlot): void {
    if (this.queueTail >= this.queueSlots.length) {
      if (this.queueHead > 0) {
        // Move the live part to the front.
        let w = 0;
        for (let r = this.queueHead; r < this.queueTail; r++, w++) {
          this.queueSlots[w] = this.queueSlots[r] as PathSlot | null;
          this.queueIds[w] = this.queueIds[r] as number;
        }
        for (let r = w; r < this.queueTail; r++) this.queueSlots[r] = null;
        this.queueTail = w;
        this.queueHead = 0;
      }
      if (this.queueTail >= this.queueSlots.length) {
        const n = grow(this.queueSlots.length, this.queueTail + 1);
        while (this.queueSlots.length < n) this.queueSlots.push(null);
        const ids = new Float64Array(n);
        ids.set(this.queueIds.subarray(0, this.queueTail));
        this.queueIds = ids;
      }
    }
    slot.state = QUEUED;
    this.queueSlots[this.queueTail] = slot;
    this.queueIds[this.queueTail] = slot.id;
    this.queueTail++;
  }

  /** Takes the snapshot of a request and sends it to the worker. */
  private admit(slot: PathSlot, tick: number): void {
    const s = this.spareSnapshotCount > 0 ? (this.spareSnapshots[--this.spareSnapshotCount] as PathSnapshot) : new PathSnapshot();
    this.snapshot(slot, s, tick);
    slot.snapshot = s;
    slot.state = ADMITTED;
    this.stats.admitted++;
    const jobs = this.jobs;
    if (jobs === null) return;
    const m = this.takeMessage();
    m.slot = slot;
    m.args[0] = m.encode(s);
    slot.message = m;
    slot.job = jobs.submit('findPath', m.args, m.options as PathJobOptions);
  }

  /** The worker answered the job of message `m`. */
  private answered(m: PathJobMessage, answer: PathJob): void {
    const slot = m.slot;
    if (slot !== null && slot.message === m && slot.state === ADMITTED) {
      decodeAnswer(answer, slot.result);
      slot.job = null;
      slot.message = null;
      slot.byWorker = true;
      this.releaseSnapshot(slot);
      slot.state = ANSWERED;
      this.stats.byWorker++;
    }
    this.putMessage(m, answer);
  }

  /** A failed worker job changes nothing: the simulation computes the path at its ready tick. Its arrays are gone. */
  private failed(m: PathJobMessage): void {
    const slot = m.slot;
    m.slot = null;
    if (slot !== null && slot.message === m) {
      slot.job = null;
      slot.message = null;
    }
  }

  /** The answer of a job given up after it started: its arrays are back, the message returns to the pool. */
  private recovered(m: PathJobMessage, answer: PathJob): void {
    if (m.slot === null) this.putMessage(m, answer);
  }

  /** A message from the pool, or a new one with its options and handlers. */
  private takeMessage(): PathJobMessage {
    if (this.spareMessageCount > 0) return this.spareMessages[--this.spareMessageCount] as PathJobMessage;
    const m = new PathJobMessage();
    m.options = { transfer: m.transfer, onDone: (answer) => this.answered(m, answer), onError: () => this.failed(m), onDropped: (answer) => this.recovered(m, answer) };
    this.stats.jobMessages++;
    return m;
  }

  /** Back to the pool with the arrays of `answer` (they came back moved), or with its own when they never left. */
  private putMessage(m: PathJobMessage, answer: PathJob | null): void {
    if (answer !== null) {
      m.adopt(answer);
      m.args[0] = m.job;
    }
    m.slot = null;
    if (this.spareMessageCount < this.spareMessages.length) this.spareMessages[this.spareMessageCount] = m;
    else this.spareMessages.push(m);
    this.spareMessageCount++;
  }

  /**
   * The slot gives its worker job up (cancelled, or computed in this thread): a job still waiting in the queue never
   * moved its arrays – its message is free at once; a started one brings them back with its dropped answer (`recovered`).
   */
  private dropJob(slot: PathSlot): void {
    const handle = slot.job;
    const m = slot.message;
    slot.job = null;
    slot.message = null;
    if (handle === null) return;
    const waiting = handle.state === 'queued';
    this.jobs?.cancel(handle);
    if (m === null) return;
    m.slot = null;
    if (waiting) this.putMessage(m, null);
  }

  /** Computes an admitted request in this thread. */
  private compute(slot: PathSlot): void {
    findPath(slot.snapshot as PathSnapshot, this.context, slot.result);
    this.dropJob(slot);
    this.releaseSnapshot(slot);
    slot.state = ANSWERED;
    this.stats.inThread++;
  }

  /** Fills the snapshot of a request: window, tile words, light, search parameters. */
  private snapshot(slot: PathSlot, s: PathSnapshot, tick: number): void {
    const p = BALANCE.ai.path;
    const worldChunks = Math.ceil(this.gridOf().worldTiles / CHUNK_SIZE);
    const r = this.range;
    windowRange(slot.fromTx >> CHUNK_SHIFT, slot.toTx >> CHUNK_SHIFT, p.windowMarginChunks, p.maxWindowChunks, worldChunks, r);
    const cx0 = r[0] as number;
    const cx1 = r[1] as number;
    windowRange(slot.fromTy >> CHUNK_SHIFT, slot.toTy >> CHUNK_SHIFT, p.windowMarginChunks, p.maxWindowChunks, worldChunks, r);
    const cy0 = r[0] as number;
    const cy1 = r[1] as number;
    const g = s.grid;
    g.reset(slot.layer, cx0, cy0, cx1 - cx0 + 1, cy1 - cy0 + 1);
    this.tiles.fill(g, this.chunkAllowed, tick);
    s.light = !Number.isNaN(slot.lightAbove);
    if (s.light) {
      if (this.light === null) throw new Error('PathService: a request avoids light, but no light sampler is set (useLight)');
      const n = g.width * g.height;
      if (this.lightMask.length < n) this.lightMask = new Uint8Array(grow(this.lightMask.length, n));
      this.light.markBright(slot.layer, g.tx0, g.ty0, g.width, g.height, slot.lightAbove, this.lightMask);
      const words = g.words;
      const mask = this.lightMask;
      for (let i = 0; i < n; i++) if (mask[i] === 1) words[i] = (words[i] as number) | PATH_LIGHT;
    }
    s.fromTx = slot.fromTx;
    s.fromTy = slot.fromTy;
    s.toTx = slot.toTx;
    s.toTy = slot.toTy;
    s.profile = pathProfile(slot.mover, slot.opensDoors);
    s.maxNodes = slot.maxNodes;
  }

  private takeSlot(): PathSlot {
    return this.spareSlotCount > 0 ? (this.spareSlots[--this.spareSlotCount] as PathSlot) : new PathSlot();
  }

  private own(ticket: PathTicket): PathSlot {
    const slot = ticket as PathSlot;
    if (!(slot instanceof PathSlot) || slot.state === FREE || !this.isLive(slot)) throw new Error(`PathService: ticket ${String(ticket.id)} is not pending (spent, cancelled or foreign)`);
    return slot;
  }

  private isLive(slot: PathSlot): boolean {
    for (let i = 0; i < this.liveCount; i++) if (this.live[i] === slot) return true;
    return false;
  }

  private addLive(slot: PathSlot): void {
    // Ids only grow, so appending keeps the list ordered.
    if (this.liveCount < this.live.length) this.live[this.liveCount] = slot;
    else this.live.push(slot);
    this.liveCount++;
  }

  private release(slot: PathSlot): void {
    this.dropJob(slot);
    this.releaseSnapshot(slot);
    slot.state = FREE;
    let i = 0;
    while (i < this.liveCount && this.live[i] !== slot) i++;
    if (i < this.liveCount) {
      for (let k = i + 1; k < this.liveCount; k++) this.live[k - 1] = this.live[k] as PathSlot;
      this.liveCount--;
      if (this.spareSlotCount < this.spareSlots.length) this.spareSlots[this.spareSlotCount] = slot;
      else this.spareSlots.push(slot);
      this.spareSlotCount++;
    }
  }

  private releaseSnapshot(slot: PathSlot): void {
    if (slot.snapshot !== null) {
      if (this.spareSnapshotCount < this.spareSnapshots.length) this.spareSnapshots[this.spareSnapshotCount] = slot.snapshot;
      else this.spareSnapshots.push(slot.snapshot);
      this.spareSnapshotCount++;
      slot.snapshot = null;
    }
  }
}

/**
 * Window range along one axis [chunks] into `out` (first, last): the start and goal chunks and up to `margin` chunks
 * around them, at most `max` chunks – the margin gives way first; when start and goal lie farther apart than `max`,
 * the window runs from the start towards the goal. Clipped to the world.
 */
export function windowRange(s: number, g: number, margin: number, max: number, worldChunks: number, out: Int32Array): void {
  let lo: number;
  let hi: number;
  const span = Math.abs(g - s) + 1;
  if (span > max) {
    lo = g >= s ? s : s - max + 1;
    hi = lo + max - 1;
  } else {
    const room = Math.min(margin * 2, max - span);
    lo = Math.min(s, g) - (room >> 1) - (room & 1);
    hi = Math.max(s, g) + (room >> 1);
  }
  lo = Math.max(0, Math.min(lo, worldChunks - 1));
  hi = Math.max(lo, Math.min(hi, worldChunks - 1));
  out[0] = lo;
  out[1] = hi;
}

/** Throws on a malformed request. */
function checkRequest(req: PathRequest): void {
  checkInt(req.owner);
  checkInt(req.fromTx);
  checkInt(req.fromTy);
  checkInt(req.toTx);
  checkInt(req.toTy);
  checkInt(req.maxNodes);
  if (!isLayer(req.layer)) throw new RangeError(`PathService: unbekannte Ebene ${String(req.layer)}`);
  if (!MOVER_CLASSES.includes(req.mover)) throw new RangeError(`PathService: unbekannte Fortbewegung „${String(req.mover)}“`);
  if (req.maxNodes < 1) throw new RangeError(`PathService: maxNodes muss ≥ 1 sein, nicht ${req.maxNodes}`);
  if (req.avoidLightAbove !== null && !Number.isFinite(req.avoidLightAbove)) throw new RangeError('PathService: avoidLightAbove muss endlich oder null sein');
}

function checkInt(v: number): void {
  if (!Number.isSafeInteger(v)) throw new RangeError(`PathService: Anfrage mit ungültigem Wert ${String(v)}`);
}

/** Copies a delivered result (the ticket's result is only valid until the next `request`). */
export function keepPath(from: PathResult, into: PathResult): PathResult {
  copyPathResult(from, into);
  return into;
}
