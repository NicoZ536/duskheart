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
 *   directions the fire spreads with); the **fog's** three layers drift with the weather's wind. Both offsets are
 *   integrated over the presentation clock and kept modulo their noise's period (`drift.ts`): a change of wind changes
 *   their speed, never their place.
 * - **Occluders:** raised terrain, cliff faces and rock (`light/terrainOccluders.ts`), walls, closed doors and fences
 *   (`light/buildingOccluders.ts`) in the view plus the occluder pass's margin; the build grid's sun casters (walls,
 *   doors, windows with their panes, roofs) in the same rectangle.
 *
 * Sun, moon, weather and the night tint are computed again only when due (`skyRefreshDue`: a new game minute, every
 * half second of a running simulation, once after it stopped on a tick the world reached outside the game loop's rhythm
 * – a scenario's or a command's steps); every frame copies the result and moves the clouds and the fog on. At a frame
 * rate above the tick rate the loop's ticks stand for a frame or two as well: they never count as stopped (M5-50).
 * Reads the simulation, never writes it; no allocation per frame.
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
import { BUILDING_SUN, CLOUD_PERIOD_PX, DAYLIGHT, MOONLIGHT_PARAMS, SDF, SUN_SHADOW } from '../light/params';
import { cloudCover, cloudOffset, lightDirection, moonShare, splitDaylight, sunShare } from '../light/skyMath';
import { DirectionalRecord, SKY_SLOT, SKY_VALUES, type DirectionalLight } from '../light/sky';
import { TerrainOccluders } from '../light/terrainOccluders';
import { FOG_LOOK } from '../passes/atmospherePass';
import type { RenderEnvironment, RenderScene } from '../scene';
import { TILE_SHIFT } from '../tilemap/chunk';
import { DRIFT_CLOCK_HZ, DriftOffset, driftClock } from './drift';
import type { ChunkSignatures } from './signature';
import type { ChunkLookup } from './window';

/** What the filler reads of the game view's frame. */
export interface SkyView {
  readonly layer: Layer;
  /** Rectangle whose tiles' occluders the frame gathers [world px; whole pixels read no float in the frame, §30]. */
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
/** Ticks per second of the simulation (the game loop advances the presentation clock by one tick's time per tick). */
const TICK_HZ = BALANCE.time.tickHz;
/** Tiles around the view whose houses still throw their evening shadow into it. */
const BUILDING_REACH_TILES = Math.ceil(Math.max(SDF.marginPx, SUN_SHADOW.maxLength * BUILDING_SUN.roofTopPx) / TILE_PX);
/** The fog banks' creep without wind [px/s] east and south (module constants: the frame computes no constant, §30). */
const FOG_CREEP = FOG_LOOK.creep;
const FOG_CREEP_SOUTH = FOG_LOOK.creep * FOG_LOOK.creepSouth;
/** Tiles of the occluder pass's margin around the view (whole tiles). */
const MARGIN_TILES = Math.ceil(SDF.marginPx / TILE_PX);


/**
 * Whether the sky computed at tick `computedTick` (game minute `computedMinute`) is due again at `tick` (`minute`),
 * the previous frame having shown tick `previousFrameTick`: after a jump back (another simulation, a loaded game), in a
 * new game minute, every `SKY_REFRESH_TICKS` ticks while the simulation runs, and once when it stopped on a tick not yet
 * computed that the world reached by `stepped` ticks (`loopStep` false: a scenario's commands, a still picture) – a
 * tick of the running game loop that stands for another frame (a frame rate above the tick rate) is no stop (M5-50).
 */
export function skyRefreshDue(computedTick: number, computedMinute: number, previousFrameTick: number, tick: number, minute: number, stepped: boolean): boolean {
  return tick < computedTick || minute !== computedMinute || tick - computedTick >= SKY_REFRESH_TICKS || (stepped && tick !== computedTick && tick === previousFrameTick);
}

/**
 * Whether the shown tick moving on by `ticks` while the drift clock moved by `clockTicks` (`driftClock` of the
 * presentation time) is one step of the game loop: one tick, and the presentation clock one tick's time further (the
 * loop adds 1/tickHz per tick; the drift clock's whole ticks round it by at most one). Anything else – several ticks at
 * once, ticks under a frozen or reset clock – the world reached outside the loop's rhythm (a scenario, a command, a
 * catch-up after a hitch). Whole numbers only (a frame computes no float, §30).
 */
export function loopStep(ticks: number, clockTicks: number): boolean {
  if (ticks !== 1) return false;
  const q = clockTicks * TICK_HZ;
  return q >= DRIFT_CLOCK_HZ - TICK_HZ && q <= DRIFT_CLOCK_HZ + TICK_HZ;
}

/** The filler's last computation of the sky. */
interface SkyCache {
  /** Counts the computations (the frame copies the directed light only when it changed). */
  version: number;
  tick: number;
  minute: number;
  tintShare: number;
  /** `tintShare` > 0 (a frame by day reads no float to find out). */
  tinted: boolean;
  windX: number;
  windY: number;
  cover: number;
  readonly directional: DirectionalRecord;
}

function createSkyCache(): SkyCache {
  return { version: 0, tick: -1, minute: -1, tintShare: 0, tinted: false, windX: 0, windY: 0, cover: 0, directional: new DirectionalRecord() };
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
  /** The cloud field's offset and the fog layers' (low mist, banks, high veils), drifting with the wind. */
  private readonly clouds = new DriftOffset(CLOUD_PERIOD_PX, CLOUD_PERIOD_PX);
  private readonly fog: readonly [DriftOffset, DriftOffset, DriftOffset] = [
    new DriftOffset(FOG_LOOK.tileLow, FOG_LOOK.tileLow, FOG_LOOK.layerDrift[0]),
    new DriftOffset(FOG_LOOK.tileMid, FOG_LOOK.tileMid, FOG_LOOK.layerDrift[1]),
    new DriftOffset(FOG_LOOK.tileHigh, FOG_LOOK.tileHigh, FOG_LOOK.layerDrift[2]),
  ];
  /** Whose wind the fog's velocity was set from: none yet, the cave's (none: it creeps), the weather's at the last sky computation. */
  private fogWindOf: 'none' | 'cave' | 'weather' = 'none';
  private cachedSim: Simulation | null = null;
  private lastTick = -1;
  /** The drift clock of the previous frame, and whether the shown tick last moved on outside the loop's rhythm (`loopStep`). */
  private lastClock = 0;
  private stepped = true;
  /**
   * The scene record the directed light was last copied into, the computation it came from and the record's version
   * after the copy (another writer since: copied again).
   */
  private copiedTo: RenderScene['sky'] | null = null;
  private copiedVersion = -1;
  private copiedRecord = -1;
  /**
   * Wind, cloud cover and cloud offset every frame hands to `scene.sky` (`SkyState.values`, one copy), and the offset
   * [1/DRIFT_UNITS px] its px were formed for.
   */
  private readonly skyValues = new Float64Array(SKY_VALUES);
  private cloudX = 0;
  private cloudY = 0;
  private cloudsKnown = false;
  /**
   * What the ambient in the environment record `ambientEnv` was last made of (`ambient`): the game view's base colour
   * (its version), the sky computation whose night tint went in (−1: none) and the biome's night colour.
   */
  private ambientEnv: RenderEnvironment | null = null;
  private ambientBase = -1;
  private ambientSky = -1;
  private ambientTint: Rgb | null = null;

  /** Occluder runs of the terrain rebuilt in the last frame (tests, info). */
  get terrainRebuilt(): number {
    return this.terrain.rebuilt;
  }

  fill(scene: RenderScene, sim: Simulation, view: SkyView, cameraX: number, cameraY: number, time: number, worldTiles: number): void {
    this.view = view;
    const sky = scene.sky;
    const layer = view.layer;
    // Occluders around the view (whole tiles, plus the flood margin of the occluder pass).
    const vx0 = Math.floor(view.left) >> TILE_SHIFT;
    const vy0 = Math.floor(view.top) >> TILE_SHIFT;
    const vx1 = Math.floor(view.right) >> TILE_SHIFT;
    const vy1 = Math.floor(view.bottom) >> TILE_SHIFT;
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
    const clock = driftClock(time);
    const tick = sim.tick;
    if (layer !== 0) {
      // Underground the fog creeps without wind (cave mist); there is no sky.
      if (this.fogWindOf !== 'cave') this.fogWind(0, 'cave');
      this.driftFog(sky.fogDrift, clock, tick);
      return;
    }
    // Sun, moon, weather and the night tint drift slowly: computed again when the simulation stopped on a new tick
    // (a scenario, a command), every SKY_REFRESH_TICKS ticks while it runs and when the game minute changes; in
    // between the frame takes the last result (no float arithmetic per frame in code that runs once a frame). The fog
    // takes the weather's wind (`env.wind`) with it.
    const c = this.cache;
    const minute = sim.world.calendar.clock.minuteOfDay;
    if (tick !== this.lastTick) this.stepped = !loopStep(tick - this.lastTick, clock - this.lastClock);
    const stale = sim !== this.cachedSim || skyRefreshDue(c.tick, c.minute, this.lastTick, tick, minute, this.stepped);
    this.lastTick = tick;
    this.lastClock = clock;
    if (stale) {
      this.compute(sim, cameraX, cameraY, tick, minute);
      this.fogWind(scene.env.wind, 'weather');
    }
    this.driftFog(sky.fogDrift, clock, tick);
    // The directed light's record keeps its values between frames (`SkyState.beginFrame` only puts it out): a frame
    // after the last computation lights it again.
    const d = sky.directional;
    if (this.copiedTo !== sky || this.copiedVersion !== c.version || this.copiedRecord !== d.version) {
      d.copyFrom(c.directional);
      this.copiedTo = sky;
      this.copiedVersion = c.version;
      this.copiedRecord = d.version;
    } else d.relight();
    // The cloud field's offset in px: formed again only when it moved by a unit (§30). Wind, cover and offset go into the
    // scene's record with one copy (no float is read).
    const clouds = this.clouds;
    clouds.advance(clock, tick);
    const v = this.skyValues;
    if (clouds.x !== this.cloudX || clouds.y !== this.cloudY || !this.cloudsKnown) {
      this.cloudX = clouds.x;
      this.cloudY = clouds.y;
      this.cloudsKnown = true;
      v[SKY_SLOT.offsetX] = clouds.xPx;
      v[SKY_SLOT.offsetY] = clouds.yPx;
    }
    sky.values.set(v);
  }

  /**
   * The frame's ambient colour into `env`: the game view's `base` colour (R, G, B from index `offset`; `baseVersion`
   * counts its changes) – on the surface at night and dusk leaning towards the night colour of the biome under the camera
   * (`colorIdentity.night`, by the last sky computation's share). Written only when one of them changed or another record
   * is filled (§30: a still frame writes nothing – the record keeps its colour). Call after `fill`.
   */
  ambient(env: RenderEnvironment, base: Float64Array, offset: number, baseVersion: number, layer: Layer, cameraX: number, cameraY: number): void {
    const c = this.cache;
    const tint = layer === 0 && c.tinted ? this.biomeNight(layer, cameraX, cameraY) : null;
    const skyVersion = tint === null ? -1 : c.version;
    if (env === this.ambientEnv && baseVersion === this.ambientBase && skyVersion === this.ambientSky && tint === this.ambientTint) return;
    this.ambientEnv = env;
    this.ambientBase = baseVersion;
    this.ambientSky = skyVersion;
    this.ambientTint = tint;
    const r = base[offset] as number;
    const g = base[offset + 1] as number;
    const b = base[offset + 2] as number;
    if (tint === null) {
      env.ambientR = r;
      env.ambientG = g;
      env.ambientB = b;
      return;
    }
    const k = c.tintShare;
    env.ambientR = r + (tint[0] - r) * k;
    env.ambientG = g + (tint[1] - g) * k;
    env.ambientB = b + (tint[2] - b) * k;
  }

  /**
   * The fog's velocity from the signed wind `wind` (`env.wind`; 0 underground): the banks creep south-east and drift with
   * the wind, each layer at its share of the banks' speed.
   */
  private fogWind(wind: number, of: 'cave' | 'weather'): void {
    this.fogWindOf = of;
    const vx = FOG_CREEP + wind * FOG_LOOK.wind;
    for (const layer of this.fog) layer.setVelocity(vx, FOG_CREEP_SOUTH);
  }

  /** The fog layers' offsets at drift clock `clock` into `out` (x, y of low, mid, high [1/DRIFT_UNITS px]). */
  private driftFog(out: Float32Array, clock: number, tick: number): void {
    const fog = this.fog;
    for (let i = 0; i < fog.length; i++) {
      const layer = fog[i];
      if (layer === undefined) continue;
      layer.advance(clock, tick);
      layer.store(out, 2 * i);
    }
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
    c.tinted = c.tintShare > 0;
    let lightFactor = 1;
    let cloudiness = 0;
    let windStrength = 0;
    let windX = 1;
    let windY = 0;
    if (sim.world.materialized) {
      const region = sim.world.regionAt(Math.floor(cameraX) >> TILE_SHIFT, Math.floor(cameraY) >> TILE_SHIFT);
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
    const v = this.skyValues;
    v[SKY_SLOT.windX] = c.windX;
    v[SKY_SLOT.windY] = c.windY;
    const d = c.directional;
    const sun = cal.sun(this.sun);
    if (sun.strength > 0) {
      const share = sunShare(sun.elevationDeg, sun.strength, lightFactor);
      const low = 1 - Math.min(1, Math.max(0, sun.elevationDeg / LOW_SUN_WARMTH_UNTIL_DEG));
      splitDaylight(share, DAYLIGHT.skyCoolness + LOW_SUN_WARMTH * low, d);
      d.relief = DAYLIGHT.relief;
      this.shadowOf(sun.dirX, sun.dirY, sun.length, sun.elevationDeg, d);
      c.cover = cloudCover(cloudiness);
      v[SKY_SLOT.cover] = c.cover;
    } else {
      const moon = cal.moon(this.moon);
      const share = moon.strength > 0 ? moonShare(moon.strength, BALANCE.calendar.moonShadowStrength) : 0;
      splitDaylight(share, MOON_WARMTH, d);
      d.relief = MOONLIGHT_PARAMS.relief;
      this.shadowOf(moon.dirX, moon.dirY, moon.length, moon.elevationDeg, d);
      // Clouds shade the moon too, as dark drifting patches.
      c.cover = share > 0 ? cloudCover(cloudiness) : 0;
      v[SKY_SLOT.cover] = c.cover;
    }
    // The cloud field's velocity [px/s] (its offset over one second): the frame integrates it (`drift.ts`).
    cloudOffset(windX, windY, windStrength, 1, this.velocity);
    this.clouds.setVelocity(this.velocity.offsetX, this.velocity.offsetY);
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
    const tx = Math.floor(x) >> TILE_SHIFT;
    const ty = Math.floor(y) >> TILE_SHIFT;
    const size = 1 << CHUNK_SHIFT;
    const c = v.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (c === undefined) return null;
    return this.night[c.biome[(ty - c.cy * size) * size + (tx - c.cx * size)] ?? 0] ?? null;
  }

  /** Height level of a tile of the view's layer (0 where its chunk is not resident). */
  private level(tx: number, ty: number): number {
    const v = this.view;
    if (v === null) return 0;
    const size = 1 << CHUNK_SHIFT;
    const c = v.chunks.get(v.layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    return c === undefined ? 0 : (c.height[(ty - c.cy * size) * size + (tx - c.cx * size)] ?? 0);
  }
}
