/**
 * Builds the complete game simulation with every system in its fixed order. All entry points
 * (browser game, headless runner, save loading, tests) create simulations through this function
 * so they always run the same system list.
 */
import { Simulation, type SimConfigInput } from './sim';
import { MotionSystem } from './systems/motion';

/** A simulation with all game systems registered. */
export function createSimulation(config: SimConfigInput): Simulation {
  const sim = new Simulation(config);
  sim.addSystem(new MotionSystem(sim));
  const missing = sim.unhandledCommandTypes();
  if (missing.length > 0) throw new Error(`createSimulation: commands without handler: ${missing.join(', ')}`);
  return sim;
}
