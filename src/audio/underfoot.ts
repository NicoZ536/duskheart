/**
 * The built floor under the player's feet (§16.1 "Boden", §27 "Schritte je Untergrund"; M4-29): a footstep on planks,
 * flagstones or rammed clay sounds like the floor, not like the ground beneath it (`playerStep` names only the
 * terrain). Read from the build grid at the listener – the player – like the renderer reads it; blueprints are plans
 * without material and step like the ground. Stairs (build layer `struktur`) creak like their material.
 */
import type { BuildMaterial } from '../content/balance/building';
import { BuildingSystem } from '../game/building/system';
import type { Simulation } from '../game/sim';
import { BUILD_LAYER_INDEX, cellBlueprint } from '../world/structures/cells';
import { TILE_PX, type Layer } from '../world/model/coords';
import { FLOOR_STEP } from './baseSounds';

/** Finds the floor under a position (the building system is looked up once per simulation). */
export class FloorProbe {
  private sim: Simulation | null = null;
  private building: BuildingSystem | null = null;

  /** The material of the finished floor (or stairs) on the tile under (x, y) of `layer`, or null. */
  materialAt(sim: Simulation, layer: Layer, x: number, y: number): BuildMaterial | null {
    if (this.sim !== sim) {
      this.sim = sim;
      this.building = null;
      for (const s of sim.systems) if (s instanceof BuildingSystem) this.building = s;
    }
    const b = this.building;
    if (b === null) return null;
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor(y / TILE_PX);
    const floor = b.partAt(layer, 'boden', tx, ty);
    if (floor !== undefined && !cellBlueprint(b.structures.cell(layer, BUILD_LAYER_INDEX.boden, tx, ty))) return floor.material;
    const stairs = b.partAt(layer, 'struktur', tx, ty);
    if (stairs?.kind === 'treppe' && !cellBlueprint(b.structures.cell(layer, BUILD_LAYER_INDEX.struktur, tx, ty))) return stairs.material;
    return null;
  }

  /** The footstep sound of the floor under (x, y) of `layer`, or null (the ground's own step). */
  stepAt(sim: Simulation, layer: Layer, x: number, y: number): string | null {
    const m = this.materialAt(sim, layer, x, y);
    return m === null ? null : FLOOR_STEP[m];
  }
}
