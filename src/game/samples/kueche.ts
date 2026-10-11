/**
 * Samples of the kitchen for the presentation (docs/SPIEL.md §21; M7-26 … M7-30, strand E): read-only views into the meals,
 * spoilage and water systems, found once and kept – the stomach's boredom counter of a dish (the item tooltip's "Überdruss"),
 * the hour spoilage has reached, and the rain collector on a tile (the debug overlay, the interaction hint). Nothing allocates.
 */
import { MealsSystem } from '../meals/system';
import { SpoilageSystem } from '../spoilage/system';
import { WaterSystem, type RainCollector } from '../water/system';
import type { Simulation } from '../sim';

/** Finds the kitchen's systems of a simulation once. */
export class KuecheSampler {
  private meals: MealsSystem | null | undefined = undefined;
  private spoilage: SpoilageSystem | null | undefined = undefined;
  private water: WaterSystem | null | undefined = undefined;

  private mealsOf(sim: Simulation): MealsSystem | null {
    if (this.meals === undefined) {
      const s = sim.systems.find((x) => x instanceof MealsSystem);
      this.meals = s instanceof MealsSystem ? s : null;
    }
    return this.meals;
  }

  private spoilageOf(sim: Simulation): SpoilageSystem | null {
    if (this.spoilage === undefined) {
      const s = sim.systems.find((x) => x instanceof SpoilageSystem);
      this.spoilage = s instanceof SpoilageSystem ? s : null;
    }
    return this.spoilage;
  }

  private waterOf(sim: Simulation): WaterSystem | null {
    if (this.water === undefined) {
      const s = sim.systems.find((x) => x instanceof WaterSystem);
      this.water = s instanceof WaterSystem ? s : null;
    }
    return this.water;
  }

  /** The boredom counter of dish `item` [pieces] (0 without the meals system). */
  boredom(sim: Simulation, item: string): number {
    return this.mealsOf(sim)?.boredom(item) ?? 0;
  }

  /** The game hour spoilage has reached (−1 before the first tick or without the system). */
  spoilHour(sim: Simulation): number {
    return this.spoilageOf(sim)?.stamp ?? -1;
  }

  /** The rain collector on tile (tx, ty) of `layer`, or undefined. */
  collector(sim: Simulation, layer: number, tx: number, ty: number): Readonly<RainCollector> | undefined {
    return this.waterOf(sim)?.collectorAt(layer, tx, ty);
  }
}
