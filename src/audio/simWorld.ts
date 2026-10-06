/**
 * The world of a simulation as the presentation reads it: `null` for a simulation without one (the test worlds of the
 * unit tests build systems on hand-drawn chunks and attach no world; `Simulation.world` throws there). A simulation gets
 * its world when it is created (`createSimulation`) or never, so the answer is kept per simulation: asked every frame, a
 * world-less simulation would otherwise build and throw an error each time (1 KB per frame).
 */
import type { Simulation } from '../game/sim';
import type { SimWorld } from '../game/world';

const known = new WeakMap<Simulation, SimWorld | null>();

/** The world of `sim`, or null when none is attached. */
export function worldOf(sim: Simulation): SimWorld | null {
  const cached = known.get(sim);
  if (cached !== undefined) return cached;
  let world: SimWorld | null;
  try {
    world = sim.world;
  } catch {
    world = null;
  }
  known.set(sim, world);
  return world;
}
