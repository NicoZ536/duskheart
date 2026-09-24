/**
 * Weather simulation (MASTERPROMPT §10, docs/WORLD.md §6, M2-26).
 *
 * - **Markov automaton per region:** every surface region of the world plan has its own weather.
 *   When a period ends, the next state is drawn from row `current` of the transition matrix of the
 *   region's biome and the season at that moment (`weatherTables()`, src/content/weather.ts); the
 *   Sternschnuppen-Nacht may only begin in full night with at least its minimum duration left and
 *   ends at dawn at the latest. Each period lasts a whole number of game minutes within the state's
 *   range (§10: 1–8 game hours).
 * - **Order independent and without RNG state:** the draw for the `k`-th change of region `r` comes
 *   from a generator seeded with `hash(worldSeed, 'weather', r, k)`, and a change takes effect at the
 *   minute it was scheduled for (not when the world tick notices it). The weather history is thus a
 *   pure function of seed, region biomes and the season calendar – independent of the number of
 *   regions, of the order they are processed in, of how often the world tick samples and of the day
 *   length.
 * - **Soft transitions:** cloud cover, wind, precipitation, haze, daylight factor and temperature
 *   offset blend with a Hermite curve over `CLIMATE_BALANCE.weatherBlendMinutes` from the previous
 *   to the current state (§10 "weiche Übergänge"). The blend is shorter than the shortest period, so
 *   it always starts from a settled state.
 * - **Global system** (docs/ARCHITEKTUR.md "Aktive Zone": the weather automaton runs regardless of
 *   chunks): `worldTick` (1 Hz) processes every change that is due. Save participant `weather-regions`:
 *   per region the biome, current and previous state, start and end minute and the change counter.
 *
 * Queries do not allocate: `sample` writes into a caller-owned `WeatherSample`.
 */
import { z } from 'zod';
import type { SeasonId } from '../../content/balance';
import {
  CLIMATE_BALANCE,
  WEATHER_STATE_COUNT,
  WEATHER_STATE_IDS,
  weatherStateIdSchema,
  weatherStateIndex,
  weatherTables,
  type PrecipitationKind,
  type WeatherState,
  type WeatherStateId,
  type WeatherTables,
} from '../../content/weather';
import { smoothstep } from '../../engine/math';
import { Rng, hash3, hashCombine, hashString, normalizeSeed } from '../../engine/rng';
import { dayTimes, type Calendar } from '../calendar';
import { HOUR_MINUTES, WORLD_START_MINUTE, clockMinute, dayOfMinute, hourOfMinute, minuteOf } from './gameTime';

/** Participant and system id of the weather (roundtrip test `tests/unit/save/roundtrip/weather-regions.test.ts`). */
export const WEATHER_PARTICIPANT_ID = 'weather-regions';
/** Data format version of the weather save participant. */
export const WEATHER_SAVE_VERSION = 1;
/** Name of the weather's random stream (seed derivation). */
export const WEATHER_STREAM = 'weather';
/** Most changes processed for one region in a single `advanceTo` (guards against a corrupt end minute). */
const MAX_CHANGES_PER_ADVANCE = 65_536;

/** Blended weather of one region at one moment. */
export interface WeatherSample {
  /** State that is blending in (or settled). */
  state: WeatherStateId;
  /** State that is blending out. */
  previous: WeatherStateId;
  /** Blend progress 0 (previous) … 1 (state), Hermite-smoothed. */
  blend: number;
  cloudCover: number;
  wind: number;
  precipitation: number;
  /** Kind of the falling precipitation: the new state's, or the fading one while it rains out. */
  precipitationKind: PrecipitationKind;
  haze: number;
  lightFactor: number;
  temperatureOffsetC: number;
}

/** A zeroed sample (allocate once, pass to `sample`). */
export function createWeatherSample(): WeatherSample {
  return { state: 'klar', previous: 'klar', blend: 1, cloudCover: 0, wind: 0, precipitation: 0, precipitationKind: 'keiner', haze: 0, lightFactor: 1, temperatureOffsetC: 0 };
}

/** Saved weather state. */
export const weatherSnapshotSchema = z
  .object({
    biomes: z.array(z.string().min(1)).min(1),
    state: z.array(weatherStateIdSchema),
    previous: z.array(weatherStateIdSchema),
    startMinute: z.array(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
    endMinute: z.array(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
    changes: z.array(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
  })
  .strict()
  .refine((s) => [s.state, s.previous, s.startMinute, s.endMinute, s.changes].every((a) => a.length === s.biomes.length), { message: 'all region arrays need one entry per region' })
  .refine((s) => s.startMinute.every((start, i) => start < (s.endMinute[i] as number)), { message: 'every period must end after it starts', path: ['endMinute'] });

/** Saved weather state. */
export type WeatherSnapshot = z.output<typeof weatherSnapshotSchema>;

/** Save participant of the weather (structurally a `SaveParticipant` of src/save). */
export interface WeatherSaveParticipant {
  readonly id: string;
  readonly version: number;
  serialize(): WeatherSnapshot;
  deserialize(data: unknown): void;
}

/** Whether `minute` lies in the full-darkness night; returns the absolute minute the night ends, or −1. */
export function nightEndMinute(calendar: Calendar, minute: number): number {
  const day = dayOfMinute(minute);
  const hour = hourOfMinute(minute);
  const today = dayTimes(calendar.seasonOfDay(day));
  if (hour < today.dawnStart) return minuteOf(day, today.dawnStart);
  if (hour >= today.duskEnd) return minuteOf(day + 1, dayTimes(calendar.seasonOfDay(day + 1)).dawnStart);
  return -1;
}

/** The weather of all surface regions. */
export class WeatherSystem {
  /** System id. */
  readonly id = WEATHER_PARTICIPANT_ID;
  /** Runs regardless of chunks (docs/ARCHITEKTUR.md "Aktive Zone"); read by `CatchUpRegistry.fromSystems`. */
  readonly timeScope = 'global';
  /** Save participant: per-region weather periods. */
  readonly save: WeatherSaveParticipant;
  readonly tables: WeatherTables;
  private readonly biomes: readonly string[];
  private readonly seed: number;
  private readonly stateIdx: Uint8Array;
  private readonly previousIdx: Uint8Array;
  private readonly startMin: Float64Array;
  private readonly endMin: Float64Array;
  private readonly changeCount: Float64Array;
  private readonly rng = new Rng(0);
  private readonly weights = new Float64Array(WEATHER_STATE_COUNT);

  /**
   * @param calendar  season and night source (and the clock).
   * @param worldSeed world seed (u32 normalised).
   * @param regionBiomes surface biome of every weather region, e.g. `plan.regions.map((r) => r.biome)`.
   */
  constructor(
    readonly calendar: Calendar,
    worldSeed: number,
    regionBiomes: readonly string[],
    tables: WeatherTables = weatherTables(),
  ) {
    if (regionBiomes.length === 0) throw new RangeError('WeatherSystem: at least one region is required');
    for (const b of regionBiomes) if (!tables.biomes.includes(b)) throw new RangeError(`WeatherSystem: biome "${b}" has no weather climate (only surface biomes have weather)`);
    this.tables = tables;
    this.biomes = Object.freeze([...regionBiomes]);
    this.seed = hashCombine(normalizeSeed(worldSeed), hashString(WEATHER_STREAM));
    const n = regionBiomes.length;
    this.stateIdx = new Uint8Array(n);
    this.previousIdx = new Uint8Array(n);
    this.startMin = new Float64Array(n);
    this.endMin = new Float64Array(n);
    this.changeCount = new Float64Array(n);
    const initial = weatherStateIndex(CLIMATE_BALANCE.initialWeather);
    for (let r = 0; r < n; r++) {
      this.stateIdx[r] = initial;
      this.previousIdx[r] = initial;
      // Settled from the first minute: the blend of the initial period lies before the world start.
      this.startMin[r] = WORLD_START_MINUTE - CLIMATE_BALANCE.weatherBlendMinutes;
      this.endMin[r] = WORLD_START_MINUTE + this.drawDuration(r, 0, initial, WORLD_START_MINUTE);
      this.changeCount[r] = 1;
    }
    this.save = {
      id: WEATHER_PARTICIPANT_ID,
      version: WEATHER_SAVE_VERSION,
      serialize: () => this.snapshot(),
      deserialize: (data: unknown) => this.restore(data),
    };
  }

  /** Number of weather regions. */
  get regionCount(): number {
    return this.biomes.length;
  }

  /** Biome of a region. */
  regionBiome(region: number): string {
    return this.biomes[this.checkRegion(region)] as string;
  }

  /** Current absolute game minute of the clock. */
  nowMinute(): number {
    return clockMinute(this.calendar.clock);
  }

  /** World tick (1 Hz): processes every change that is due by now. */
  worldTick(): void {
    this.advanceTo(this.nowMinute());
  }

  /**
   * Processes every change of every region whose period ends at or before `minute`. Changes take
   * effect at their scheduled minute, so calling this once or in many small steps gives the same result.
   */
  advanceTo(minute: number): void {
    for (let r = 0; r < this.biomes.length; r++) {
      let guard = 0;
      while ((this.endMin[r] as number) <= minute) {
        if (++guard > MAX_CHANGES_PER_ADVANCE) throw new RangeError(`WeatherSystem: region ${r} does not advance (end minute ${String(this.endMin[r])})`);
        this.change(r);
      }
    }
  }

  /** Current state of a region. */
  state(region: number): WeatherStateId {
    return WEATHER_STATE_IDS[this.stateIdx[this.checkRegion(region)] as number] as WeatherStateId;
  }

  /** State the region is blending away from. */
  previousState(region: number): WeatherStateId {
    return WEATHER_STATE_IDS[this.previousIdx[this.checkRegion(region)] as number] as WeatherStateId;
  }

  /** Absolute game minute at which the current period of a region began. */
  periodStart(region: number): number {
    return this.startMin[this.checkRegion(region)] as number;
  }

  /** Absolute game minute at which the current period of a region ends. */
  periodEnd(region: number): number {
    return this.endMin[this.checkRegion(region)] as number;
  }

  /** Number of weather periods a region has had (including the current one). */
  periodCount(region: number): number {
    return this.changeCount[this.checkRegion(region)] as number;
  }

  /** Blend progress 0…1 of a region at `minute` (Hermite-smoothed). */
  blendAt(region: number, minute: number): number {
    const r = this.checkRegion(region);
    return smoothstep(0, CLIMATE_BALANCE.weatherBlendMinutes, minute - (this.startMin[r] as number));
  }

  /** Blended temperature offset of a region at `minute` [°C] (the temperature field's fast path). */
  temperatureOffsetAt(region: number, minute: number): number {
    const r = this.checkRegion(region);
    const t = this.blendAt(r, minute);
    const states = this.tables.states;
    const a = (states[this.previousIdx[r] as number] as WeatherState).temperatureOffsetC;
    const b = (states[this.stateIdx[r] as number] as WeatherState).temperatureOffsetC;
    return a + (b - a) * t;
  }

  /** Blended weather of a region at `minute` (default: now) into `out`. */
  sample(region: number, out: WeatherSample, minute: number = this.nowMinute()): WeatherSample {
    const r = this.checkRegion(region);
    const t = this.blendAt(r, minute);
    const states = this.tables.states;
    const a = states[this.previousIdx[r] as number] as WeatherState;
    const b = states[this.stateIdx[r] as number] as WeatherState;
    out.state = b.id;
    out.previous = a.id;
    out.blend = t;
    out.cloudCover = a.cloudCover + (b.cloudCover - a.cloudCover) * t;
    out.wind = a.wind + (b.wind - a.wind) * t;
    out.precipitation = a.precipitation + (b.precipitation - a.precipitation) * t;
    out.precipitationKind = b.precipitationKind !== 'keiner' ? b.precipitationKind : a.precipitationKind;
    out.haze = a.haze + (b.haze - a.haze) * t;
    out.lightFactor = a.lightFactor + (b.lightFactor - a.lightFactor) * t;
    out.temperatureOffsetC = a.temperatureOffsetC + (b.temperatureOffsetC - a.temperatureOffsetC) * t;
    return out;
  }

  /**
   * Sets a region's weather now (debug console `weather`, M2-29): the state blends in from the
   * current one and lasts a regular period. `region = -1` changes every region.
   */
  force(region: number, state: WeatherStateId): void {
    const now = Math.floor(this.nowMinute());
    const idx = weatherStateIndex(state);
    if (idx < 0) throw new RangeError(`WeatherSystem: unknown state "${String(state)}"`);
    const from = region === -1 ? 0 : this.checkRegion(region);
    const to = region === -1 ? this.biomes.length : from + 1;
    for (let r = from; r < to; r++) {
      const k = this.changeCount[r] as number;
      this.previousIdx[r] = this.stateIdx[r] as number;
      this.stateIdx[r] = idx;
      this.startMin[r] = now;
      this.endMin[r] = now + this.drawDuration(r, k, idx, now);
      this.changeCount[r] = k + 1;
    }
  }

  // --- automaton -----------------------------------------------------------------------------------

  /** Seeds the shared generator for draw `k` of region `r` (no allocation). */
  private seedDraw(region: number, k: number): Rng {
    this.rng.seed(hash3(region, k, 0, this.seed));
    return this.rng;
  }

  /** Performs the change that ends the current period of region `r`. */
  private change(r: number): void {
    const at = this.endMin[r] as number;
    const k = this.changeCount[r] as number;
    const biome = this.biomes[r] as string;
    const season: SeasonId = this.calendar.seasonOfDay(dayOfMinute(at));
    const matrix = this.tables.matrix(biome, season);
    const from = this.stateIdx[r] as number;
    const nightEnd = nightEndMinute(this.calendar, at);
    const states = this.tables.states;
    const w = this.weights;
    for (let to = 0; to < WEATHER_STATE_COUNT; to++) {
      const s = states[to] as WeatherState;
      const allowed = !s.nightOnly || (nightEnd >= 0 && nightEnd - at >= s.durationHours.min * HOUR_MINUTES);
      w[to] = allowed ? (matrix[from * WEATHER_STATE_COUNT + to] as number) : 0;
    }
    const rng = this.seedDraw(r, k);
    const next = rng.weightedIndex(w);
    this.previousIdx[r] = from;
    this.stateIdx[r] = next;
    this.startMin[r] = at;
    this.endMin[r] = at + this.durationWith(rng, next, at, nightEnd);
    this.changeCount[r] = k + 1;
  }

  /** Duration of a new period of `state` starting at `at` with draw `k` [game minutes]. */
  private drawDuration(r: number, k: number, state: number, at: number): number {
    return this.durationWith(this.seedDraw(r, k), state, at, nightEndMinute(this.calendar, at));
  }

  private durationWith(rng: Rng, state: number, at: number, nightEnd: number): number {
    const s = this.tables.states[state] as WeatherState;
    const minutes = rng.int(s.durationHours.min * HOUR_MINUTES, s.durationHours.max * HOUR_MINUTES + 1);
    if (!s.nightOnly || nightEnd < 0) return minutes;
    return Math.max(s.durationHours.min * HOUR_MINUTES, Math.min(minutes, Math.floor(nightEnd - at)));
  }

  private checkRegion(region: number): number {
    if (!Number.isInteger(region) || region < 0 || region >= this.biomes.length) throw new RangeError(`WeatherSystem: region ${String(region)} outside 0…${this.biomes.length - 1}`);
    return region;
  }

  // --- save ------------------------------------------------------------------------------------------

  private snapshot(): WeatherSnapshot {
    const n = this.biomes.length;
    const state: WeatherStateId[] = [];
    const previous: WeatherStateId[] = [];
    const startMinute: number[] = [];
    const endMinute: number[] = [];
    const changes: number[] = [];
    for (let r = 0; r < n; r++) {
      state.push(WEATHER_STATE_IDS[this.stateIdx[r] as number] as WeatherStateId);
      previous.push(WEATHER_STATE_IDS[this.previousIdx[r] as number] as WeatherStateId);
      startMinute.push(this.startMin[r] as number);
      endMinute.push(this.endMin[r] as number);
      changes.push(this.changeCount[r] as number);
    }
    return { biomes: [...this.biomes], state, previous, startMinute, endMinute, changes };
  }

  private restore(data: unknown): void {
    const parsed = weatherSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`Weather snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    const s = parsed.data;
    if (s.biomes.length !== this.biomes.length || s.biomes.some((b, i) => b !== this.biomes[i])) {
      throw new TypeError(`Weather snapshot invalid: saved regions (${s.biomes.length}) do not match this world's regions (${this.biomes.length})`);
    }
    for (let r = 0; r < s.biomes.length; r++) {
      this.stateIdx[r] = weatherStateIndex(s.state[r] as WeatherStateId);
      this.previousIdx[r] = weatherStateIndex(s.previous[r] as WeatherStateId);
      this.startMin[r] = s.startMinute[r] as number;
      this.endMin[r] = s.endMinute[r] as number;
      this.changeCount[r] = s.changes[r] as number;
    }
  }
}
