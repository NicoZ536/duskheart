/**
 * The world of a simulation as the presentation reads it: `null` for a simulation without one (the test worlds of the
 * unit tests build systems on hand-drawn chunks and attach no world; `Simulation.world` throws there). A game simulation
 * (`createSimulation`) always has its world, so the guard costs nothing in the game.
 */
import type { Simulation } from '../game/sim';
import type { SimWorld } from '../game/world';

/** The world of `sim`, or null when none is attached. */
export function worldOf(sim: Simulation): SimWorld | null {
  try {
    return sim.world;
  } catch {
    return null;
  }
}
