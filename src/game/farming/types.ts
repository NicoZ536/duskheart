/**
 * Farming at runtime (docs/SPIEL.md §20, ADR-0175; strand D, system `farming`): plots per chunk (packed columns in the
 * FarmStore), growth at 06:00 – active chunks in `dailyTick`, frozen ones in `catchUp` with the same day function –, quality,
 * fertiliser, pests, saplings, fruit trees, greenhouses, and the climate log: the weather periods of every region summed up
 * per game day (06:00 → 06:00), read by growth, frost, fish traps and rain collectors.
 */
import type { Layer } from '../../world/model/coords';
import type { Simulation } from '../sim';

export const PESTS = ['keine', 'kraehen', 'hasen', 'mehltau'] as const;
export type Pest = (typeof PESTS)[number];
/** One plot (packed per chunk in the FarmStore; this is the read record). */
export interface FarmPlot {
  layer: Layer;
  tx: number;
  ty: number;
  moisture: number;
  fertility: number;
  /** Crop id or '' (tilled, empty). */
  crop: string;
  stage: number;
  daysInStage: number;
  qualityPoints: number;
  pest: Pest;
  lastWateredDay: number;
  harvests: number;
  /** In a greenhouse room (refreshed in active chunks, kept while frozen). */
  sheltered: boolean;
  dead: boolean;
}
/** One weather day (06:00 → 06:00) of a region, summarised from weather periods. */
export interface ClimateDay {
  readonly region: number;
  readonly day: number;
  readonly rain: boolean;
  readonly rainMinutes: number;
  readonly minOffsetC: number;
}
export interface ClimateLog {
  /** Lets the weather automaton process every period up to `minute` (`WeatherSystem.advanceTo`, pure and idempotent) before reading. */
  ensureUntil(sim: Simulation, minute: number): void;
  day(region: number, day: number): ClimateDay | undefined;
  /** Lowest air temperature of a tile on `day` [°C]: biome at its coldest hour + height term + the day's weather offset. */
  minTemperatureC(region: number, biome: string, level: number, day: number): number;
}
export interface FarmApi {
  plotAt(layer: Layer, tx: number, ty: number, out: FarmPlot): boolean;
  readonly climate: ClimateLog;
}
// src/world/climate/weather.ts (D, additive): addPeriodListener(fn: WeatherPeriodListener): void
// src/game/gathering/system.ts (D, additive): onTilled(listener: TilledListener): void
// src/game/rooms/system.ts (D, additive): enclosedAt(layer, tx, ty): boolean – fence/wall/gate ring without roof condition
