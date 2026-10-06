/**
 * The climate log of the fields (docs/SPIEL.md §20 "Klimaprotokoll", ADR-0207): the weather periods of the regions that hold
 * plots (or anything else that reads the log – the rain collectors of strand E), as the weather automaton creates them
 * (`WeatherSystem.addPeriodListener`), summed up per region and game day (06:00 → 06:00) when they are read:
 * - `rain`: a period of a raining state (precipitation kind `regen` with at least `BALANCE.farming.rainThreshold`) overlaps
 *   the day; `rainMinutes`: the sum of those overlaps [game minutes];
 * - `minOffsetC`: the lowest temperature offset of the periods that overlap the day [°C].
 * T_min of a tile on a day = the biome's air at the coldest hour of the season (+ the height term) + `minOffsetC` – exact,
 * because biome and height do not change (`minTemperatureC`).
 *
 * The weather history is a pure function of seed, biomes and calendar, so the log does not sample on the world tick: it
 * hears each period once. A period cut short by a forced state (debug `setWeather`) ends where the new one begins. Before
 * every read the owner lets the automaton run up to the minute it needs (`ensureUntil` → `WeatherSystem.advanceTo`, pure and
 * idempotent): a time jump (`skipTicks`) runs no world tick, and a field caught up right after it still finds every day it
 * skipped. Regions are recorded from the moment something tracks them (`track`, with the weather's current period); periods
 * that ended before the oldest day anything still needs are dropped (`prune`). Saved in the participant `farming`.
 *
 * Nothing allocates per read: `day` fills one held record.
 */
import { z } from 'zod';
import { BALANCE, type SeasonId } from '../../content/balance';
import { WEATHER_STATE_COUNT, WEATHER_STATE_IDS, weatherStateIdSchema, weatherStateIndex, weatherTables, type WeatherStateId } from '../../content/weather';
import { DAWN_HOUR } from '../../engine/time';
import { minuteOf } from '../../world/climate/gameTime';
import { biomeTemperatureC } from '../../world/climate/temperature';
import type { WeatherSystem } from '../../world/climate/weather';
import type { Simulation } from '../sim';
import type { ClimateDay, ClimateLog } from './types';

const F = BALANCE.farming;
/** Initial capacity of a region's period list (grows by doubling). */
const INITIAL_PERIODS = 16;

/** Whether weather state `idx` rains on the fields, and its temperature offset [°C]. */
const RAINS = new Uint8Array(WEATHER_STATE_COUNT);
const OFFSET_C = new Float64Array(WEATHER_STATE_COUNT);
{
  const states = weatherTables().states;
  for (let i = 0; i < WEATHER_STATE_COUNT; i++) {
    const s = states[i];
    if (s === undefined) continue;
    RAINS[i] = s.precipitationKind === 'regen' && s.precipitation >= F.rainThreshold ? 1 : 0;
    OFFSET_C[i] = s.temperatureOffsetC;
  }
}

/** Absolute game minute of 06:00 on `day` (the start of the farm day `day`). */
export function farmDayStart(day: number): number {
  return minuteOf(day, DAWN_HOUR);
}

/** The periods of one region, oldest first. */
class RegionLog {
  start = new Float64Array(INITIAL_PERIODS);
  end = new Float64Array(INITIAL_PERIODS);
  state = new Uint8Array(INITIAL_PERIODS);
  count = 0;

  /** Records a period: periods from its start on are dropped, one that runs past its start ends there. */
  add(start: number, end: number, state: number): void {
    let n = this.count;
    while (n > 0 && (this.start[n - 1] as number) >= start) n--;
    if (n > 0 && (this.end[n - 1] as number) > start) this.end[n - 1] = start;
    if (n === this.start.length) this.grow();
    this.start[n] = start;
    this.end[n] = end;
    this.state[n] = state;
    this.count = n + 1;
  }

  /** Drops the periods that ended at or before `minute`. */
  prune(minute: number): void {
    let k = 0;
    while (k < this.count && (this.end[k] as number) <= minute) k++;
    if (k === 0) return;
    this.start.copyWithin(0, k, this.count);
    this.end.copyWithin(0, k, this.count);
    this.state.copyWithin(0, k, this.count);
    this.count -= k;
  }

  private grow(): void {
    const n = this.start.length * 2;
    const s = new Float64Array(n);
    s.set(this.start);
    this.start = s;
    const e = new Float64Array(n);
    e.set(this.end);
    this.end = e;
    const st = new Uint8Array(n);
    st.set(this.state);
    this.state = st;
  }
}

/** The held record `day` fills. */
interface ClimateDayRecord {
  region: number;
  day: number;
  rain: boolean;
  rainMinutes: number;
  minOffsetC: number;
}

/** Saved form: per tracked region its periods `[start, end, state]` [game minutes, weather state id]. */
export const climateLogSnapshotSchema = z
  .object({
    regions: z.array(
      z
        .object({
          region: z.number().int().min(0),
          // Whole minutes: the automaton draws whole durations and a forced state starts at a whole minute.
          periods: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0), weatherStateIdSchema])),
        })
        .strict(),
    ),
  })
  .strict();
export type ClimateLogSnapshot = z.output<typeof climateLogSnapshotSchema>;

/** Season of a day (the calendar). */
export interface SeasonSource {
  seasonOfDay(day: number): SeasonId;
}

/** The climate log (see module comment). */
export class FarmClimateLog implements ClimateLog {
  private readonly regions = new Map<number, RegionLog>();
  private weather: WeatherSystem | null = null;
  private readonly held: ClimateDayRecord = { region: 0, day: 0, rain: false, rainMinutes: 0, minOffsetC: 0 };
  /** The listener handed to the weather (one function for the log's lifetime). */
  readonly listener = (region: number, state: WeatherStateId, startMinute: number, endMinute: number): void => {
    const log = this.regions.get(region);
    if (log !== undefined) log.add(startMinute, endMinute, weatherStateIndex(state));
  };

  constructor(private readonly seasons: SeasonSource) {}

  /** The weather the log listens to (null: none yet – tests feed `record`). */
  get listening(): WeatherSystem | null {
    return this.weather;
  }

  /** Listens to `weather` from now on (once per weather object; its current periods are told at once). */
  listen(weather: WeatherSystem): void {
    if (this.weather === weather) return;
    this.weather = weather;
    weather.addPeriodListener(this.listener);
  }

  /** Whether region `region` is recorded. */
  tracks(region: number): boolean {
    return this.regions.has(region);
  }

  /** Records region `region` from now on (with the weather's current period); a no-op for tracked regions and `region` < 0. */
  track(region: number): void {
    if (region < 0 || this.regions.has(region)) return;
    const log = new RegionLog();
    this.regions.set(region, log);
    const w = this.weather;
    if (w !== null && region < w.regionCount) log.add(w.periodStart(region), w.periodEnd(region), weatherStateIndex(w.state(region)));
  }

  /** Records one period of a tracked region by hand (tests without a weather automaton; the weather's listener does the same). */
  record(region: number, state: WeatherStateId, startMinute: number, endMinute: number): void {
    this.listener(region, state, startMinute, endMinute);
  }

  ensureUntil(_sim: Simulation, minute: number): void {
    this.advance(minute);
  }

  /** Lets the weather run up to `minute` (`WeatherSystem.advanceTo`: pure and idempotent; the periods it creates are heard). */
  advance(minute: number): void {
    this.weather?.advanceTo(minute);
  }

  /** The weather of farm day `day` (06:00 → 06:00) in `region` (a held record: read it, do not keep it), or `undefined` when unknown. */
  day(region: number, day: number): ClimateDay | undefined {
    const log = this.regions.get(region);
    if (log === undefined) return undefined;
    const w0 = farmDayStart(day);
    const w1 = farmDayStart(day + 1);
    const out = this.held;
    out.region = region;
    out.day = day;
    out.rain = false;
    out.rainMinutes = 0;
    out.minOffsetC = 0;
    let any = false;
    for (let k = 0; k < log.count; k++) {
      const s = log.start[k] as number;
      const e = log.end[k] as number;
      if (e <= w0 || s >= w1) continue;
      const st = log.state[k] as number;
      const offset = OFFSET_C[st] as number;
      if (!any || offset < out.minOffsetC) out.minOffsetC = offset;
      any = true;
      if (RAINS[st] === 1) {
        out.rain = true;
        out.rainMinutes += Math.min(e, w1) - Math.max(s, w0);
      }
    }
    return any ? out : undefined;
  }

  /** Rainy days in a row in `region` ending with day `day` (at most `max`). */
  rainStreak(region: number, day: number, max: number): number {
    let n = 0;
    while (n < max && this.day(region, day - n)?.rain === true) n++;
    return n;
  }

  minTemperatureC(region: number, biome: string, level: number, day: number): number {
    const offset = this.day(region, day)?.minOffsetC ?? 0;
    return biomeTemperatureC(biome, this.seasons.seasonOfDay(day), F.coldestHour, { heightLevel: level, weatherOffsetC: offset });
  }

  /** Warmest air of a tile on `day` [°C] (the drying of the fields): the biome at the warmest hour + height + the day's offset. */
  maxTemperatureC(region: number, biome: string, level: number, day: number): number {
    const offset = this.day(region, day)?.minOffsetC ?? 0;
    return biomeTemperatureC(biome, this.seasons.seasonOfDay(day), F.warmestHour, { heightLevel: level, weatherOffsetC: offset });
  }

  /** Drops every period that ended at or before `minute` (nothing still needs it). */
  prune(minute: number): void {
    for (const log of this.regions.values()) log.prune(minute);
  }

  /** Number of recorded periods (diagnosis, tests). */
  get periodCount(): number {
    let n = 0;
    for (const log of this.regions.values()) n += log.count;
    return n;
  }

  serialize(): ClimateLogSnapshot {
    const regions: ClimateLogSnapshot['regions'] = [];
    for (const r of [...this.regions.keys()].sort((a, b) => a - b)) {
      const log = this.regions.get(r) as RegionLog;
      const periods: [number, number, WeatherStateId][] = [];
      for (let k = 0; k < log.count; k++) periods.push([log.start[k] as number, log.end[k] as number, WEATHER_STATE_IDS[log.state[k] as number] as WeatherStateId]);
      regions.push({ region: r, periods });
    }
    return { regions };
  }

  restore(data: ClimateLogSnapshot): void {
    this.regions.clear();
    for (const r of data.regions) {
      const log = new RegionLog();
      for (const [s, e, st] of r.periods) log.add(s, e, weatherStateIndex(st));
      this.regions.set(r.region, log);
    }
  }
}
