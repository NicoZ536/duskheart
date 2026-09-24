/**
 * The world's collision grid inside the simulation (docs/DECISIONS.md ADR-0022 "Das künftige
 * Kollisionssystem"): one memoised `CollisionGrid` over the simulation's chunk store with the tick as
 * residency epoch, shared by every system that moves bodies through the tile grid (the player now,
 * creatures and projectiles later).
 *
 * The grid keeps derived tile infos per chunk instance between ticks. A system that edits a collision
 * relevant chunk field (`ground`, `height`, `water`, `solid`, `object`, `flags` – felling, mining,
 * digging, building, freezing) reports the tile with `invalidateTile` (or the chunk with
 * `invalidateChunk`); reloaded chunks are detected by the grid itself. Other caches over the same tile
 * fields (the occlusion masks of the gameplay light map) register with `addChangeListener` and hear every
 * such report, so an editing system reports once. The system has no state of its own (the grid is a
 * cache of the chunks) and no tick hooks; it is registered so other systems find it
 * (`sim.system(WORLD_COLLISION_SYSTEM_ID)`).
 */
import { CollisionGrid } from '../../world/collision/tiles';
import type { ChunkSource } from '../../world/collision/chunkSource';
import { CHUNK_SHIFT, type Layer } from '../../world/model/coords';
import { worldDimensions } from '../../world/model/worldSize';
import type { SimSystem, Simulation } from '../sim';

/** Id of the collision system. */
export const WORLD_COLLISION_SYSTEM_ID = 'world-collision';

/** A different tile source (tests: hand-drawn chunks); default: the simulation's chunk store. */
export interface WorldCollisionOptions {
  readonly chunks: ChunkSource;
  /** World edge length [tiles]. */
  readonly worldTiles: number;
}

/** A cache over the tile fields that hears the same change reports as the collision grid. */
export interface TileChangeListener {
  invalidateTile(layer: Layer, tx: number, ty: number): void;
  invalidateChunk(layer: Layer, cx: number, cy: number): void;
}

export class WorldCollision implements SimSystem {
  readonly id = WORLD_COLLISION_SYSTEM_ID;
  private gridValue: CollisionGrid | null = null;
  private sourceValue: ChunkSource | null = null;
  private readonly listeners: TileChangeListener[] = [];

  constructor(
    private readonly sim: Simulation,
    private readonly options: WorldCollisionOptions | null = null,
  ) {}

  /** Whether the grid exists (it is built on first use; the world must be there then). */
  get built(): boolean {
    return this.gridValue !== null;
  }

  /** The chunks the grid reads (the simulation's chunk store, materialised on first use). */
  get chunks(): ChunkSource {
    this.sourceValue ??= this.options?.chunks ?? this.sim.world.chunks;
    return this.sourceValue;
  }

  /** The memoised collision grid of the world. */
  get grid(): CollisionGrid {
    if (this.gridValue === null) {
      const clock = this.sim.clock;
      this.gridValue = new CollisionGrid({
        chunks: this.chunks,
        worldTiles: this.options?.worldTiles ?? worldDimensions(this.sim.config.worldSize).tiles,
        epoch: () => clock.tick,
        memo: true,
      });
    }
    return this.gridValue;
  }

  /** World edge length [tiles]. */
  get worldTiles(): number {
    return this.options?.worldTiles ?? worldDimensions(this.sim.config.worldSize).tiles;
  }

  /**
   * Makes the chunks under the tile rectangle [tx0, tx1] × [ty0, ty1] resident now (the simulation's
   * chunk store generates missing ones in this thread; a hand-drawn source has all its chunks).
   * Tiles outside the world are skipped.
   */
  ensureTiles(layer: Layer, tx0: number, ty0: number, tx1: number, ty1: number): void {
    if (this.options !== null) return;
    const last = this.worldTiles - 1;
    const cx0 = Math.max(0, tx0) >> CHUNK_SHIFT;
    const cy0 = Math.max(0, ty0) >> CHUNK_SHIFT;
    const cx1 = Math.min(last, tx1) >> CHUNK_SHIFT;
    const cy1 = Math.min(last, ty1) >> CHUNK_SHIFT;
    const chunks = this.sim.world.chunks;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) chunks.ensure(layer, cx, cy);
  }

  /** Adds a cache that hears every tile and chunk change report (the light map's occlusion). */
  addChangeListener(listener: TileChangeListener): void {
    this.listeners.push(listener);
  }

  /** Reports a changed collision-relevant field of a tile (the grid: no-op before it exists) to the grid and every listener. */
  invalidateTile(layer: Layer, tx: number, ty: number): void {
    this.gridValue?.invalidateTile(layer, tx, ty);
    for (let i = 0; i < this.listeners.length; i++) (this.listeners[i] as TileChangeListener).invalidateTile(layer, tx, ty);
  }

  /** Reports changes anywhere in a chunk to the grid and every listener. */
  invalidateChunk(layer: Layer, cx: number, cy: number): void {
    this.gridValue?.invalidateChunk(layer, cx, cy);
    for (let i = 0; i < this.listeners.length; i++) (this.listeners[i] as TileChangeListener).invalidateChunk(layer, cx, cy);
  }
}
