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
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import { WATER_DEPTH_MASK } from '../../world/model/chunk';
import type { Layer } from '../../world/model/coords';
import { FootprintTrail } from '../surface/footprints';
import { Fireflies } from '../surface/fireflies';
import { SURFACE_PARAMS } from '../surface/params';
import { irisEase, irisStep } from '../surface/rules';
import { foliageBlend, type SeasonBlend } from '../surface/season';
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

/** Where the view stands this frame (filled by the game view with one call, `set`). */
export class SurfaceView {
  layer = 0;
  cameraX = 0;
  cameraY = 0;
  /** The figure's feet [world px]; NaN without a figure. */
  figureX = Number.NaN;
  figureY = Number.NaN;
  /** Presentation time [s]. */
  time = 0;
  /** Crowns and roofs that covered the figure in the last frame (the see-through circle opens while > 0). */
  covering = 0;
  /** Viewport of the frame [world px] (fireflies are placed inside it). */
  left = 0;
  top = 0;
  right = 0;
  bottom = 0;

  set(layer: number, cameraX: number, cameraY: number, viewW: number, viewH: number, hasFigure: boolean, figureX: number, figureY: number, time: number, covering: number): this {
    this.layer = layer;
    this.cameraX = cameraX;
    this.cameraY = cameraY;
    this.figureX = hasFigure ? figureX : Number.NaN;
    this.figureY = hasFigure ? figureY : Number.NaN;
    this.time = time;
    this.covering = covering;
    this.left = cameraX - viewW / 2;
    this.right = cameraX + viewW / 2;
    this.top = cameraY - viewH / 2;
    this.bottom = cameraY + viewH / 2;
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
  private lastTime = Number.NaN;
  private snowId: number | null = null;
  private settings: (() => SurfaceRenderSettings) | null = null;
  /**
   * What the calendar and the weather at the camera gave last (§30: the simulation moves once per tick, the frame runs
   * more often – and a still picture never moves it): the tick the foliage blend and the weathering were computed for,
   * and the simulation, tick and tile the weather sample (wind, rain, snow, temperature) was taken at.
   */
  private foliageTick = -1;
  private weatherSim: Simulation | null = null;
  private weatherTick = -1;
  private weatherTx = 0;
  private weatherTy = 0;
  private hasWeather = false;
  /** The eased see-through circle for the open share it was computed from (`canopy`). */
  private easedFrom = Number.NaN;
  private eased = 0;

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
    const last = lastQuery.last;
    const clock = sim.clock;
    const tick = clock.tick;
    const newTick = fresh || tick !== this.foliageTick;
    this.foliageTick = tick;
    const minute = tick / clock.ticksPerGameMinute;
    const today = sim.world.calendar.today;
    const blend = this.blend;
    if (newTick) foliageBlend(today.seasonIndex, today.dayOfSeason, clock.dayFraction, today.seasonLengthDays, blend);
    // Each value of the frame is read once and written to the scene and the debug record (§30).
    const seasonProgress = blend.progress;
    s.seasonFrom = blend.from;
    s.seasonTo = blend.to;
    s.seasonProgress = seasonProgress;
    last.seasonFrom = blend.from;
    last.seasonTo = blend.to;
    last.seasonProgress = seasonProgress;
    s.weatherDriven = true;
    const g = this.ground;
    if (view.layer === 0 && sim.world.materialized) {
      const tx = Math.floor(view.cameraX) >> TILE_SHIFT;
      const ty = Math.floor(view.cameraY) >> TILE_SHIFT;
      if (sim !== this.weatherSim || tick !== this.weatherTick || tx !== this.weatherTx || ty !== this.weatherTy) this.sampleWeather(sim, tx, ty);
    } else {
      // Caves and a world not yet there have no weather; the next sample on the surface is taken afresh.
      this.hasWeather = false;
      this.weatherSim = null;
    }
    if (!this.hasWeather) {
      g.rain = 0;
      g.snow = 0;
      g.temperatureC = MILD_C;
    }
    g.winter = today.seasonIndex === WINTER;
    let windX = 0;
    let windY = 0;
    if (this.hasWeather) {
      const wind = this.wind;
      windX = wind.x;
      windY = wind.y;
      s.windX = windX;
      s.windY = windY;
      s.gust = wind.gust;
    }
    last.windX = windX;
    last.windY = windY;
    const rain = g.rain;
    if (view.layer === 0) {
      if (newTick) this.weathering.step(minute, g);
      const w = this.weathering;
      const wetness = w.wetness;
      const puddles = w.puddles;
      const snow = w.snow;
      s.wetness = wetness;
      s.puddles = puddles;
      s.snow = snow;
      s.snowing = g.snow > 0;
      last.wetness = wetness;
      last.puddles = puddles;
      last.snow = snow;
    } else {
      last.wetness = 0;
      last.puddles = 0;
      last.snow = 0;
    }
    this.figure(scene, sim, view, minute);
    this.canopy(scene, view);
    this.fireflies.share = this.settings?.().fireflyShare ?? 1;
    if (atlas !== null) this.fireflies.emit(scene, atlas, sim, view, rain);
    last.fireflies = this.fireflies.drawn;
    last.footprints = s.footprintCount;
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
    windVector(w.wind, windDirection(seed, region, Math.max(0, period - 1)), windDirection(seed, region, period), w.blend, this.wind);
    g.rain = w.precipitationKind === 'regen' ? w.precipitation : 0;
    g.snow = w.precipitationKind === 'schnee' ? w.precipitation : 0;
    g.temperatureC = sim.world.temperature.temperatureAt(0, tx, ty);
  }

  /** The figure presses the grass and walks prints into snow. */
  private figure(scene: RenderScene, sim: Simulation, view: Readonly<SurfaceView>, minute: number): void {
    const s = scene.surface;
    const x = view.figureX;
    const y = view.figureY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    s.addBender(x, y, BENDER_RADIUS_PX, BENDER_STRENGTH);
    if (view.layer !== 0) return;
    const onSnow = s.snow >= PRINTS_FROM_COVER || this.snowGround(sim, x, y);
    this.trail.update(x, y, minute, onSnow, s.snowing);
    this.trail.emit(s, minute);
  }

  /** Whether the tile under world px (x, y) is snow ground (runtime id of `schnee` looked up once). */
  private snowGround(sim: Simulation, x: number, y: number): boolean {
    if (!sim.world.materialized) return false;
    const tx = Math.floor(x) >> TILE_SHIFT;
    const ty = Math.floor(y) >> TILE_SHIFT;
    const chunk = sim.world.chunks.get(0, Math.floor(tx / CHUNK_TILES), Math.floor(ty / CHUNK_TILES));
    if (chunk === undefined) return false;
    this.snowId ??= contentWorldIdTables().terrain.runtimeId(SNOW_TERRAIN);
    return chunk.ground[(ty - chunk.cy * CHUNK_TILES) * CHUNK_TILES + (tx - chunk.cx * CHUNK_TILES)] === this.snowId;
  }

  /** The see-through circle irises open while something covers the figure (`irisStep`, eased by `irisEase`). */
  private canopy(scene: RenderScene, view: Readonly<SurfaceView>): void {
    const time = view.time;
    const lastTime = this.lastTime;
    this.lastTime = time;
    const covered = view.covering > 0;
    // Nothing covers the figure: the circle is shut (`irisStep` gives 0) – no time step is formed.
    const open = covered ? irisStep(this.open, true, time - lastTime) : 0;
    this.open = open;
    if (open !== this.easedFrom) {
      this.easedFrom = open;
      this.eased = irisEase(open);
    }
    scene.surface.canopyOpen = this.eased;
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
