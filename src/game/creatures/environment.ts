/**
 * What the creature system reads of the world (docs/SPIEL.md §11): the time of day and season at any tick (sleep, spawn
 * tables, catch-up), the Finstermond, the weather over a tile (sight, hearing) and the biome of a tile (spawn tables,
 * loot tier). `worldCreatureEnvironment()` reads the simulation's world (calendar, weather regions, chunks); tests draw
 * their own.
 */
import type { Layer } from '../../world/model/coords';
import { CHUNK_MASK, CHUNK_SHIFT } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import { createWeatherSample } from '../../world/climate/weather';
import type { DayPhase, Season } from '../../world/calendar';
import type { Simulation } from '../sim';
import { clockAt, phaseAt, type ClockAt } from './formulas';

/** Time of day of a tick. */
export interface CreatureTime {
  phase: DayPhase;
  season: Season;
}

/** Weather over a tile. */
export interface CreatureWeather {
  /** Haze 0 … 1 (fog, driving snow). */
  haze: number;
  /** Precipitation 0 … 1. */
  precipitation: number;
}

/** The world as the creature system reads it. */
export interface CreatureEnvironment {
  /** Day phase and season at tick `tick` (the current one or one in the past, for catch-up). */
  timeAt(sim: Simulation, tick: number, out: CreatureTime): CreatureTime;
  /** Whether this night is the Finstermond (§10). */
  finstermond(sim: Simulation): boolean;
  /** Weather over tile (tx, ty) of `layer` (nothing underground). */
  weather(sim: Simulation, layer: Layer, tx: number, ty: number, out: CreatureWeather): CreatureWeather;
  /** Biome of tile (tx, ty) of `layer`, or `null` when unknown (no resident chunk). */
  biome(sim: Simulation, layer: Layer, tx: number, ty: number): string | null;
}

/** The environment of the simulation's own world. */
export function worldCreatureEnvironment(): CreatureEnvironment {
  const at: ClockAt = { day: 1, hour: 0 };
  const sample = createWeatherSample();
  const biomes = contentWorldIdTables().biomes;
  return {
    timeAt(sim, tick, out) {
      const clock = sim.clock;
      clockAt(clock.tick, clock.dayTick, clock.dawns, clock.ticksPerDay, tick, at);
      const cal = sim.world.calendar;
      out.season = cal.seasonOfDay(at.day);
      out.phase = phaseAt(out.season, at.hour);
      return out;
    },
    finstermond: (sim) => sim.world.calendar.isFinstermond,
    weather(sim, layer, tx, ty, out) {
      out.haze = 0;
      out.precipitation = 0;
      if (layer !== 0) return out;
      const region = sim.world.regionAt(tx, ty);
      if (region === NO_WEATHER_REGION) return out;
      sim.world.weather.sample(region, sample);
      out.haze = sample.haze;
      out.precipitation = sample.precipitation;
      return out;
    },
    biome(sim, layer, tx, ty) {
      if (!sim.world.materialized) return null;
      const chunk = sim.world.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
      if (chunk === undefined) return null;
      const id = chunk.biome[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number;
      return id === 0 ? null : biomes.stringId(id);
    },
  };
}
