/**
 * `RenderScene.surface` (docs/RENDER.md §4 "Welt-Oberfläche"): what the world surface of a frame looks like – the
 * wind as a vector, the ground's wetness and puddles, the snow cover, the seasonal foliage blend, the figures that
 * push the grass aside and the footprints in the snow. Filled per frame by the game view (`world/surfaceScene.ts`);
 * scenes that do not fill it keep the neutral surface (dry, no snow) and sway with `env.wind` as before.
 *
 * No allocation per frame: the lists are typed arrays of a fixed capacity.
 */
import { SURFACE_PARAMS } from './params';

/** Fields of one bender (a figure pressing the grass): x, y [world px], radius [px], strength 0…1. */
export const BENDER_FIELDS = 4;
/** Fields of one footprint: x, y [world px], strength 0…1 (fades), side (−1 left, +1 right) × facing code. */
export const FOOTPRINT_FIELDS = 4;

export class SurfaceState {
  /**
   * Whether a weather source filled the wind this frame; otherwise the sprites sway with the signed
   * `env.wind` along x (the M1 scenes and debug scenes set only that).
   */
  weatherDriven = false;
  /** Wind vector (sway scale; +x east, +y south – the direction it blows towards) and gust strength 0…1. */
  windX = 0;
  windY = 0;
  gust = 0;
  /** Wetness of the ground 0…1 (rain soaks it, it dries slowly). */
  wetness = 0;
  /** Fill of the puddles 0…1 (they gather in hollows once the ground is wet). */
  puddles = 0;
  /** Snow cover 0…1 on up-facing surfaces (ground, roofs, crowns, rock tops). */
  snow = 0;
  /** Whether it is snowing now (fresh snow fills footprints). */
  snowing = false;
  /** Foliage blend of the seasons (`SEASON_IDS` indices): from → to with progress 0…1; `to` = −1 outside a change. */
  seasonFrom = 0;
  seasonTo = -1;
  seasonProgress = 0;
  /** How far the see-through circle around the player is open 0…1 (it irises open under a crown or roof). */
  canopyOpen = 1;
  /** Figures pushing the grass: `BENDER_FIELDS` floats each. */
  readonly benders = new Float32Array(SURFACE_PARAMS.grass.maxBenders * BENDER_FIELDS);
  benderCount = 0;
  /** Footprints to stamp this frame: `FOOTPRINT_FIELDS` floats each. */
  readonly footprints = new Float32Array(SURFACE_PARAMS.footprints.capacity * FOOTPRINT_FIELDS);
  footprintCount = 0;

  /** A new frame: nothing pushes the grass or stamps prints until a filler says so; the weather is neutral again. */
  beginFrame(): void {
    this.weatherDriven = false;
    this.windX = 0;
    this.windY = 0;
    this.gust = 0;
    this.wetness = 0;
    this.puddles = 0;
    this.snow = 0;
    this.snowing = false;
    this.seasonTo = -1;
    this.seasonProgress = 0;
    this.canopyOpen = 1;
    this.benderCount = 0;
    this.footprintCount = 0;
  }

  /** Adds a figure that pushes the grass (ignored beyond the capacity). */
  addBender(x: number, y: number, radius: number, strength: number): void {
    const max = this.benders.length / BENDER_FIELDS;
    if (this.benderCount >= max) return;
    const o = this.benderCount++ * BENDER_FIELDS;
    const b = this.benders;
    b[o] = x;
    b[o + 1] = y;
    b[o + 2] = radius;
    b[o + 3] = strength;
  }

  /** Adds a footprint to stamp (ignored beyond the capacity). */
  addFootprint(x: number, y: number, strength: number, side: number): void {
    const max = this.footprints.length / FOOTPRINT_FIELDS;
    if (this.footprintCount >= max) return;
    const o = this.footprintCount++ * FOOTPRINT_FIELDS;
    const f = this.footprints;
    f[o] = x;
    f[o + 1] = y;
    f[o + 2] = strength;
    f[o + 3] = side;
  }
}
