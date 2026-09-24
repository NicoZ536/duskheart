/**
 * What the world tells the vitals system about the player's surroundings (§11.1 rain, §11.2 ambient
 * temperature): the air temperature of the world's temperature field (§9.3, WORLD.md §6) and the rain of
 * the weather region over the tile, relative to the reference rain of §11.1 ("Regen +2 %/s"). Tests hand
 * in their own environment.
 */
import { BALANCE } from '../../content/balance';
import { WEATHER_STATES } from '../../content/weather';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import { createWeatherSample } from '../../world/climate/weather';
import type { Layer } from '../../world/model/coords';
import type { Simulation } from '../sim';

/** Surroundings of a tile as the vitals system needs them. */
export interface SurvivalEnvironment {
  /** Air temperature at tile (tx, ty) of `layer` [°C]. */
  ambientC(sim: Simulation, layer: Layer, tx: number, ty: number): number;
  /** Rain on the tile relative to the reference rain (0 = dry, 1 = the §11.1 rain, more in a thunderstorm). */
  rain(sim: Simulation, layer: Layer, tx: number, ty: number): number;
}

/** Precipitation of the reference rain state (`BALANCE.survival.wetness.rainReference`). */
function referencePrecipitation(): number {
  const id = BALANCE.survival.wetness.rainReference;
  const state = WEATHER_STATES.find((s) => s.id === id);
  if (state === undefined || state.precipitationKind !== 'regen' || !(state.precipitation > 0)) {
    throw new Error(`Survival: the reference rain "${id}" must be a weather state with rain`);
  }
  return state.precipitation;
}

/** The environment of the simulation's own world: temperature field and weather regions (surface only rains). */
export function worldSurvivalEnvironment(): SurvivalEnvironment {
  const sample = createWeatherSample();
  const reference = referencePrecipitation();
  return {
    ambientC: (sim, layer, tx, ty) => sim.world.temperature.temperatureAt(layer, tx, ty),
    rain: (sim, layer, tx, ty) => {
      if (layer !== 0) return 0;
      const region = sim.world.regionAt(tx, ty);
      if (region === NO_WEATHER_REGION) return 0;
      const w = sim.world.weather.sample(region, sample);
      return w.precipitationKind === 'regen' ? w.precipitation / reference : 0;
    },
  };
}
