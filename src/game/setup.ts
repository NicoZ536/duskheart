/**
 * Builds the complete game simulation with every system in its fixed order. All entry points
 * (browser game, headless runner, save loading, tests) create simulations through this function
 * so they always run the same system list.
 *
 * Order (docs/ARCHITEKTUR.md "Simulation"): `world-chunks` first (the active zone decides which
 * chunks tick in this tick), then `motion`, `calendar`, `weather-regions`, `temperature` (the field
 * samples the weather of the same world tick). After the list is complete the catch-up registry is
 * sealed against it: a time-dependent system that neither catches chunks up nor declares itself
 * global makes `createSimulation` throw (`CatchUpCoverageError`, docs/WORLD.md §5).
 */
import { CatchUpRegistry } from '../world/stream/catchUp';
import { pxToTile } from '../world/model/coords';
import { worldDimensions } from '../world/model/worldSize';
import { Simulation, type SimConfigInput } from './sim';
import { MotionSystem } from './systems/motion';
import { SimWorld, TemperatureSystem, WeatherRegionsSystem, WorldChunksSystem, type SimWorldOptions, type WorldFocus } from './world';

/** Options of `createSimulation`: how the simulation gets its world. */
export type SimulationOptions = SimWorldOptions;

/** Clamps a tile coordinate into the world edge [0, tiles − 1]. */
function clampTile(t: number, tiles: number): number {
  return t < 0 ? 0 : t >= tiles ? tiles - 1 : t;
}

/** A simulation with all game systems registered and its world attached (materialised on demand). */
export function createSimulation(config: SimConfigInput, options: SimulationOptions = {}): Simulation {
  const sim = new Simulation(config);
  const world = new SimWorld(sim, options);
  sim.addSystem(new WorldChunksSystem(world));
  const motion = sim.addSystem(new MotionSystem(sim));
  sim.addSystem(world.calendar);
  sim.addSystem(new WeatherRegionsSystem(world));
  sim.addSystem(new TemperatureSystem(world));
  const missing = sim.unhandledCommandTypes();
  if (missing.length > 0) throw new Error(`createSimulation: commands without handler: ${missing.join(', ')}`);
  world.seal(CatchUpRegistry.fromSystems(sim.systems));
  // Focus of the active zone: the controlled entity on its layer (the player entity follows in M3-08).
  const tiles = worldDimensions(sim.config.worldSize).tiles;
  const px = { x: 0, y: 0 };
  world.setFocus((out: WorldFocus) => {
    if (!motion.controlledPosition(sim, px)) return false;
    out.layer = motion.controlledLayer;
    out.tx = clampTile(pxToTile(px.x), tiles);
    out.ty = clampTile(pxToTile(px.y), tiles);
    return true;
  });
  sim.attachWorld(world);
  return sim;
}
