/**
 * The world surface of the game view (docs/RENDER.md §4 "Welt-Oberfläche", M5-17 … M5-20, M5-23): fills
 * `RenderScene.surface` from the simulation each frame, reading it and never writing it.
 * - **Wind:** the weather at the camera gives the strength, the simulation the direction of the weather period
 *   (`windDirection`, the direction the fire spreads with); over a weather change it turns with the weather's blend.
 * - **Ground:** wetness, puddles and snow cover integrated over the game minutes that passed (`surface/weathering.ts`)
 *   from the rain, the snowfall and the temperature at the camera.
 * - **Foliage:** the blend of the season rows around a season change (`surface/season.ts`).
 * - **Grass and snow:** the figure presses the grass aside (interaction texture) and leaves prints in snow.
 * - **See-through circle:** irises open when a crown or roof starts to cover the figure.
 * - **Fireflies:** on summer nights over the meadows (`surface/fireflies.ts`).
 * Caves (layer ≠ 0) have no weather: still air, dry, no snow.
 */
import type { Simulation } from '../../game/sim';
import { windDirection } from '../../game/fire/formulas';
import { normalizeSeed } from '../../engine/rng';
import { createWeatherSample, type WeatherSample } from '../../world/climate/weather';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import type { AtlasData } from '../assets/atlas';
import type { RenderScene } from '../scene';
import { CHUNK_TILES, TILE_SHIFT } from '../tilemap/chunk';
import { CHUNK_SHIFT } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import { WATER_DEPTH_MASK } from '../../world/model/chunk';
import type { Layer } from '../../world/model/coords';
import { FootprintTrail } from '../surface/footprints';
import { Fireflies } from '../surface/fireflies';
import { SURFACE_PARAMS } from '../surface/params';
import { SURFACE_SLOT, SURFACE_VALUES } from '../surface/state';
import { irisEase, irisStep } from '../surface/rules';
import { foliageBlend, foliageSteadyOn, type SeasonBlend } from '../surface/season';
import { Weathering, type GroundWeather } from '../surface/weathering';
import { windVector, type WindVector } from '../surface/wind';
import type { SurfaceRenderSettings } from '../surface/settings';
import type { Renderer } from '../renderer';

/** Air temperature assumed before the world's temperature field exists [°C] (mild: no snow, normal drying). */
const MILD_C = 10;
/** Index of winter in `SEASON_IDS`. */
const WINTER = 3;
/** Ground that takes footprints whatever the cover. */
const SNOW_TERRAIN = 'schnee';
/** The figure's push on the grass and the snow cover that takes prints (module constants, read without a lookup per frame). */
const BENDER_RADIUS_PX = SURFACE_PARAMS.grass.benderRadiusPx;
const BENDER_STRENGTH = SURFACE_PARAMS.grass.benderStrength;
const PRINTS_FROM_COVER = SURFACE_PARAMS.footprints.coverFrom;

/** Where the view stands this frame (filled by the game view with one call, `set`; `frame` for a frame that moved nothing). */
export class SurfaceView {
  layer = 0;
  cameraX = 0;
  cameraY = 0;
  /** The camera's tile [whole tiles] (the weather is sampled there). */
  cameraTx = 0;
  cameraTy = 0;
  /** The figure's feet [world px]; NaN without a figure. */
  figureX = Number.NaN;
  figureY = Number.NaN;
  /**
   * Whether a figure with finite feet stands in the view; its feet as a typed pair (handed on without reading a float,
   * §30) and its tile [whole tiles].
   */
  hasFeet = false;
  readonly feet = new Float64Array(2);
  figureTx = 0;
  figureTy = 0;
  /** Presentation time [s], also as a typed value (`clock[0]`: the filler keeps the last frame's by copying it, §30). */
  time = 0;
  readonly clock = new Float64Array(1);
  /** Crowns and roofs that covered the figure in the last frame (the see-through circle opens while > 0). */
  covering = 0;
  /** Viewport of the frame [world px] (fireflies are placed inside it). */
  left = 0;
  top = 0;
  right = 0;
  bottom = 0;
  /** Counts the calls of `set`: camera, figure or view may have moved since a frame of another count (`frame` keeps them). */
  version = 0;

  set(layer: number, cameraX: number, cameraY: number, viewW: number, viewH: number, hasFigure: boolean, figureX: number, figureY: number, time: number, covering: number): this {
    this.layer = layer;
    this.cameraX = cameraX;
    this.cameraY = cameraY;
    this.cameraTx = Math.floor(cameraX) >> TILE_SHIFT;
    this.cameraTy = Math.floor(cameraY) >> TILE_SHIFT;
    this.figureX = hasFigure ? figureX : Number.NaN;
    this.figureY = hasFigure ? figureY : Number.NaN;
    this.hasFeet = hasFigure && Number.isFinite(figureX) && Number.isFinite(figureY);
    if (this.hasFeet) {
      this.feet[0] = figureX;
      this.feet[1] = figureY;
      this.figureTx = Math.floor(figureX) >> TILE_SHIFT;
      this.figureTy = Math.floor(figureY) >> TILE_SHIFT;
    }
    this.time = time;
    this.clock[0] = time;
    this.covering = covering;
    this.left = cameraX - viewW / 2;
    this.right = cameraX + viewW / 2;
    this.top = cameraY - viewH / 2;
    this.bottom = cameraY + viewH / 2;
    this.version++;
    return this;
  }

  /**
   * The next frame of a view whose camera, figure and size did not change (`set` wrote them): layer, presentation time
   * and covering only (§30: the rectangle is not formed again).
   */
  frame(layer: number, time: number, covering: number): this {
    this.layer = layer;
    this.time = time;
    this.clock[0] = time;
    this.covering = covering;
    return this;
  }
}

export class SurfaceSceneFiller {
  readonly weathering = new Weathering();
  readonly trail = new FootprintTrail();
  readonly fireflies = new Fireflies();
  private readonly sample: WeatherSample = createWeatherSample();
  private readonly wind: WindVector = { x: 0, y: 0, gust: 0 };
  private readonly blend: SeasonBlend = { from: 0, to: -1, progress: 0 };
  private readonly ground: GroundWeather = { rain: 0, snow: 0, temperatureC: MILD_C, winter: false };
  private sim: Simulation | null = null;
  private layer = -1;
  private open = 0;
  /** The presentation time of the last frame (`[0]`, NaN before the first; copied from the view, §30). */
  private readonly lastClock = new Float64Array(1).fill(Number.NaN);
  private snowId: number | null = null;
  private settings: (() => SurfaceRenderSettings) | null = null;
  /**
   * What the calendar and the weather at the camera gave last (§30: the simulation moves once per tick, the frame runs
   * more often – and a still picture never moves it): the tick the foliage blend and the weathering were computed for,
   * and the simulation, tick and tile the weather sample (wind, rain, snow, temperature) was taken at.
   */
  private foliageTick = -1;
  /** The day the foliage blend was computed for (`foliageSteadyOn`: away from a change of season the day decides it). */
  private foliageSeason = -1;
  private foliageDay = -1;
  private foliageLength = -1;
  /** The weather's wind strength and blend, region, period and seed the wind vector was turned for (`sampleWeather`). */
  private readonly windOf = new Float64Array(2).fill(Number.NaN);
  private windRegion = -1;
  private windPeriod = -1;
  private windSeed = -1;
  private weatherSim: Simulation | null = null;
  private weatherTick = -1;
  private weatherTx = 0;
  private weatherTy = 0;
  private hasWeather = false;
  /**
   * The surface values every frame hands to `scene.surface` (`SurfaceState.values`, one copy): computed when the tick,
   * the weather sample, the layer or the see-through circle changes; `version` counts those changes (the debug record
   * `SurfaceWorldQuery.last` is written again only then).
   */
  private readonly values = new Float64Array(SURFACE_VALUES);
  private version = 0;
  private lastWritten: SurfaceWorldQuery['last'] | null = null;
  private lastVersion = -1;
  /** Derived from the ground weather when it changes: snow is falling, the cover takes prints, fireflies fly. */
  private snowing = false;
  private coverTakesPrints = false;
  private firefliesFly = false;
  /** The eased see-through circle for the open share it was computed from (`canopy`); `shut`: the open share is 0. */
  private easedFrom = Number.NaN;
  private shut = false;
  /** The view and its `version` the footprint trail last saw, at simulation tick `trailTick` (a still frame walks nothing). */
  private trailView: SurfaceView | null = null;
  private trailVersion = -1;
  private trailTick = -1;

  /** Follows the surface settings of `renderer` (fireflies drawn with reduced weather particles). */
  attach(renderer: Pick<Renderer, 'surface'>): void {
    this.settings = () => renderer.surface.settings;
  }

  /** Fills `scene.surface` for the frame from `sim` at `view`; fireflies go into `scene.sprites` (needs `atlas`). */
  fill(scene: RenderScene, sim: Simulation, atlas: AtlasData | null, view: Readonly<SurfaceView>): void {
    let fresh = false;
    if (sim !== this.sim || view.layer !== this.layer) {
      // Another session or another layer: nothing of the old ground carries over.
      this.sim = sim;
      this.layer = view.layer;
      this.weathering.reset();
      this.trail.clear();
      fresh = true;
    }
    if (lastQuery === null || lastQuery.sim !== sim) lastQuery = new SurfaceWorldQuery(sim);
    const s = scene.surface;
    const v = this.values;
    const clock = sim.clock;
    const tick = clock.tick;
    const newTick = fresh || tick !== this.foliageTick;
    this.foliageTick = tick;
    const blend = this.blend;
    const g = this.ground;
    if (newTick) {
      const today = sim.world.calendar.today;
      // Away from a change of season the blend depends on the day alone (no fraction of it): computed again only on
      // another day or season, or on the days around a change (§30: a tick hands no fraction of the day through a call).
      const season = today.seasonIndex;
      const day = today.dayOfSeason;
      const length = today.seasonLengthDays;
      if (fresh || season !== this.foliageSeason || day !== this.foliageDay || length !== this.foliageLength || !foliageSteadyOn(day, length)) {
        this.foliageSeason = season;
        this.foliageDay = day;
        this.foliageLength = length;
        foliageBlend(season, day, clock.dayFraction, length, blend);
        v[SURFACE_SLOT.seasonProgress] = blend.progress;
        this.version++;
      }
      g.winter = season === WINTER;
    }
    // Each value of the frame is written to the scene and, when it changed, to the debug record (§30).
    s.seasonFrom = blend.from;
    s.seasonTo = blend.to;
    s.weatherDriven = true;
    let groundMoved = newTick;
    if (view.layer === 0 && sim.world.materialized) {
      const tx = view.cameraTx;
      const ty = view.cameraTy;
      if (sim !== this.weatherSim || tick !== this.weatherTick || tx !== this.weatherTx || ty !== this.weatherTy) {
        this.sampleWeather(sim, tx, ty);
        this.weatherChanged();
        groundMoved = true;
      }
    } else if (this.hasWeather || this.weatherSim !== null || fresh) {
      // Caves and a world not yet there have no weather; the next sample on the surface is taken afresh.
      this.hasWeather = false;
      this.weatherSim = null;
      this.weatherChanged();
      groundMoved = true;
    }
    if (newTick) {
      if (view.layer === 0) {
        this.weathering.stepToTick(tick, clock.ticksPerGameMinute, g);
        const w = this.weathering;
        v[SURFACE_SLOT.wetness] = w.wetness;
        v[SURFACE_SLOT.puddles] = w.puddles;
        v[SURFACE_SLOT.snow] = w.snow;
      } else {
        v[SURFACE_SLOT.wetness] = 0;
        v[SURFACE_SLOT.puddles] = 0;
        v[SURFACE_SLOT.snow] = 0;
      }
    }
    if (groundMoved) this.groundChanged(sim, view.layer);
    if (view.layer === 0) s.snowing = this.snowing;
    this.canopy(view);
    s.values.set(v);
    this.figure(scene, sim, view, fresh);
    this.fireflies.share = this.settings?.().fireflyShare ?? 1;
    if (atlas !== null) {
      if (this.firefliesFly) this.fireflies.emit(scene, atlas, sim, view);
      else this.fireflies.drawn = 0;
    }
    const last = lastQuery.last;
    if (last !== this.lastWritten || this.version !== this.lastVersion) this.writeLast(last, view.layer);
    last.fireflies = this.fireflies.drawn;
    last.footprints = s.footprintCount;
  }

  /** The wind of a new weather sample (or of none) into the values; a ground without weather is mild and dry. */
  private weatherChanged(): void {
    const v = this.values;
    const g = this.ground;
    const x = v[SURFACE_SLOT.windX];
    const y = v[SURFACE_SLOT.windY];
    const gust = v[SURFACE_SLOT.gust];
    if (this.hasWeather) {
      const wind = this.wind;
      v[SURFACE_SLOT.windX] = wind.x;
      v[SURFACE_SLOT.windY] = wind.y;
      v[SURFACE_SLOT.gust] = wind.gust;
    } else {
      v[SURFACE_SLOT.windX] = 0;
      v[SURFACE_SLOT.windY] = 0;
      v[SURFACE_SLOT.gust] = 0;
      g.rain = 0;
      g.snow = 0;
      g.temperatureC = MILD_C;
    }
    this.snowing = g.snow > 0;
    // A new sample with the same wind (most ticks) changes nothing the debug record shows (§30: no record is written).
    if (x !== v[SURFACE_SLOT.windX] || y !== v[SURFACE_SLOT.windY] || gust !== v[SURFACE_SLOT.gust]) this.version++;
  }

  /** What the ground of a new tick or weather sample means for prints and fireflies. */
  private groundChanged(sim: Simulation, layer: number): void {
    this.coverTakesPrints = (this.values[SURFACE_SLOT.snow] as number) >= PRINTS_FROM_COVER;
    this.firefliesFly = Fireflies.active(sim, layer, this.ground.rain);
  }

  /** The debug record of the frame's surface (`SurfaceWorldQuery.last`), written when the values changed. */
  private writeLast(last: SurfaceWorldQuery['last'], layer: number): void {
    const v = this.values;
    const blend = this.blend;
    this.lastWritten = last;
    this.lastVersion = this.version;
    last.seasonFrom = blend.from;
    last.seasonTo = blend.to;
    last.seasonProgress = v[SURFACE_SLOT.seasonProgress] as number;
    last.windX = v[SURFACE_SLOT.windX] as number;
    last.windY = v[SURFACE_SLOT.windY] as number;
    const surface = layer === 0;
    last.wetness = surface ? (v[SURFACE_SLOT.wetness] as number) : 0;
    last.puddles = surface ? (v[SURFACE_SLOT.puddles] as number) : 0;
    last.snow = surface ? (v[SURFACE_SLOT.snow] as number) : 0;
  }

  /** Samples the weather at tile (`tx`, `ty`) of the surface into the wind and the ground weather (once per tick and tile). */
  private sampleWeather(sim: Simulation, tx: number, ty: number): void {
    this.weatherSim = sim;
    this.weatherTick = sim.clock.tick;
    this.weatherTx = tx;
    this.weatherTy = ty;
    const region = sim.world.regionAt(tx, ty);
    this.hasWeather = region !== NO_WEATHER_REGION;
    if (!this.hasWeather) return;
    const g = this.ground;
    const weather = sim.world.weather;
    const w = weather.sample(region, this.sample);
    const seed = normalizeSeed(sim.config.seed);
    const period = weather.periodCount(region);
    // The wind of the sample, turned anew only when strength, blend, region or period changed (most ticks change none).
    if (w.wind !== this.windOf[0] || w.blend !== this.windOf[1] || region !== this.windRegion || period !== this.windPeriod || seed !== this.windSeed) {
      this.windOf[0] = w.wind;
      this.windOf[1] = w.blend;
      this.windRegion = region;
      this.windPeriod = period;
      this.windSeed = seed;
      windVector(w.wind, windDirection(seed, region, period > 1 ? period - 1 : 0), windDirection(seed, region, period), w.blend, this.wind);
    }
    g.rain = w.precipitationKind === 'regen' ? w.precipitation : 0;
    g.snow = w.precipitationKind === 'schnee' ? w.precipitation : 0;
    g.temperatureC = sim.world.temperature.temperatureAt(0, tx, ty);
  }

  /**
   * The figure presses the grass and walks prints into snow. A frame whose figure stands where the trail saw it last, at
   * the same tick, only keeps the trail (`FootprintTrail.stand`; §30: no float of the feet is read).
   */
  private figure(scene: RenderScene, sim: Simulation, view: Readonly<SurfaceView>, fresh: boolean): void {
    const s = scene.surface;
    if (!view.hasFeet) return;
    s.addBenderAt(view.feet, BENDER_RADIUS_PX, BENDER_STRENGTH);
    if (view.layer !== 0) return;
    const onSnow = this.coverTakesPrints || this.snowGround(sim, view.figureTx, view.figureTy);
    const clock = sim.clock;
    const tick = clock.tick;
    if (!fresh && view === this.trailView && view.version === this.trailVersion && tick === this.trailTick) this.trail.stand(onSnow);
    else {
      this.trailView = view;
      this.trailVersion = view.version;
      this.trailTick = tick;
      this.trail.update(view.figureX, view.figureY, tick / clock.ticksPerGameMinute, onSnow, s.snowing);
    }
    if (this.trail.size > 0) this.trail.emit(s, tick / clock.ticksPerGameMinute);
  }

  /** Whether surface tile (tx, ty) is snow ground (runtime id of `schnee` looked up once). */
  private snowGround(sim: Simulation, tx: number, ty: number): boolean {
    if (!sim.world.materialized) return false;
    const chunk = sim.world.chunks.get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) return false;
    this.snowId ??= contentWorldIdTables().terrain.runtimeId(SNOW_TERRAIN);
    return chunk.ground[(ty - chunk.cy * CHUNK_TILES) * CHUNK_TILES + (tx - chunk.cx * CHUNK_TILES)] === this.snowId;
  }

  /**
   * The see-through circle irises open while something covers the figure (`irisStep`, eased by `irisEase`). Uncovered
   * and shut (almost every frame) nothing changes: no time step is formed and no value is read (§30).
   */
  private canopy(view: Readonly<SurfaceView>): void {
    const covered = view.covering > 0;
    const last = this.lastClock;
    let open = 0;
    if (covered) open = irisStep(this.open, true, view.time - (last[0] as number));
    last.set(view.clock);
    if (!covered && this.shut) return;
    this.open = open;
    if (open !== this.easedFrom) {
      this.easedFrom = open;
      this.values[SURFACE_SLOT.canopyOpen] = irisEase(open);
      this.version++;
    }
    this.shut = !covered;
  }

  /**
   * Whether the see-through circle stands still for `covering` crowns and roofs over the figure (the count of the frame
   * just drawn; the next `fill` gets it): fully open while something covers the figure, shut otherwise. With the clock
   * frozen (screenshots) it opens by `frozenStep` per frame – a picture is final only once it stands (`GameWorldScene.ready`).
   */
  irisAtRest(covering: number): boolean {
    return covering > 0 ? this.open >= 1 : this.open === 0;
  }
}

/** A tile of the surface. */
export interface SurfaceTile {
  tx: number;
  ty: number;
}

/**
 * Debug queries of the world the game view last showed (screenshot scenarios: stand the player next to a tree, walk
 * it through grass, find a glowing mushroom in a cave). Reads the simulation's resident chunks of `layer` only; `null`
 * before the game view drew a world.
 */
export class SurfaceWorldQuery {
  /** The surface of the last filled frame (wind, wetness, puddles, snow, fireflies drawn). */
  readonly last = { windX: 0, windY: 0, wetness: 0, puddles: 0, snow: 0, seasonFrom: 0, seasonTo: -1, seasonProgress: 0, fireflies: 0, footprints: 0 };

  /** The world layer the queries read (0 = the surface, −1 … −3 the caves). */
  layer: Layer = 0;

  constructor(readonly sim: Simulation) {}

  /** Runtime id → content id of the tile's world object ('' for none), or null when the chunk is not resident. */
  objectAt(tx: number, ty: number): string | null {
    const chunk = this.sim.world.chunks.get(this.layer, Math.floor(tx / CHUNK_TILES), Math.floor(ty / CHUNK_TILES));
    if (chunk === undefined) return null;
    const id = chunk.object[(ty - chunk.cy * CHUNK_TILES) * CHUNK_TILES + (tx - chunk.cx * CHUNK_TILES)] as number;
    return id === 0 ? '' : contentWorldIdTables().objects.stringId(id);
  }

  /** Ground type, height level, water and solid rock (caves) of the tile, or null when the chunk is not resident. */
  groundAt(tx: number, ty: number): { terrain: string; level: number; water: boolean; solid: boolean } | null {
    const chunk = this.sim.world.chunks.get(this.layer, Math.floor(tx / CHUNK_TILES), Math.floor(ty / CHUNK_TILES));
    if (chunk === undefined) return null;
    const i = (ty - chunk.cy * CHUNK_TILES) * CHUNK_TILES + (tx - chunk.cx * CHUNK_TILES);
    const ground = chunk.ground[i] as number;
    return {
      terrain: ground === 0 ? '' : contentWorldIdTables().terrain.stringId(ground),
      level: chunk.height[i] as number,
      water: ((chunk.water[i] as number) & WATER_DEPTH_MASK) !== 0,
      solid: (chunk.solid[i] as number) !== 0,
    };
  }

  /** Whether the tile is open ground to stand on or set something down on: resident, dry, no rock, no object. */
  freeAt(tx: number, ty: number): boolean {
    const g = this.groundAt(tx, ty);
    return g !== null && !g.water && !g.solid && this.objectAt(tx, ty) === '';
  }

  /** The tile with object `id` nearest to (tx, ty) within `radius` tiles (ring by ring), or null. */
  nearestObject(tx: number, ty: number, id: string, radius: number): SurfaceTile | null {
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.objectAt(tx + dx, ty + dy) === id) return { tx: tx + dx, ty: ty + dy };
        }
      }
    }
    return null;
  }
}

let lastQuery: SurfaceWorldQuery | null = null;

/** The query of the world the game view last filled (debug scenarios). */
export function surfaceWorldQuery(): SurfaceWorldQuery | null {
  return lastQuery;
}
