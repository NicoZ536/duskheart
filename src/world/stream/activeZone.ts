/**
 * Active zone (MASTERPROMPT §3.3, docs/ARCHITEKTUR.md "Aktive Zone", docs/WORLD.md §5, M2-22).
 *
 * Chunks within `activeRadius` (Chebyshev) of the player chunk on the player's layer tick fully;
 * all other chunks and layers are frozen. A chunk leaves the zone only beyond `activeRadius +
 * activeHysteresis`, or when the player changes layer.
 * - Activation: the chunk is made resident synchronously (`ensure`), caught up from its
 *   `frozenAtTick` to the current tick through the catch-up registry (handlers in system order),
 *   and pinned so streaming never unloads it.
 * - Deactivation: the chunk stores the current tick as `frozenAtTick` and is unpinned.
 * - `update` runs inside the simulation tick (as the first system): the current tick is the tick
 *   being simulated, so a chunk activated in tick t is caught up to t and then ticks live.
 * - `chunks` lists the active chunks sorted by packed id: systems iterate them in the same order
 *   in every run, whatever order they were activated in.
 *
 * Save participant `world-chunks`: the `frozenAtTick` of every chunk that was ever active (frozen
 * chunks carry their tick; active chunks are saved as frozen at the current tick) and which chunks
 * were active. After loading, every chunk is frozen; the next `update` activates the zone around
 * the player regularly and, in addition, re-activates the saved active chunks that are still within
 * radius + hysteresis of the player on the player's layer (catch-up from the saved tick, which
 * equals the loaded clock's tick: nothing to do). Without that second part the hysteresis ring
 * would be lost on loading: chunks that stayed active in an uninterrupted run would be frozen at the
 * save tick in the loaded run, and "save → load → continue" would no longer reach the same state
 * (ADR-0024).
 */
import { z } from 'zod';
import type { ChunkData } from '../model/chunk';
import { isLayer, packChunkId, tileToChunk, unpackChunkId, type ChunkCoord, type Layer } from '../model/coords';
import { chunkInWorld, type WorldDimensions } from '../model/worldSize';
import type { CatchUpRegistry } from './catchUp';
import { chunkDistance, resolveStreamConfig, type StreamConfig } from './config';

/** What the zone needs from the chunk store (implemented by `ChunkManager`). */
export interface ZoneChunkSource {
  readonly world: WorldDimensions;
  /** Resident chunk at the address, loaded synchronously if necessary. */
  ensure(layer: Layer, cx: number, cy: number): ChunkData;
  pin(chunk: ChunkData): void;
  unpin(chunk: ChunkData): void;
  /** Every chunk with `frozenAtTick ≠ 0` (resident or not). */
  forEachFrozenTick(fn: (id: number, tick: number) => void): void;
  /** Replaces all `frozenAtTick` values. */
  restoreFrozenTicks(ticks: ReadonlyMap<number, number>): void;
}

/** Options of an `ActiveZone`. */
export interface ActiveZoneOptions {
  readonly chunks: ZoneChunkSource;
  /** Sealed catch-up registry of the simulation's systems. */
  readonly catchUp: CatchUpRegistry;
  /** Current simulation tick (`clock.tick`: inside a step the tick being simulated). */
  readonly tick: () => number;
  /** Active radius and hysteresis (defaults: `STREAM_DEFAULTS`). */
  readonly config?: Partial<StreamConfig>;
}

/** Participant id of the zone (roundtrip test `tests/unit/save/roundtrip/world-chunks.test.ts`). */
export const WORLD_CHUNKS_PARTICIPANT_ID = 'world-chunks';
/** Data format version of the `world-chunks` participant. */
export const WORLD_CHUNKS_SAVE_VERSION = 1;
/** Numbers per frozen entry: layer, cx, cy, tick. */
const FROZEN_STRIDE = 4;
/** Offsets inside a frozen or active entry. */
const ENTRY_CX = 1;
const ENTRY_CY = 2;
const FROZEN_TICK = 3;

/** Numbers per active entry: layer, cx, cy. */
const ACTIVE_STRIDE = 3;

const safeInt = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

/** zod schema of the participant data. */
export const worldChunksSnapshotSchema = z
  .object({
    /** Flat entries `[layer, cx, cy, frozenAtTick, …]`, ascending packed chunk id, ticks ≥ 1. */
    frozen: z.array(safeInt),
    /** Flat entries `[layer, cx, cy, …]` of the chunks active at the save, ascending packed chunk id, all on one layer (absent = none). */
    active: z.array(safeInt).default([]),
  })
  .strict();

/** Saved zone state. */
export type WorldChunksSnapshot = z.output<typeof worldChunksSnapshotSchema>;

/** Save participant of the zone (structurally a `SaveParticipant` of src/save). */
export interface WorldChunksParticipant {
  readonly id: string;
  readonly version: number;
  serialize(): WorldChunksSnapshot;
  deserialize(data: unknown): void;
}

/** Parsed participant data: frozen ticks by packed chunk id and the saved active chunks (ascending ids). */
interface ParsedZone {
  readonly ticks: Map<number, number>;
  readonly active: number[];
}

function parseZone(data: unknown): ParsedZone {
  const parsed = worldChunksSnapshotSchema.safeParse(data);
  if (!parsed.success) throw new TypeError(`world-chunks snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return { ticks: parseFrozen(parsed.data.frozen), active: parseActive(parsed.data.active) };
}

function packEntry(layer: unknown, cx: number, cy: number): number {
  if (!isLayer(layer)) throw new TypeError(`world-chunks snapshot invalid: unknown layer ${String(layer)}`);
  try {
    return packChunkId(layer, cx, cy);
  } catch (err) {
    throw new TypeError(`world-chunks snapshot invalid: ${(err as Error).message}`);
  }
}

function parseActive(flat: readonly number[]): number[] {
  if (flat.length % ACTIVE_STRIDE !== 0) throw new TypeError('world-chunks snapshot invalid: active must hold [layer, cx, cy] entries');
  const ids: number[] = [];
  const layer = flat[0];
  for (let k = 0; k < flat.length; k += ACTIVE_STRIDE) {
    if (flat[k] !== layer) throw new TypeError('world-chunks snapshot invalid: active chunks must lie on one layer');
    const id = packEntry(flat[k], flat[k + ENTRY_CX] as number, flat[k + ENTRY_CY] as number);
    if (ids.length > 0 && id <= (ids[ids.length - 1] as number)) throw new TypeError('world-chunks snapshot invalid: active entries must be unique and sorted by chunk id');
    ids.push(id);
  }
  return ids;
}

function parseFrozen(flat: readonly number[]): Map<number, number> {
  if (flat.length % FROZEN_STRIDE !== 0) throw new TypeError('world-chunks snapshot invalid: frozen must hold [layer, cx, cy, tick] entries');
  const ticks = new Map<number, number>();
  let previous = -1;
  for (let k = 0; k < flat.length; k += FROZEN_STRIDE) {
    const tick = flat[k + FROZEN_TICK] as number;
    if (!isLayer(flat[k])) throw new TypeError(`world-chunks snapshot invalid: unknown layer ${String(flat[k])}`);
    if (tick < 1) throw new TypeError(`world-chunks snapshot invalid: frozenAtTick must be ≥ 1, got ${tick}`);
    const id = packEntry(flat[k], flat[k + ENTRY_CX] as number, flat[k + ENTRY_CY] as number);
    if (id <= previous) throw new TypeError('world-chunks snapshot invalid: entries must be unique and sorted by chunk id');
    previous = id;
    ticks.set(id, tick);
  }
  return ticks;
}

/** The set of fully ticking chunks around the player. */
export class ActiveZone {
  readonly save: WorldChunksParticipant;
  readonly radius: number;
  readonly hysteresis: number;
  private readonly source: ZoneChunkSource;
  private readonly catchUp: CatchUpRegistry;
  private readonly tick: () => number;
  private centerLayer: Layer | null = null;
  private centerCx = 0;
  private centerCy = 0;
  /** Packed ids of the active chunks, ascending; `list` is parallel. */
  private readonly ids: number[] = [];
  private readonly list: ChunkData[] = [];
  /** Chunks that were active when the loaded save was written (ascending ids), until the first `update`. */
  private pending: number[] = [];
  private readonly coord: ChunkCoord = { layer: 0, cx: 0, cy: 0 };

  constructor(options: ActiveZoneOptions) {
    const config = resolveStreamConfig(options.config);
    if (!options.catchUp.sealed) throw new Error('ActiveZone: the catch-up registry must be sealed against the system list');
    this.source = options.chunks;
    this.catchUp = options.catchUp;
    this.tick = options.tick;
    this.radius = config.activeRadius;
    this.hysteresis = config.activeHysteresis;
    this.save = {
      id: WORLD_CHUNKS_PARTICIPANT_ID,
      version: WORLD_CHUNKS_SAVE_VERSION,
      serialize: () => this.serializeFrozen(),
      deserialize: (data: unknown) => {
        const parsed = parseZone(data);
        for (const id of parsed.active) {
          unpackChunkId(id, this.coord);
          if (!chunkInWorld(this.source.world, this.coord.cx, this.coord.cy)) throw new TypeError(`world-chunks snapshot invalid: active chunk ${this.coord.layer}:${this.coord.cx}:${this.coord.cy} lies outside the world`);
        }
        this.release();
        this.source.restoreFrozenTicks(parsed.ticks);
        this.pending = parsed.active;
      },
    };
  }

  /** Active chunks sorted by packed id (stable iteration order for systems). */
  get chunks(): readonly ChunkData[] {
    return this.list;
  }

  /** Number of active chunks. */
  get size(): number {
    return this.list.length;
  }

  /** Chunks that were active in the loaded save and wait for the first `update` (0 otherwise). */
  get resuming(): number {
    return this.pending.length;
  }

  /** Layer of the zone, or `null` before the first update / after `freezeAll`. */
  get layer(): Layer | null {
    return this.centerLayer;
  }

  /** Whether a chunk is active. */
  isActive(layer: Layer, cx: number, cy: number): boolean {
    if (layer !== this.centerLayer) return false;
    return this.indexOf(packChunkId(layer, cx, cy)) >= 0;
  }

  /** Whether the chunk containing a world tile is active (entities there tick). */
  isTileActive(layer: Layer, tx: number, ty: number): boolean {
    return this.isActive(layer, tileToChunk(tx), tileToChunk(ty));
  }

  /**
   * Moves the zone to the player chunk (inside the tick): freezes chunks beyond radius +
   * hysteresis or on another layer, activates and catches up the chunks within the radius (after
   * loading also the saved active chunks still within radius + hysteresis, see module comment).
   * Returns the number of chunks that changed state (0 without allocation when nothing moved).
   */
  update(layer: Layer, cx: number, cy: number): number {
    if (this.pending.length === 0 && layer === this.centerLayer && cx === this.centerCx && cy === this.centerCy) return 0;
    const t = this.tick();
    let changes = 0;
    const keep = this.radius + this.hysteresis;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i] as ChunkData;
      if (c.layer !== layer || chunkDistance(c.cx, c.cy, cx, cy) > keep) {
        this.deactivateAt(i, t);
        changes++;
      }
    }
    if (this.pending.length > 0) changes += this.resume(t, layer, cx, cy, keep);
    const r = this.radius;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!chunkInWorld(this.source.world, x, y)) continue;
        if (this.activate(layer, x, y, t)) changes++;
      }
    }
    this.centerLayer = layer;
    this.centerCx = cx;
    this.centerCy = cy;
    return changes;
  }

  /** Freezes every active chunk at the current tick (e.g. before a layer-wide operation or teleport). */
  freezeAll(): void {
    const t = this.tick();
    // Chunks still waiting since loading were active until now: catch them up before freezing them.
    if (this.pending.length > 0) this.resume(t, null, 0, 0, 0);
    for (let i = this.list.length - 1; i >= 0; i--) this.deactivateAt(i, t);
    this.centerLayer = null;
  }

  /**
   * Activates the saved active chunks on `layer` within `keep` of (cx, cy) (`layer` null: all of
   * them) and forgets the rest, which stay frozen at their saved tick. Returns the activations.
   */
  private resume(t: number, layer: Layer | null, cx: number, cy: number, keep: number): number {
    const pending = this.pending;
    this.pending = [];
    const c = this.coord;
    let n = 0;
    for (const id of pending) {
      unpackChunkId(id, c);
      if (layer !== null && (c.layer !== layer || chunkDistance(c.cx, c.cy, cx, cy) > keep)) continue;
      if (this.activate(c.layer, c.cx, c.cy, t)) n++;
    }
    return n;
  }

  /** Activates one chunk (resident, caught up to `t`, pinned) unless it is active. Returns whether it was activated. */
  private activate(layer: Layer, cx: number, cy: number, t: number): boolean {
    const id = packChunkId(layer, cx, cy);
    const at = this.indexOf(id);
    if (at >= 0) return false;
    const chunk = this.source.ensure(layer, cx, cy);
    this.catchUp.run(chunk, chunk.frozenAtTick, t);
    chunk.frozenAtTick = t;
    this.source.pin(chunk);
    const insertAt = -at - 1;
    this.ids.splice(insertAt, 0, id);
    this.list.splice(insertAt, 0, chunk);
    return true;
  }

  /** Binary search: index of `id`, or `-(insertion point) - 1`. */
  private indexOf(id: number): number {
    let lo = 0;
    let hi = this.ids.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const v = this.ids[mid] as number;
      if (v < id) lo = mid + 1;
      else if (v > id) hi = mid - 1;
      else return mid;
    }
    return -lo - 1;
  }

  private deactivateAt(i: number, t: number): void {
    const chunk = this.list[i] as ChunkData;
    chunk.frozenAtTick = t;
    this.source.unpin(chunk);
    this.ids.splice(i, 1);
    this.list.splice(i, 1);
  }

  /** Forgets the active set without touching ticks (the loaded ticks replace them). */
  private release(): void {
    for (const chunk of this.list) this.source.unpin(chunk);
    this.ids.length = 0;
    this.list.length = 0;
    this.centerLayer = null;
  }

  private serializeFrozen(): WorldChunksSnapshot {
    const t = this.tick();
    const ticks = new Map<number, number>();
    this.source.forEachFrozenTick((id, tick) => ticks.set(id, tick));
    for (const id of this.ids) ticks.set(id, t);
    const coord: ChunkCoord = { layer: 0, cx: 0, cy: 0 };
    const frozen: number[] = [];
    for (const id of [...ticks.keys()].sort((a, b) => a - b)) {
      const tick = ticks.get(id) as number;
      if (tick === 0) continue;
      unpackChunkId(id, coord);
      frozen.push(coord.layer, coord.cx, coord.cy, tick);
    }
    const active: number[] = [];
    for (const id of [...new Set([...this.ids, ...this.pending])].sort((a, b) => a - b)) {
      unpackChunkId(id, coord);
      active.push(coord.layer, coord.cx, coord.cy);
    }
    return { frozen, active };
  }
}
