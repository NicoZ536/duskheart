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
import { CHUNK_TILES, TILE_PX } from '../tilemap/chunk';
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

  /** Follows the surface settings of `renderer` (fireflies drawn with reduced weather particles). */
  attach(renderer: Pick<Renderer, 'surface'>): void {
    this.settings = () => renderer.surface.settings;
  }

  /** Fills `scene.surface` for the frame from `sim` at `view`; fireflies go into `scene.sprites` (needs `atlas`). */
  fill(scene: RenderScene, sim: Simulation, atlas: AtlasData | null, view: Readonly<SurfaceView>): void {
    if (sim !== this.sim || view.layer !== this.layer) {
      // Another session or another layer: nothing of the old ground carries over.
      this.sim = sim;
      this.layer = view.layer;
      this.weathering.reset();
      this.trail.clear();
    }
    if (lastQuery === null || lastQuery.sim !== sim) lastQuery = new SurfaceWorldQuery(sim);
    const s = scene.surface;
    const clock = sim.clock;
    const minute = clock.tick / clock.ticksPerGameMinute;
    const cal = sim.world.calendar;
    const today = cal.today;
    foliageBlend(today.seasonIndex, today.dayOfSeason, clock.dayFraction, today.seasonLengthDays, this.blend);
    s.seasonFrom = this.blend.from;
    s.seasonTo = this.blend.to;
    s.seasonProgress = this.blend.progress;
    s.weatherDriven = true;
    const g = this.ground;
    g.rain = 0;
    g.snow = 0;
    g.temperatureC = MILD_C;
    g.winter = today.seasonIndex === WINTER;
    if (view.layer === 0 && sim.world.materialized) {
      const tx = Math.floor(view.cameraX / TILE_PX);
      const ty = Math.floor(view.cameraY / TILE_PX);
      const region = sim.world.regionAt(tx, ty);
      if (region !== NO_WEATHER_REGION) {
        const weather = sim.world.weather;
        const w = weather.sample(region, this.sample);
        const seed = normalizeSeed(sim.config.seed);
        const period = weather.periodCount(region);
        windVector(w.wind, windDirection(seed, region, Math.max(0, period - 1)), windDirection(seed, region, period), w.blend, this.wind);
        s.windX = this.wind.x;
        s.windY = this.wind.y;
        s.gust = this.wind.gust;
        g.rain = w.precipitationKind === 'regen' ? w.precipitation : 0;
        g.snow = w.precipitationKind === 'schnee' ? w.precipitation : 0;
        g.temperatureC = sim.world.temperature.temperatureAt(0, tx, ty);
      }
    }
    if (view.layer === 0) {
      this.weathering.step(minute, g);
      s.wetness = this.weathering.wetness;
      s.puddles = this.weathering.puddles;
      s.snow = this.weathering.snow;
      s.snowing = g.snow > 0;
    }
    this.figure(scene, sim, view, minute);
    this.canopy(scene, view);
    this.fireflies.share = this.settings?.().fireflyShare ?? 1;
    if (atlas !== null) this.fireflies.emit(scene, atlas, sim, view, g.rain);
    const last = lastQuery.last;
    last.windX = s.windX;
    last.windY = s.windY;
    last.wetness = s.wetness;
    last.puddles = s.puddles;
    last.snow = s.snow;
    last.seasonFrom = s.seasonFrom;
    last.seasonTo = s.seasonTo;
    last.seasonProgress = s.seasonProgress;
    last.fireflies = this.fireflies.drawn;
    last.footprints = s.footprintCount;
  }

  /** The figure presses the grass and walks prints into snow. */
  private figure(scene: RenderScene, sim: Simulation, view: Readonly<SurfaceView>, minute: number): void {
    const s = scene.surface;
    if (!Number.isFinite(view.figureX) || !Number.isFinite(view.figureY)) return;
    const G = SURFACE_PARAMS.grass;
    s.addBender(view.figureX, view.figureY, G.benderRadiusPx, G.benderStrength);
    if (view.layer !== 0) return;
    const onSnow = s.snow >= SURFACE_PARAMS.footprints.coverFrom || this.snowGround(sim, view.figureX, view.figureY);
    this.trail.update(view.figureX, view.figureY, minute, onSnow, s.snowing);
    this.trail.emit(s, minute);
  }

  /** Whether the tile under world px (x, y) is snow ground (runtime id of `schnee` looked up once). */
  private snowGround(sim: Simulation, x: number, y: number): boolean {
    if (!sim.world.materialized) return false;
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor(y / TILE_PX);
    const chunk = sim.world.chunks.get(0, Math.floor(tx / CHUNK_TILES), Math.floor(ty / CHUNK_TILES));
    if (chunk === undefined) return false;
    this.snowId ??= contentWorldIdTables().terrain.runtimeId(SNOW_TERRAIN);
    return chunk.ground[(ty - chunk.cy * CHUNK_TILES) * CHUNK_TILES + (tx - chunk.cx * CHUNK_TILES)] === this.snowId;
  }

  /** The see-through circle irises open while something covers the figure (`irisStep`, eased by `irisEase`). */
  private canopy(scene: RenderScene, view: Readonly<SurfaceView>): void {
    const dt = view.time - this.lastTime;
    this.lastTime = view.time;
    this.open = irisStep(this.open, view.covering > 0, dt);
    scene.surface.canopyOpen = irisEase(this.open);
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
