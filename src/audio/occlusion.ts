/**
 * How much of a positioned sound walls and roofs swallow (M7-01; MASTERPROMPT §27 "Tiefpass bei Verdeckung"): the
 * occlusion 0 (open) … 1 (closed) that src/audio/spatial.ts turns into a low-pass and a lower level.
 *
 * - **Walls:** a tile ray from the listener's tile to the sound's tile (the integer grid walk of the light occlusion,
 *   src/world/lightmap/occlusion.ts) counts the tiles strictly between that stop light – rock, built walls and closed
 *   doors, a cliff face above the listener's level (`blocksLight` over the collision grid's packed infos, built walls
 *   included through its overlays). Each adds `WALL_OCCLUSION`. An open door, a window, trees and bushes let sound pass.
 * - **Roofs:** listener and sound on different sides of a finished roof (`BuildingSystem.roofed`) add `ROOF_OCCLUSION` –
 *   the rain on the roof heard from inside, the fire in the house heard from the yard.
 * - Beyond `MAX_RAY_TILES` the walls are not walked (such sounds are faint anyway); only the roof counts.
 *
 * Read-only on the simulation (the collision grid's query cache is the grid's own, as for the build preview); no
 * allocation per call. Before the world's collision grid exists (title, loading) nothing is occluded.
 */
import { BuildingSystem } from '../game/building/system';
import { WorldCollision } from '../game/player/collision';
import type { Simulation } from '../game/sim';
import { infoLevel, type CollisionGrid } from '../world/collision/tiles';
import { blocksLight } from '../world/lightmap/occlusion';
import { TILE_PX, type Layer } from '../world/model/coords';

/** Occlusion added by each blocking tile between listener and sound. */
export const WALL_OCCLUSION = 0.45;
/** Occlusion of a roof between them (one under it, the other not). */
export const ROOF_OCCLUSION = 0.35;
/** Longest ray walked [tiles per axis]. */
export const MAX_RAY_TILES = 40;

/** The listener as the occlusion reads it. */
export interface OcclusionListener {
  readonly x: number;
  readonly y: number;
  readonly layer: number;
}

/** Occlusion of positioned sounds for one listener (see module comment). */
export class SoundOcclusion {
  private sim: Simulation | null = null;
  private collision: WorldCollision | null = null;
  private building: BuildingSystem | null = null;
  private ready = false;
  private ltx = 0;
  private lty = 0;
  private layer: Layer = 0;
  private level = 0;
  private roofed = false;

  /** Places the listener (once per frame, and when it moved before an event). */
  begin(sim: Simulation | undefined, listener: OcclusionListener): void {
    this.ready = false;
    if (sim === undefined) return;
    if (this.sim !== sim) {
      this.sim = sim;
      this.collision = null;
      this.building = null;
      for (const s of sim.systems) {
        if (s instanceof WorldCollision) this.collision = s;
        else if (s instanceof BuildingSystem) this.building = s;
      }
    }
    const collision = this.collision;
    if (collision === null || !collision.built) return;
    this.ltx = Math.floor(listener.x / TILE_PX);
    this.lty = Math.floor(listener.y / TILE_PX);
    this.layer = listener.layer as Layer;
    const grid = collision.grid;
    grid.beginQuery();
    this.level = infoLevel(grid.info(this.layer, this.ltx, this.lty));
    this.roofed = this.building?.roofed(this.layer, this.ltx, this.lty) ?? false;
    this.ready = true;
  }

  /** Occlusion 0 … 1 of a sound at (x, y) [px] on `layer` (another layer: 0, it is not heard anyway). */
  at(x: number, y: number, layer: number): number {
    if (!this.ready || layer !== this.layer) return 0;
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor(y / TILE_PX);
    let occlusion = 0;
    const roofed = this.building?.roofed(this.layer, tx, ty) ?? false;
    if (roofed !== this.roofed) occlusion += ROOF_OCCLUSION;
    const dx = tx - this.ltx;
    const dy = ty - this.lty;
    if (dx > MAX_RAY_TILES || dx < -MAX_RAY_TILES || dy > MAX_RAY_TILES || dy < -MAX_RAY_TILES) return Math.min(1, occlusion);
    const grid = (this.collision as WorldCollision).grid;
    grid.beginQuery();
    const walls = this.wallsBetween(grid, dx, dy, Math.ceil((1 - occlusion) / WALL_OCCLUSION));
    return Math.min(1, occlusion + walls * WALL_OCCLUSION);
  }

  /** Blocking tiles strictly between the listener and (listener + dx, dy), counting up to `limit`. */
  private wallsBetween(grid: CollisionGrid, dx: number, dy: number, limit: number): number {
    const nx = dx < 0 ? -dx : dx;
    const ny = dy < 0 ? -dy : dy;
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    let x = 0;
    let y = 0;
    let ix = 0;
    let iy = 0;
    let walls = 0;
    while (ix < nx || iy < ny) {
      // Where the segment leaves the current tile: (0,5 + ix) / nx against (0,5 + iy) / ny (integer form).
      const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
      if (decision === 0) {
        x += sx;
        y += sy;
        ix++;
        iy++;
      } else if (decision < 0) {
        x += sx;
        ix++;
      } else {
        y += sy;
        iy++;
      }
      if (x === dx && y === dy) break;
      if (blocksLight(grid.info(this.layer, this.ltx + x, this.lty + y), this.level)) {
        walls++;
        if (walls >= limit) break;
      }
    }
    return walls;
  }
}
