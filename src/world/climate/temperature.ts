/**
 * Temperature field (MASTERPROMPT §9.1, §9.3, §10; docs/WORLD.md §6; M2-25).
 *
 * Air temperature of a tile [°C]:
 *
 *   T = base + season × f(layer) + A × (c(t) − K) + weather + level × (−3) + heat
 *
 * - `base`: the biome's "°C (Frühlingstag)" of §9.3 (src/content/biomes.ts).
 * - `season`: Frühling 0 · Sommer +8 · Herbst −3 · Winter −14 (`BALANCE.calendar`), changing with the
 *   season at midnight; `f(layer)` damps it underground (`CLIMATE_BALANCE.seasonFactorByDepth`).
 * - Day curve: `A` is the biome's amplitude (±6 °C, Glutsand ±18 °C, caves 0); `c(t)` runs from −1
 *   at sunrise (coldest) to +1 at 15:00 (warmest) and back to −1 at the next sunrise, as two Hermite
 *   segments; `K = 4/9` places the §9.3 table value 4/9 of the amplitude above the daily mean, which
 *   reproduces "Glutsand 34 °C, nachts 8" exactly (the day value is reached around noon).
 * - `weather`: blended offset of the tile's weather region (surface only; caves have no weather).
 * - `level × (−3)`: surface height level 0–4 (`BALANCE.world.temperaturePerHeightLevelC`), e.g.
 *   Frostkamm −8 °C → −20 °C on the peaks (level 4).
 * - `heat`: +20 °C on and next to lava, fading to 0 at 4 tiles (§9.3 Aschenschlund "an Lava +20").
 * Caves stay near their base value: no day curve, no weather, a damped season.
 *
 * The field is global (docs/ARCHITEKTUR.md "Aktive Zone") and updates on the world tick (1 Hz,
 * §3.3): the time-dependent terms are sampled at the last world tick and cached per biome and weather
 * region, so a tile query costs a few array reads. It stores nothing of its own – everything derives
 * from clock, calendar, weather and chunks – so it needs no save participant; after loading, the
 * first query rebuilds the cache for the same world tick. Only + − × ÷ (no transcendental
 * functions), so every device computes identical temperatures.
 */
import { BALANCE } from '../../content/balance';
import { BIOMES } from '../../content/biomes';
import { CLIMATE_BALANCE } from '../../content/weather';
import { clamp01, smoothstep } from '../../engine/math';
import { HOURS_PER_DAY } from '../../engine/time';
import { dayTimes, seasonTemperatureOffsetC, type Calendar, type Season } from '../calendar';
import type { ChunkSource } from '../collision/chunkSource';
import type { ChunkData } from '../model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, CHUNK_SIZE, LAYER_COUNT, layerIndex, type Layer } from '../model/coords';
import { contentWorldIdTables, type WorldIdTables } from '../model/runtimeIds';
import { dayOfMinute, hourOfMinute, clockMinute, minutesPerTick } from './gameTime';
import type { WeatherSystem } from './weather';

/** System id of the temperature field. */
export const TEMPERATURE_SYSTEM_ID = 'temperature';

/** Warmest hour of the day [h]. */
const PEAK_HOUR = CLIMATE_BALANCE.dayCurvePeakHour;
/** Position of the table value in the day curve (see module comment). */
const REFERENCE = CLIMATE_BALANCE.dayCurveReference;
/** Temperature change per surface height level [°C/level]. */
const PER_LEVEL_C = BALANCE.world.temperaturePerHeightLevelC;
/** Heat next to lava [°C]. */
const HEAT_C = CLIMATE_BALANCE.lavaHeatC;
/** Reach of the lava heat [tiles]; heat > 0 only for squared distances below its square. */
const HEAT_RADIUS = CLIMATE_BALANCE.lavaHeatRadiusTiles;
const HEAT_RADIUS_SQ = HEAT_RADIUS * HEAT_RADIUS;
/** Tiles scanned around a query for heat sources (|dx|, |dy| ≤ this). */
const HEAT_SCAN = HEAT_RADIUS - 1;
/** Region value meaning "no weather region" (e.g. open sea). */
export const NO_WEATHER_REGION = -1;

if (!(PEAK_HOUR > dayTimes('winter').sunrise && PEAK_HOUR < HOURS_PER_DAY)) throw new RangeError('Temperature: the warmest hour must lie between the latest sunrise and midnight');
if (!(HEAT_RADIUS >= 2)) throw new RangeError('Temperature: lava heat radius must be ≥ 2 tiles');
if (CLIMATE_BALANCE.seasonFactorByDepth.length !== LAYER_COUNT) throw new RangeError('Temperature: one season factor per layer is required');

// ---------------------------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------------------------

/**
 * Day curve c ∈ [−1, 1] at `hour` (0 ≤ hour < 24): −1 at `sunriseHour` (today's sunrise), +1 at
 * 15:00, back to −1 at `nextSunriseHour` (tomorrow's sunrise). Hermite segments, continuous across
 * midnight and across season changes.
 */
export function dayCurve(hour: number, sunriseHour: number, nextSunriseHour: number): number {
  if (hour < sunriseHour) {
    // Cooling since yesterday's 15:00 towards today's sunrise.
    return 1 - 2 * smoothstep(0, HOURS_PER_DAY - PEAK_HOUR + sunriseHour, hour + HOURS_PER_DAY - PEAK_HOUR);
  }
  if (hour < PEAK_HOUR) return -1 + 2 * smoothstep(sunriseHour, PEAK_HOUR, hour);
  return 1 - 2 * smoothstep(PEAK_HOUR, HOURS_PER_DAY + nextSunriseHour, hour);
}

/** Day curve at `hour` of a day in `season`, followed by a day in `nextSeason`. */
export function dayCurveInSeason(season: Season, nextSeason: Season, hour: number): number {
  return dayCurve(hour, dayTimes(season).sunrise, dayTimes(nextSeason).sunrise);
}

/** Day curve at an absolute game minute (seasons from the calendar). */
export function dayCurveAtMinute(calendar: Calendar, minute: number): number {
  const day = dayOfMinute(minute);
  return dayCurveInSeason(calendar.seasonOfDay(day), calendar.seasonOfDay(day + 1), hourOfMinute(minute));
}

/** Share of the season offset on a layer (§9.3 "Höhlen bleiben nahe ihrem Basiswert"). */
export function seasonFactor(layer: Layer): number {
  return CLIMATE_BALANCE.seasonFactorByDepth[layerIndex(layer)] as number;
}

/** Terms of the temperature formula. */
export interface AirTemperatureTerms {
  /** Biome base value (§9.3 "°C Frühlingstag") [°C]. */
  readonly baseC: number;
  /** Day curve amplitude of the biome [°C]. */
  readonly amplitudeC: number;
  /** Day curve value c ∈ [−1, 1]. */
  readonly dayCurve: number;
  /** Season offset [°C] and its share on this layer. */
  readonly seasonOffsetC: number;
  readonly seasonFactor: number;
  /** Weather offset of the region [°C] (0 underground). */
  readonly weatherOffsetC: number;
  /** Surface height level 0–4 (0 underground). */
  readonly heightLevel: number;
  /** Heat of nearby sources [°C]. */
  readonly heatC: number;
}

/** Air temperature from its terms [°C] (see module comment). */
export function airTemperatureC(t: AirTemperatureTerms): number {
  return t.baseC + t.seasonOffsetC * t.seasonFactor + t.amplitudeC * (t.dayCurve - REFERENCE) + t.weatherOffsetC + t.heightLevel * PER_LEVEL_C + t.heatC;
}

/** Heat of a heat source at squared tile distance `d2` [°C]: full within one tile, 0 from the radius on. */
export function lavaHeatC(d2: number): number {
  return HEAT_C * clamp01((HEAT_RADIUS_SQ - d2) / (HEAT_RADIUS_SQ - 1));
}

/** Optional terms of `biomeTemperatureC`. */
export interface BiomeTemperatureOptions {
  /** Season of the following day (default: the same season). */
  readonly nextSeason?: Season;
  readonly weatherOffsetC?: number;
  readonly heightLevel?: number;
  readonly heatC?: number;
}

/** Temperature of a biome (content id) at `hour` of a day in `season` [°C]. */
export function biomeTemperatureC(biomeId: string, season: Season, hour: number, opts: BiomeTemperatureOptions = {}): number {
  const biome = BIOMES.find((b) => b.id === biomeId);
  if (biome === undefined) throw new RangeError(`Temperature: unknown biome "${biomeId}"`);
  const surface = biome.layer === 0;
  return airTemperatureC({
    baseC: biome.baseTemperatureC,
    amplitudeC: biome.dayAmplitudeC,
    dayCurve: dayCurveInSeason(season, opts.nextSeason ?? season, hour),
    seasonOffsetC: seasonTemperatureOffsetC(season),
    seasonFactor: seasonFactor(biome.layer),
    weatherOffsetC: surface ? (opts.weatherOffsetC ?? 0) : 0,
    heightLevel: surface ? (opts.heightLevel ?? 0) : 0,
    heatC: opts.heatC ?? 0,
  });
}

// ---------------------------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------------------------

/** Construction options of the temperature field. */
export interface TemperatureFieldOptions {
  readonly calendar: Calendar;
  /** Weather of the surface regions; without it the weather offset is 0. */
  readonly weather?: WeatherSystem;
  /** Loaded chunks for `temperatureAt` and the lava heat of `tileTemperature`/`fillChunk`. */
  readonly chunks?: ChunkSource;
  /** Weather region of a surface tile (world plan), `NO_WEATHER_REGION` for none; default: region 0. */
  readonly regionAt?: (tx: number, ty: number) => number;
  /** Runtime id tables the chunks use (default: the game content). */
  readonly idTables?: WorldIdTables;
}

/** The world's temperature field. */
export class TemperatureField {
  /** System id. */
  readonly id = TEMPERATURE_SYSTEM_ID;
  /** Runs regardless of chunks (docs/ARCHITEKTUR.md "Aktive Zone"). */
  readonly timeScope = 'global';
  private readonly calendar: Calendar;
  private readonly weather: WeatherSystem | undefined;
  private readonly chunks: ChunkSource | undefined;
  private readonly regionAt: (tx: number, ty: number) => number;
  /** Per biome runtime id: base, amplitude, layer depth. */
  private readonly baseC: Float64Array;
  private readonly amplitudeC: Float64Array;
  private readonly depthOf: Uint8Array;
  /** Biome runtime id used for tiles without biome, per depth. */
  private readonly fallbackBiome: Uint8Array;
  /** Terrain runtime id of the heat source (0 = none in this content). */
  private readonly heatTerrain: number;
  /** Cached air temperature per biome runtime id (time terms of the last world tick). */
  private readonly air: Float64Array;
  /** Cached weather offset per region. */
  private readonly weatherC: Float64Array;
  /** World tick the cache belongs to (−1 = none yet). */
  private sampledTick = -1;
  private sampledMinute = 0;
  /** Lava flags of a chunk plus margin (reused by `fillChunk`). */
  private readonly heatMask = new Uint8Array((CHUNK_SIZE + 2 * HEAT_SCAN) * (CHUNK_SIZE + 2 * HEAT_SCAN));

  constructor(opts: TemperatureFieldOptions) {
    this.calendar = opts.calendar;
    this.weather = opts.weather;
    this.chunks = opts.chunks;
    this.regionAt = opts.regionAt ?? (() => 0);
    const tables = opts.idTables ?? contentWorldIdTables();
    const n = tables.biomes.size + 1;
    this.baseC = new Float64Array(n);
    this.amplitudeC = new Float64Array(n);
    this.depthOf = new Uint8Array(n);
    this.air = new Float64Array(n);
    this.fallbackBiome = new Uint8Array(LAYER_COUNT);
    for (const b of BIOMES) {
      const rid = tables.biomes.find(b.id);
      if (rid === undefined) continue;
      this.baseC[rid] = b.baseTemperatureC;
      this.amplitudeC[rid] = b.dayAmplitudeC;
      this.depthOf[rid] = layerIndex(b.layer);
      if (b.layer !== 0) this.fallbackBiome[layerIndex(b.layer)] = rid;
    }
    this.fallbackBiome[0] = tables.biomes.runtimeId(CLIMATE_BALANCE.seaClimateBiome);
    for (let d = 0; d < LAYER_COUNT; d++) if (this.fallbackBiome[d] === 0) throw new RangeError(`Temperature: no biome for layer depth ${d}`);
    this.heatTerrain = tables.terrain.find(CLIMATE_BALANCE.heatSourceTerrain) ?? 0;
    this.weatherC = new Float64Array(this.weather?.regionCount ?? 0);
  }

  /** World tick (1 Hz): samples the time-dependent terms. */
  worldTick(): void {
    this.refresh();
  }

  /** Absolute game minute the cached terms belong to (the last world tick). */
  get sampleMinute(): number {
    this.refresh();
    return this.sampledMinute;
  }

  /** Rebuilds the cache if the clock has passed a world tick since the last build. */
  refresh(): void {
    const clock = this.calendar.clock;
    const tick = clock.tick;
    const worldTick = tick - (tick % clock.worldTickInterval);
    if (worldTick === this.sampledTick) return;
    const minute = clockMinute(clock) - (tick - worldTick) * minutesPerTick(clock);
    const day = dayOfMinute(minute);
    const season = this.calendar.seasonOfDay(day);
    const c = dayCurveInSeason(season, this.calendar.seasonOfDay(day + 1), hourOfMinute(minute));
    const seasonC = seasonTemperatureOffsetC(season);
    const factors = CLIMATE_BALANCE.seasonFactorByDepth;
    for (let b = 1; b < this.air.length; b++) {
      this.air[b] = (this.baseC[b] as number) + seasonC * (factors[this.depthOf[b] as number] as number) + (this.amplitudeC[b] as number) * (c - REFERENCE);
    }
    const weather = this.weather;
    if (weather !== undefined) for (let r = 0; r < this.weatherC.length; r++) this.weatherC[r] = weather.temperatureOffsetAt(r, minute);
    this.sampledTick = worldTick;
    this.sampledMinute = minute;
  }

  /** Weather offset of a surface tile [°C] (0 without weather or region). */
  weatherOffsetAt(tx: number, ty: number): number {
    this.refresh();
    const r = this.regionAt(tx, ty);
    return r >= 0 && r < this.weatherC.length ? (this.weatherC[r] as number) : 0;
  }

  /** Air temperature of a biome runtime id on a layer without weather, height and heat [°C] (0 = layer fallback). */
  biomeAirC(biome: number, layer: Layer): number {
    this.refresh();
    const b = biome > 0 && biome < this.air.length ? biome : (this.fallbackBiome[layerIndex(layer)] as number);
    return this.air[b] as number;
  }

  /** Temperature of the tile at local index `i` of a loaded chunk [°C]. */
  tileTemperature(chunk: ChunkData, i: number): number {
    const tx = chunk.cx * CHUNK_SIZE + (i & CHUNK_MASK);
    const ty = chunk.cy * CHUNK_SIZE + (i >> CHUNK_SHIFT);
    return this.climateOf(chunk, i, tx, ty) + this.heatAt(chunk.layer, tx, ty);
  }

  /** Temperature of any tile [°C]; tiles of chunks that are not loaded get their layer's fallback climate. */
  temperatureAt(layer: Layer, tx: number, ty: number): number {
    const chunk = this.chunks?.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) {
      const air = this.biomeAirC(0, layer);
      return layer === 0 ? air + this.weatherOffsetAt(tx, ty) : air;
    }
    return this.tileTemperature(chunk, ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK));
  }

  /** Temperatures of all 1024 tiles of a chunk into `out` (debug overlay, tests). */
  fillChunk(chunk: ChunkData, out: Float32Array | Float64Array): void {
    const span = CHUNK_SIZE + 2 * HEAT_SCAN;
    const mask = this.heatMask;
    const x0 = chunk.cx * CHUNK_SIZE - HEAT_SCAN;
    const y0 = chunk.cy * CHUNK_SIZE - HEAT_SCAN;
    let anyHeat = false;
    for (let my = 0; my < span; my++) {
      for (let mx = 0; mx < span; mx++) {
        const hot = this.isHeatSource(chunk, x0 + mx, y0 + my);
        mask[my * span + mx] = hot ? 1 : 0;
        anyHeat ||= hot;
      }
    }
    for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
      const lx = i & CHUNK_MASK;
      const ly = i >> CHUNK_SHIFT;
      let t = this.climateOf(chunk, i, chunk.cx * CHUNK_SIZE + lx, chunk.cy * CHUNK_SIZE + ly);
      if (anyHeat) {
        let best = HEAT_RADIUS_SQ;
        for (let dy = -HEAT_SCAN; dy <= HEAT_SCAN; dy++) {
          const row = (ly + HEAT_SCAN + dy) * span + lx + HEAT_SCAN;
          for (let dx = -HEAT_SCAN; dx <= HEAT_SCAN; dx++) {
            if (mask[row + dx] === 1) {
              const d2 = dx * dx + dy * dy;
              if (d2 < best) best = d2;
            }
          }
        }
        t += lavaHeatC(best);
      }
      out[i] = t;
    }
  }

  /** Heat of the nearest heat source around a tile [°C]. */
  heatAt(layer: Layer, tx: number, ty: number): number {
    if (this.heatTerrain === 0 || this.chunks === undefined) return 0;
    let best = HEAT_RADIUS_SQ;
    let chunk: ChunkData | undefined;
    for (let dy = -HEAT_SCAN; dy <= HEAT_SCAN; dy++) {
      const y = ty + dy;
      for (let dx = -HEAT_SCAN; dx <= HEAT_SCAN; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 >= best) continue;
        const x = tx + dx;
        const cx = x >> CHUNK_SHIFT;
        const cy = y >> CHUNK_SHIFT;
        if (chunk === undefined || chunk.cx !== cx || chunk.cy !== cy) chunk = this.chunks.get(layer, cx, cy);
        if (chunk !== undefined && chunk.ground[((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK)] === this.heatTerrain) best = d2;
      }
    }
    return lavaHeatC(best);
  }

  /** Temperature without heat sources: biome air + (surface) weather and height. */
  private climateOf(chunk: ChunkData, i: number, tx: number, ty: number): number {
    const air = this.biomeAirC(chunk.biome[i] as number, chunk.layer);
    if (chunk.layer !== 0) return air;
    return air + this.weatherOffsetAt(tx, ty) + (chunk.height[i] as number) * PER_LEVEL_C;
  }

  private isHeatSource(home: ChunkData, tx: number, ty: number): boolean {
    if (this.heatTerrain === 0) return false;
    const cx = tx >> CHUNK_SHIFT;
    const cy = ty >> CHUNK_SHIFT;
    const chunk = cx === home.cx && cy === home.cy ? home : this.chunks?.get(home.layer, cx, cy);
    return chunk !== undefined && chunk.ground[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] === this.heatTerrain;
  }
}
