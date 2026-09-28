/**
 * The light strand's part of the game view (`scene.sky`, docs/RENDER.md §4; M5-01 … M5-04, M5-34): sun and moon
 * from the calendar, clouds and wind from the weather at the camera, the biome's night colour in the ambient, and the
 * occluders of the terrain and the build grid around the view. Called once per frame by `gameScene.ts` after it set
 * the ambient light (`scene.env`) and the view rectangle.
 *
 * - **Sun by day, moon by night:** the calendar's shadow vector (direction, length per unit height, strength) and
 *   elevation give the directed light's share of the ambient (`skyMath.sunShare`/`moonShare`), its direction for the
 *   normal mapping and the silhouettes' shear. The moon's share follows its phase (§6.2 "Mondphase = Helligkeit");
 *   a Finstermond has none. Overcast weather scatters the sun into the sky.
 * - **Ambient by biome:** at night and dusk the ambient leans towards the biome's night colour (docs/ART.md,
 *   `colorIdentity.night` of the biome under the camera); by day the palette stays exact. Caves keep the view's
 *   near-black ambient (§6.2 "Höhlen: Umgebungslicht ≈ 0").
 * - **Clouds** cover the sky by the weather's cloudiness and drift with the wind of the weather period (the same
 *   directions the fire spreads with).
 * - **Occluders:** raised terrain, cliff faces and rock (`light/terrainOccluders.ts`), walls, closed doors and fences
 *   (`light/buildingOccluders.ts`) in the view plus the occluder pass's margin; the build grid's sun casters (walls,
 *   doors, windows with their panes, roofs) in the same rectangle.
 *
 * Sun, moon, weather and the night tint are computed again only when due (`skyRefreshDue`: a new game minute, every
 * half second of a running simulation, once after it stopped on a new tick); every frame copies the result and moves
 * the clouds. Reads the simulation, never writes it; no allocation per frame.
 */
import { BALANCE } from '../../content/balance';
import { BIOMES } from '../../content/biomes';
import { DIR_DX, DIR_DY, windDirection } from '../../game/fire/formulas';
import { BUILDING_SYSTEM_ID, BuildingSystem } from '../../game/building/system';
import type { Simulation } from '../../game/sim';
import { normalizeSeed } from '../../engine/rng';
import { createShadowVector } from '../../world/calendar';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import { createWeatherSample } from '../../world/climate/weather';
import { CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import { BuildingOccluders, PaneSprites } from '../light/buildingOccluders';
import { paletteLight, withSaturation, type Rgb } from '../light/lightColors';
import { BUILDING_SUN, DAYLIGHT, MOONLIGHT_PARAMS, SDF, SUN_SHADOW } from '../light/params';
import { cloudCover, cloudOffset, lightDirection, moonShare, splitDaylight, sunShare } from '../light/skyMath';
import { SkyState, type DirectionalLight } from '../light/sky';
import { TerrainOccluders } from '../light/terrainOccluders';
import type { RenderScene } from '../scene';
import type { ChunkSignatures } from './signature';
import type { ChunkLookup } from './window';

/** What the filler reads of the game view's frame. */
export interface SkyView {
  readonly layer: Layer;
  /** Rectangle the view pushes objects for [world px]. */
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly chunks: ChunkLookup;
  readonly signatures: ChunkSignatures;
}

/** Saturation of a biome's night colour in the ambient (as cool as the moonlight). */
const NIGHT_SATURATION = 0.6;
/** Share of the biome's night colour in the night ambient (the rest is the moonlight of lightColors.ts). */
const NIGHT_TINT_SHARE = 0.2;
/** Extra warmth of a low sun (dawn and dusk gold) and the elevation at which it has faded [degrees]. */
const LOW_SUN_WARMTH = 0.12;
const LOW_SUN_WARMTH_UNTIL_DEG = 30;
/** Moonlight leans slightly cooler than the night sky it comes through. */
const MOON_WARMTH = -0.06;

/** Night colour per biome runtime id (index = runtime id; `null` = none). */
function nightColours(): Array<Rgb | null> {
  const tables = contentWorldIdTables().biomes;
  const out: Array<Rgb | null> = [null];
  for (const id of tables.ids()) {
    const biome = BIOMES.find((b) => b.id === id);
    const night = biome?.colorIdentity?.night;
    out[tables.find(id) ?? out.length] = night === undefined ? null : withSaturation(paletteLight(night), NIGHT_SATURATION);
  }
  return out;
}

/** Ticks between two computations of sun, moon and weather while the simulation runs (half a second at 60 Hz). */
export const SKY_REFRESH_TICKS = 30;
/** Tiles around the view whose houses still throw their evening shadow into it. */
const BUILDING_REACH_TILES = Math.ceil(Math.max(SDF.marginPx, SUN_SHADOW.maxLength * BUILDING_SUN.roofTopPx) / TILE_PX);
/** Tiles of the occluder pass's margin around the view (whole tiles). */
const MARGIN_TILES = Math.ceil(SDF.marginPx / TILE_PX);

/**
 * Whether the sky computed at tick `computedTick` (game minute `computedMinute`) is due again at `tick` (`minute`),
 * the previous frame having shown tick `previousFrameTick`: after a jump back (another simulation, a loaded game), in a
 * new game minute, every `SKY_REFRESH_TICKS` ticks while the simulation runs, and once when it stopped on a tick not
 * yet computed (a scenario's commands, a pause after a command).
 */
export function skyRefreshDue(computedTick: number, computedMinute: number, previousFrameTick: number, tick: number, minute: number): boolean {
  return tick < computedTick || minute !== computedMinute || tick - computedTick >= SKY_REFRESH_TICKS || (tick !== computedTick && tick === previousFrameTick);
}

/** The filler's last computation of the sky. */
interface SkyCache {
  /** Counts the computations (the frame copies the directed light only when it changed). */
  version: number;
  tick: number;
  minute: number;
  tintShare: number;
  windX: number;
  windY: number;
  cover: number;
  cloudVX: number;
  cloudVY: number;
  readonly directional: DirectionalLight;
}

function createSkyCache(): SkyCache {
  const d = new SkyState().directional;
  return { version: 0, tick: -1, minute: -1, tintShare: 0, windX: 0, windY: 0, cover: 0, cloudVX: 0, cloudVY: 0, directional: { ...d } };
}

/** Copies a directed light field by field (the scene's record is reset every frame). */
function copyDirectional(from: Readonly<DirectionalLight>, to: DirectionalLight): void {
  to.share = from.share;
  to.dirR = from.dirR;
  to.dirG = from.dirG;
  to.dirB = from.dirB;
  to.skyR = from.skyR;
  to.skyG = from.skyG;
  to.skyB = from.skyB;
  to.lx = from.lx;
  to.ly = from.ly;
  to.lz = from.lz;
  to.relief = from.relief;
  to.shadowX = from.shadowX;
  to.shadowY = from.shadowY;
  to.shadowLength = from.shadowLength;
}

export class SkySceneFiller {
  private readonly sun = createShadowVector();
  private readonly moon = createShadowVector();
  private readonly weather = createWeatherSample();
  private readonly terrain = new TerrainOccluders();
  private readonly building = new BuildingOccluders();
  private readonly panes = new PaneSprites();
  private readonly night = nightColours();
  private buildingOf: { sim: Simulation; system: BuildingSystem | null } | null = null;
  private readonly levelAt = (tx: number, ty: number): number => this.level(tx, ty);
  private view: SkyView | null = null;
  /** The last computation of sun, moon, weather and night tint (`compute`) and the tick of the previous frame. */
  private readonly cache = createSkyCache();
  private readonly velocity = { offsetX: 0, offsetY: 0 };
  private cachedSim: Simulation | null = null;
  private lastTick = -1;
  /** The scene record the directed light was last copied into, and the computation it came from. */
  private copiedTo: RenderScene['sky'] | null = null;
  private copiedVersion = -1;

  /** Occluder runs of the terrain rebuilt in the last frame (tests, info). */
  get terrainRebuilt(): number {
    return this.terrain.rebuilt;
  }

  fill(scene: RenderScene, sim: Simulation, view: SkyView, cameraX: number, cameraY: number, time: number, worldTiles: number): void {
    this.view = view;
    const sky = scene.sky;
    const layer = view.layer;
    // Occluders around the view (whole tiles, plus the flood margin of the occluder pass).
    const vx0 = Math.floor(view.left / TILE_PX);
    const vy0 = Math.floor(view.top / TILE_PX);
    const vx1 = Math.floor(view.right / TILE_PX);
    const vy1 = Math.floor(view.bottom / TILE_PX);
    const tx0 = vx0 - MARGIN_TILES;
    const ty0 = vy0 - MARGIN_TILES;
    const tx1 = vx1 + MARGIN_TILES;
    const ty1 = vy1 + MARGIN_TILES;
    this.terrain.collect(view.chunks, view.signatures, worldTiles, layer, tx0, ty0, tx1, ty1, sky.occluders);
    const building = this.buildingSystem(sim);
    if (building !== null) {
      const atlas = scene.atlas;
      if (atlas !== null) this.panes.bind(atlas.manifest);
      // A house beyond the margin still throws its evening shadow into the view.
      const r = BUILDING_REACH_TILES;
      this.building.collect(building.structures, building.catalog, layer, vx0 - r, vy0 - r, vx1 + r, vy1 + r, this.levelAt, sky.occluders, sky.sunCasters, atlas === null ? null : this.panes);
    }
    if (layer !== 0) return;
    // Sun, moon, weather and the night tint drift slowly: computed again when the simulation stopped on a new tick
    // (a scenario, a command), every SKY_REFRESH_TICKS ticks while it runs and when the game minute changes; in
    // between the frame takes the last result (no float arithmetic per frame in code that runs once a frame).
    const c = this.cache;
    const tick = sim.tick;
    const minute = sim.world.calendar.clock.minuteOfDay;
    const stale = sim !== this.cachedSim || skyRefreshDue(c.tick, c.minute, this.lastTick, tick, minute);
    this.lastTick = tick;
    if (stale) this.compute(sim, cameraX, cameraY, tick, minute);
    if (c.tintShare > 0) {
      const tint = this.biomeNight(layer, cameraX, cameraY);
      if (tint !== null) {
        const env = scene.env;
        const k = c.tintShare;
        env.ambientR += (tint[0] - env.ambientR) * k;
        env.ambientG += (tint[1] - env.ambientG) * k;
        env.ambientB += (tint[2] - env.ambientB) * k;
      }
    }
    // The directed light's record keeps its values between frames (`SkyState.beginFrame` resets only the share).
    const d = sky.directional;
    if (this.copiedTo !== sky || this.copiedVersion !== c.version) {
      copyDirectional(c.directional, d);
      this.copiedTo = sky;
      this.copiedVersion = c.version;
    } else d.share = c.directional.share;
    sky.windX = c.windX;
    sky.windY = c.windY;
    sky.clouds.cover = c.cover;
    sky.clouds.offsetX = c.cloudVX * time;
    sky.clouds.offsetY = c.cloudVY * time;
  }

  /** Sun or moon, weather at the camera and the night tint's share into the cache. */
  private compute(sim: Simulation, cameraX: number, cameraY: number, tick: number, minute: number): void {
    const c = this.cache;
    this.cachedSim = sim;
    c.version++;
    c.tick = tick;
    c.minute = minute;
    const cal = sim.world.calendar;
    // The biome's night colour leans into the ambient as the daylight goes.
    c.tintShare = NIGHT_TINT_SHARE * (1 - cal.daylight);
    let lightFactor = 1;
    let cloudiness = 0;
    let windStrength = 0;
    let windX = 1;
    let windY = 0;
    if (sim.world.materialized) {
      const region = sim.world.regionAt(Math.floor(cameraX / TILE_PX), Math.floor(cameraY / TILE_PX));
      if (region !== NO_WEATHER_REGION) {
        const weather = sim.world.weather;
        const w = weather.sample(region, this.weather);
        lightFactor = w.lightFactor;
        cloudiness = w.cloudCover;
        windStrength = w.wind;
        const dir = windDirection(normalizeSeed(sim.config.seed), region, weather.periodCount(region));
        windX = DIR_DX[dir] ?? 1;
        windY = DIR_DY[dir] ?? 0;
      }
    }
    c.windX = windX * windStrength;
    c.windY = windY * windStrength;
    const d = c.directional;
    const sun = cal.sun(this.sun);
    if (sun.strength > 0) {
      const share = sunShare(sun.elevationDeg, sun.strength, lightFactor);
      const low = 1 - Math.min(1, Math.max(0, sun.elevationDeg / LOW_SUN_WARMTH_UNTIL_DEG));
      splitDaylight(share, DAYLIGHT.skyCoolness + LOW_SUN_WARMTH * low, d);
      d.relief = DAYLIGHT.relief;
      this.shadowOf(sun.dirX, sun.dirY, sun.length, sun.elevationDeg, d);
      c.cover = cloudCover(cloudiness);
    } else {
      const moon = cal.moon(this.moon);
      const share = moon.strength > 0 ? moonShare(moon.strength, BALANCE.calendar.moonShadowStrength) : 0;
      splitDaylight(share, MOON_WARMTH, d);
      d.relief = MOONLIGHT_PARAMS.relief;
      this.shadowOf(moon.dirX, moon.dirY, moon.length, moon.elevationDeg, d);
      // Clouds shade the moon too, as dark drifting patches.
      c.cover = share > 0 ? cloudCover(cloudiness) : 0;
    }
    // The cloud field's velocity: its offset at presentation time t is velocity · t.
    cloudOffset(windX, windY, windStrength, 1, this.velocity);
    c.cloudVX = this.velocity.offsetX;
    c.cloudVY = this.velocity.offsetY;
  }

  private shadowOf(dirX: number, dirY: number, length: number, elevationDeg: number, d: DirectionalLight): void {
    d.shadowX = dirX;
    d.shadowY = dirY;
    d.shadowLength = length;
    lightDirection(dirX, dirY, elevationDeg, d);
  }

  private buildingSystem(sim: Simulation): BuildingSystem | null {
    let b = this.buildingOf;
    if (b === null || b.sim !== sim) {
      const s = sim.systems.find((x) => x.id === BUILDING_SYSTEM_ID);
      b = { sim, system: s instanceof BuildingSystem ? s : null };
      this.buildingOf = b;
    }
    return b.system;
  }

  /** Night colour of the biome under the camera, or null. */
  private biomeNight(layer: Layer, x: number, y: number): Rgb | null {
    const v = this.view;
    if (v === null) return null;
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor(y / TILE_PX);
    const size = 1 << CHUNK_SHIFT;
    const c = v.chunks.get(layer, Math.floor(tx / size), Math.floor(ty / size));
    if (c === undefined) return null;
    return this.night[c.biome[(ty - c.cy * size) * size + (tx - c.cx * size)] ?? 0] ?? null;
  }

  /** Height level of a tile of the view's layer (0 where its chunk is not resident). */
  private level(tx: number, ty: number): number {
    const v = this.view;
    if (v === null) return 0;
    const size = 1 << CHUNK_SHIFT;
    const c = v.chunks.get(v.layer, Math.floor(tx / size), Math.floor(ty / size));
    return c === undefined ? 0 : (c.height[(ty - c.cy * size) * size + (tx - c.cx * size)] ?? 0);
  }
}
