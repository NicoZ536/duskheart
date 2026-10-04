/**
 * What the world tells the light system (MASTERPROMPT §12.1, §10): the rain over a tile (torches burn
 * faster and may go out), the ambient light of a tile (the light map's base: calendar and weather) and
 * whether a chunk is in the active zone (its lights tick; frozen ones catch up). Tests hand in their own.
 */
import { BALANCE } from '../../content/balance';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import { createWeatherSample } from '../../world/climate/weather';
import { nightAmbientLight } from '../../world/calendar';
import type { Layer } from '../../world/model/coords';
import type { Simulation } from '../sim';

/** Full day's ambient light before the weather (§12.1 "Tag 1,0"). */
const DAY_AMBIENT = BALANCE.calendar.dayAmbientLight;
/** Ambient light below the surface (§12.1 "Höhle 0"). */
const CAVE_AMBIENT = BALANCE.light.map.caveAmbient;

/** Weather regions the ambient cache holds at first (it grows by doubling for a region beyond). */
const INITIAL_REGIONS = 16;

/**
 * The ambient light of the surface per weather region for one state of the clock (M6-16f). The light map asks for the
 * ambient of every tile it evaluates (a path request at dusk: thousands), and the calendar's getters and the weather sample
 * allocated on every call. The ambient of a surface tile depends only on the clock (daylight, the moon's night light) and
 * on the weather of its region, so it is computed once per region and clock state – the clock's tick, the ticks since
 * dawn and the day's length – and weather period (`WeatherSystem.periodCount`: every change of a region's weather, by its
 * automaton or the debug console, counts one up, even within a tick). The same value as computing it per tile, bit for
 * bit; a tile query then reads a region and two counters.
 */
class SurfaceAmbient {
  private tick = -1;
  private dayTick = -1;
  private dayTicks = -1;
  /** Generation of the clock state: an entry counts when its generation is the current one. */
  private generation = 0;
  private daylight = Number.NaN;
  private night = Number.NaN;
  private readonly sample = createWeatherSample();
  private entryGeneration = new Int32Array(INITIAL_REGIONS);
  /** Weather period the entry was computed in. */
  private entryPeriod = new Float64Array(INITIAL_REGIONS);
  private entryLevel = new Float64Array(INITIAL_REGIONS);
  /** The ambient of the tiles outside every weather region (the weather's factor 1). */
  private clearGeneration = -1;
  private readonly clear = new Float64Array(1);

  /** Ambient light of surface tile (tx, ty) of `sim`'s world (§12.1) into `out[index]`. */
  levelInto(sim: Simulation, tx: number, ty: number, out: Float64Array, index: number): void {
    const clock = sim.clock;
    if (clock.tick !== this.tick || clock.dayTick !== this.dayTick || clock.ticksPerDay !== this.dayTicks) this.refresh(sim);
    const region = sim.world.regionAt(tx, ty);
    if (region === NO_WEATHER_REGION) {
      if (this.clearGeneration !== this.generation) {
        this.surface(1, this.clear, 0);
        this.clearGeneration = this.generation;
      }
      out[index] = this.clear[0] as number;
      return;
    }
    const period = sim.world.weather.periodCount(region);
    if (region >= this.entryGeneration.length) this.grow(region);
    if (this.entryGeneration[region] !== this.generation || this.entryPeriod[region] !== period) {
      this.surface(sim.world.weather.sample(region, this.sample).lightFactor, this.entryLevel, region);
      this.entryPeriod[region] = period;
      this.entryGeneration[region] = this.generation;
    }
    out[index] = this.entryLevel[region] as number;
  }

  /** `surfaceAmbient` (src/world/lightmap/ambient.ts) with this clock state's daylight and night light, term by term, into `out[index]`. */
  private surface(weatherLightFactor: number, out: Float64Array, index: number): void {
    const night = this.night;
    const day = DAY_AMBIENT * weatherLightFactor;
    out[index] = night + (day - night) * this.daylight;
  }

  /** A new clock state: the calendar's values once, every entry outdated. */
  private refresh(sim: Simulation): void {
    const clock = sim.clock;
    this.tick = clock.tick;
    this.dayTick = clock.dayTick;
    this.dayTicks = clock.ticksPerDay;
    this.generation++;
    const cal = sim.world.calendar;
    this.daylight = cal.daylight;
    this.night = nightAmbientLight(cal.moonPhase);
  }

  /** Room for `region` (the arrays double until it fits). */
  private grow(region: number): void {
    let n = this.entryGeneration.length;
    while (n <= region) n *= 2;
    const generation = new Int32Array(n);
    generation.set(this.entryGeneration);
    this.entryGeneration = generation;
    const period = new Float64Array(n);
    period.set(this.entryPeriod);
    this.entryPeriod = period;
    const level = new Float64Array(n);
    level.set(this.entryLevel);
    this.entryLevel = level;
  }
}

/** The surroundings of lights. */
export interface LightEnvironment {
  /** Falling rain over tile (tx, ty) of `layer` [precipitation 0–1]: 0 underground, in snow or ash, when dry. */
  rain(sim: Simulation, layer: Layer, tx: number, ty: number): number;
  /**
   * Ambient light of the tile [light level] (§12.1) into `out[index]`: the light map asks once per tile it evaluates, and
   * a level handed back through a call that is not inlined is a new heap number (M6-16f). Typed `undefined`, so a
   * function that returns the level instead of writing it does not compile.
   */
  ambient(sim: Simulation, layer: Layer, tx: number, ty: number, out: Float64Array, index: number): undefined;
  /** Whether chunk (cx, cy) of `layer` is in the active zone: its lights burn tick by tick, the others catch up. */
  active(sim: Simulation, layer: Layer, cx: number, cy: number): boolean;
  /**
   * A number that changes whenever the active set changes (`ActiveZone.version`), also within a tick: the light source
   * list of the tick is rebuilt then. Chunks activate one by one in the first system of a tick, and a zone listener reading
   * the light between two of them must not leave the later chunks' lights out of the list for the rest of the tick. A test
   * environment whose zone never changes within a tick leaves it out.
   */
  activeVersion?(sim: Simulation): number;
}

/**
 * The environment of the simulation's own world: weather regions, calendar, active zone. A class rather than closures
 * (M6-16f): the light map asks for the ambient of every tile it evaluates, and methods are one code for every world – a
 * new world does not throw the optimised tile query away.
 */
class WorldLightEnvironment implements LightEnvironment {
  private readonly sample = createWeatherSample();
  private readonly surface = new SurfaceAmbient();

  rain(sim: Simulation, layer: Layer, tx: number, ty: number): number {
    if (layer !== 0) return 0;
    const region = sim.world.regionAt(tx, ty);
    if (region === NO_WEATHER_REGION) return 0;
    const w = sim.world.weather.sample(region, this.sample);
    return w.precipitationKind === 'regen' ? w.precipitation : 0;
  }

  /** `ambientLevel` (src/world/lightmap/ambient.ts): below the surface the cave's, above it per weather region (`SurfaceAmbient`). */
  ambient(sim: Simulation, layer: Layer, tx: number, ty: number, out: Float64Array, index: number): undefined {
    if (layer !== 0) out[index] = CAVE_AMBIENT;
    else this.surface.levelInto(sim, tx, ty, out, index);
    return undefined;
  }

  active(sim: Simulation, layer: Layer, cx: number, cy: number): boolean {
    return sim.world.materialized && sim.world.zone.isActive(layer, cx, cy);
  }

  activeVersion(sim: Simulation): number {
    return sim.world.materialized ? sim.world.zone.version : 0;
  }
}

/** The environment of the simulation's own world: weather regions, calendar, active zone. */
export function worldLightEnvironment(): LightEnvironment {
  return new WorldLightEnvironment();
}
