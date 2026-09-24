/**
 * What the world tells the light system (MASTERPROMPT §12.1, §10): the rain over a tile (torches burn
 * faster and may go out), the ambient light of a tile (the light map's base: calendar and weather) and
 * whether a chunk is in the active zone (its lights tick; frozen ones catch up). Tests hand in their own.
 */
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import { createWeatherSample } from '../../world/climate/weather';
import { ambientLevel, surfaceAmbient } from '../../world/lightmap/ambient';
import type { Layer } from '../../world/model/coords';
import type { Simulation } from '../sim';

/** The surroundings of lights. */
export interface LightEnvironment {
  /** Falling rain over tile (tx, ty) of `layer` [precipitation 0–1]: 0 underground, in snow or ash, when dry. */
  rain(sim: Simulation, layer: Layer, tx: number, ty: number): number;
  /** Ambient light of the tile [light level] (§12.1). */
  ambient(sim: Simulation, layer: Layer, tx: number, ty: number): number;
  /** Whether chunk (cx, cy) of `layer` is in the active zone: its lights burn tick by tick, the others catch up. */
  active(sim: Simulation, layer: Layer, cx: number, cy: number): boolean;
}

/** The environment of the simulation's own world: weather regions, calendar, active zone. */
export function worldLightEnvironment(): LightEnvironment {
  const sample = createWeatherSample();
  return {
    rain: (sim, layer, tx, ty) => {
      if (layer !== 0) return 0;
      const region = sim.world.regionAt(tx, ty);
      if (region === NO_WEATHER_REGION) return 0;
      const w = sim.world.weather.sample(region, sample);
      return w.precipitationKind === 'regen' ? w.precipitation : 0;
    },
    ambient: (sim, layer, tx, ty) => {
      const cal = sim.world.calendar;
      if (layer !== 0) return ambientLevel(layer, cal.daylight, cal.moonPhase, 1);
      const region = sim.world.regionAt(tx, ty);
      const factor = region === NO_WEATHER_REGION ? 1 : sim.world.weather.sample(region, sample).lightFactor;
      return surfaceAmbient(cal.daylight, cal.moonPhase, factor);
    },
    active: (sim, layer, cx, cy) => sim.world.materialized && sim.world.zone.isActive(layer, cx, cy),
  };
}
