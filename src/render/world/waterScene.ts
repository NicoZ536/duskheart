/**
 * The water of the game view (`RenderScene.water`, docs/RENDER.md §4; M5-07 … M5-09): what the water pass needs of
 * the session's world each frame, read from the simulation, never written –
 * - the **tile grid** around the camera: depth class, frozen, river/sea/lake, glacier ice, shore distance, level;
 * - the **sky** from calendar and weather at the camera (colours, stars, moon and its phase and place, sun glitter);
 *   underground no sky; the wind of the weather drives the small waves; a hard frost grows ice from the shore;
 * - **impulses** into the wave field: the player swimming or wading (stronger the faster), raindrops of the rain at
 *   the camera, fish in deep water now and then – drops and fish from fixed time slots hashed with the view, so the
 *   same presentation clock gives the same rings;
 * - the player's **immersion mask**: swimming – cut at the waterline of the swim frames (`wasserlinie` socket),
 *   the dressed body of the same facing drawn under water; wading in shallow water – ankle-deep.
 *
 * `gameScene.ts` calls `fill` once per frame after the figure is placed. No allocation per frame.
 */
import { BALANCE } from '../../content/balance';
import { FULL_MOON_PHASE, createShadowVector, moonPhaseOfNight, type ShadowVector } from '../../world/calendar';
import { createWeatherSample, type WeatherSample } from '../../world/climate/weather';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import { WATER_DEPTH_DEEP, WATER_DEPTH_MASK, WATER_FROZEN, WATER_LAKE, WATER_RIVER, WATER_SEA } from '../../world/model/chunk';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import type { Layer } from '../../world/model/coords';
import { createPlayerSample, type GameSession, type PlayerSample } from '../../game/session';
import type { Simulation } from '../../game/sim';
import type { AtlasManifest } from '../assets/atlas';
import type { PlayerFigure } from '../game/playerFigure';
import type { RenderScene } from '../scene';
import { CHUNK_TILES, TILE_PX } from '../tilemap/chunk';
import { shoreIcePx } from '../water/ice';
import { FISH, IMMERSION, RAIN_RIPPLES, SHORE_TILES, SKY } from '../water/params';
import { createSkyInput, waterSkyInto, type WaterSkyInput } from '../water/sky';
import { WATER_TILE, WATER_TILE_FLAG, WaterSky, type WaterState, type WaterTiles } from '../water/state';
import type { ChunkLookup } from './window';

/** The body sprite drawn under the water of a swimmer (dressed, one frame per facing) and the sprite with the swim frames. */
const BODY_SPRITE = 'spieler_koerper';
const SWIM_SPRITE = 'spieler_basis';
/** Clip names by facing (held strings: no string is built per frame). */
const SWIM_CLIPS = { down: 'swim_down', up: 'swim_up', left: 'swim_left', right: 'swim_right' } as const;
const IDLE_CLIPS = { down: 'idle_down', up: 'idle_up', left: 'idle_left', right: 'idle_right' } as const;
/** Half width of the player's drawing [px] (the 32-px cell's body, §4.4 "Körper ≈ 16 × 24"); a swimmer's box also spans its stroke. */
const FIGURE_HALF_WIDTH = 8;
/** Shore distance of a tile without land within `SHORE_TILES.searchTiles` tiles [px]: the nearest a land tile beyond can lie. */
const SHORE_CAP_PX = SHORE_TILES.searchTiles * TILE_PX + TILE_PX / 2;
/** Distance from a tile's centre to the tile (dx, dy) tiles away [px], row by row over −R … R. */
const TILE_RECT_DISTANCE = ((): Float32Array => {
  const r = SHORE_TILES.searchTiles;
  const side = 2 * r + 1;
  const out = new Float32Array(side * side);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) out[(dy + r) * side + dx + r] = Math.hypot(Math.max(0, Math.abs(dx) * TILE_PX - TILE_PX / 2), Math.max(0, Math.abs(dy) * TILE_PX - TILE_PX / 2));
  }
  return out;
})();
/** Area of one rain cell [px²] (drops per second are given per 10 000 px² of view). */
const RAIN_CELL_AREA = 10_000;
/** Deep tiles per fish rate unit. */
const FISH_TILES = 100;
/** Wind of the weather at which the small waves are fullest (`env.wind` is the weather's wind × 1.2). */
const FULL_WIND = 1.2;
/** Southward share of the wind direction (the weather's wind is signed along x; waves run a little towards the viewer). */
const WIND_DEPTH = 0.35;
/** The wind direction as a unit vector (x signed by the weather's wind). */
const WIND_X = 1 / Math.hypot(1, WIND_DEPTH);
const WIND_Y = WIND_DEPTH / Math.hypot(1, WIND_DEPTH);

/** What the filler needs of the page's binding. */
export interface WaterSceneBinding {
  readonly session: Pick<GameSession, 'sim' | 'samplePlayer'>;
  readonly host: ChunkLookup;
}

/** A 32-bit integer hash (deterministic, the same on every platform). */
export function slotHash(a: number, b: number, salt: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

export class WaterSceneFiller {
  private readonly sample: PlayerSample = createPlayerSample();
  private readonly weather: WeatherSample = createWeatherSample();
  private readonly sun: ShadowVector = createShadowVector();
  private readonly moon: ShadowVector = createShadowVector();
  private readonly skyInput: WaterSkyInput = createSkyInput();
  private readonly iceGround = contentWorldIdTables().terrain.runtimeId('eis');
  private lastTime = Number.NaN;
  /** The sky of the last sampling and when it was taken (calendar slot, weather region and period, layer), the shore ice then. */
  private readonly sky = new WaterSky();
  private skySlot = Number.NaN;
  private skyRegion = Number.NaN;
  private skyPeriod = Number.NaN;
  private skyLayer = Number.NaN;
  private iceWidth = 0;
  /** The tile grid filled last (screenshot scenarios read where the water is), and whether all its chunks were resident. */
  private lastTiles: WaterTiles | null = null;
  private gridComplete = false;
  /** Figures and impulses of the last frame and the CPU time of `fill` [ms] (tests, debugging, `__dh.call('waterInfo')`). */
  readonly stats = { immersed: 0, impulses: 0, raindrops: 0, fish: 0, prepMs: 0 };

  /**
   * Fills `scene.water` for the frame at presentation time `time`: camera centre (`cameraX`, `cameraY`) [world px]
   * of a `viewW` × `viewH` view on `layer`; `player` is the view's player figure (drawn this frame) or null.
   */
  fill(scene: RenderScene, binding: WaterSceneBinding, player: PlayerFigure | null, layer: Layer, cameraX: number, cameraY: number, viewW: number, viewH: number, time: number): void {
    const started = performance.now();
    const water = scene.water;
    const sim = binding.session.sim;
    const dt = Number.isFinite(this.lastTime) && time > this.lastTime ? time - this.lastTime : 0;
    const from = Number.isFinite(this.lastTime) && time >= this.lastTime ? this.lastTime : time;
    this.lastTime = time;
    this.fillTiles(water.tiles, binding.host, layer, cameraX, cameraY);
    this.lastTiles = water.tiles;
    this.fillSky(water, sim, layer, cameraX, cameraY, scene.env.wind);
    this.stats.immersed = 0;
    this.stats.raindrops = 0;
    this.stats.fish = 0;
    const hasPlayer = player !== null && binding.session.samplePlayer(this.sample) && this.sample.layer === layer;
    if (hasPlayer) this.player(water, scene.atlas?.manifest ?? null, player, dt);
    if (this.weather.precipitationKind === 'regen' && this.weather.precipitation > 0 && layer === 0) this.rain(water, cameraX, cameraY, viewW, viewH, from, time);
    if (water.tiles.deepTiles > 0) this.fish(water, from, time);
    this.stats.impulses = water.impulses.count;
    this.stats.prepMs = performance.now() - started;
  }

  /**
   * Depth class of tile (tx, ty) in the grid filled last (0 none or frozen, 1 shallow, 2 deep); −1 outside it, before
   * the first frame and while a chunk under the grid is still loading (a scenario searching the grid waits for it).
   */
  depthAt(tx: number, ty: number): number {
    const t = this.lastTiles;
    if (t === null || !this.gridComplete || t.offset(tx, ty) < 0) return -1;
    return (t.get(tx, ty, WATER_TILE.flags) & WATER_TILE_FLAG.frozen) !== 0 ? 0 : t.get(tx, ty, WATER_TILE.depth);
  }

  /** The tile grid around the camera, and its shore distances; bumps the version when anything changed. */
  private fillTiles(tiles: WaterTiles, chunks: ChunkLookup, layer: Layer, cameraX: number, cameraY: number): void {
    const ox = Math.floor(cameraX / TILE_PX) - Math.floor(tiles.width / 2);
    const oy = Math.floor(cameraY / TILE_PX) - Math.floor(tiles.height / 2);
    let changed = ox !== tiles.originTx || oy !== tiles.originTy || tiles.version === 0;
    tiles.originTx = ox;
    tiles.originTy = oy;
    tiles.known = true;
    let open = 0;
    let frozen = 0;
    let deep = 0;
    const d = tiles.data;
    let complete = true;
    let chunk = chunks.get(layer, Math.floor(ox / CHUNK_TILES), Math.floor(oy / CHUNK_TILES));
    let ccx = Math.floor(ox / CHUNK_TILES);
    let ccy = Math.floor(oy / CHUNK_TILES);
    for (let y = 0; y < tiles.height; y++) {
      const ty = oy + y;
      for (let x = 0; x < tiles.width; x++) {
        const tx = ox + x;
        const cx = Math.floor(tx / CHUNK_TILES);
        const cy = Math.floor(ty / CHUNK_TILES);
        if (cx !== ccx || cy !== ccy) {
          chunk = chunks.get(layer, cx, cy);
          ccx = cx;
          ccy = cy;
        }
        let depth = 0;
        let flags = 0;
        let level = 0;
        if (chunk === undefined) complete = false;
        else {
          const i = (ty - cy * CHUNK_TILES) * CHUNK_TILES + (tx - cx * CHUNK_TILES);
          const w = chunk.water[i] ?? 0;
          depth = (w & WATER_DEPTH_MASK) === WATER_DEPTH_DEEP ? 2 : (w & WATER_DEPTH_MASK) !== 0 ? 1 : 0;
          if ((w & WATER_FROZEN) !== 0) flags |= WATER_TILE_FLAG.frozen;
          if ((w & WATER_RIVER) !== 0) flags |= WATER_TILE_FLAG.river;
          if ((w & WATER_SEA) !== 0) flags |= WATER_TILE_FLAG.sea;
          if ((w & WATER_LAKE) !== 0) flags |= WATER_TILE_FLAG.lake;
          if (depth === 0 && chunk.ground[i] === this.iceGround) flags |= WATER_TILE_FLAG.iceGround;
          level = chunk.height[i] ?? 0;
        }
        if (depth > 0 && (flags & WATER_TILE_FLAG.frozen) === 0) {
          open++;
          if (depth === 2) deep++;
        }
        if ((flags & (WATER_TILE_FLAG.frozen | WATER_TILE_FLAG.iceGround)) !== 0) frozen++;
        const o = ((tiles.height - 1 - y) * tiles.width + x) * 4;
        if (d[o + WATER_TILE.depth] !== depth || d[o + WATER_TILE.flags] !== flags || d[o + WATER_TILE.level] !== level) {
          d[o + WATER_TILE.depth] = depth;
          d[o + WATER_TILE.flags] = flags;
          d[o + WATER_TILE.level] = level;
          changed = true;
        }
      }
    }
    this.gridComplete = complete;
    tiles.waterTiles = open;
    tiles.frozenTiles = frozen;
    tiles.deepTiles = deep;
    if (changed) {
      this.shoreDistances(tiles);
      tiles.version++;
    }
  }

  /**
   * Distance of every water tile to land [px]: from the tile's centre to the nearest land tile (frozen water counts
   * as land) within `SHORE_TILES.searchTiles` tiles, `SHORE_CAP_PX` beyond; 0 on land. Tiles outside the grid are
   * unknown, not land.
   */
  private shoreDistances(tiles: WaterTiles): void {
    const d = tiles.data;
    const w = tiles.width;
    const h = tiles.height;
    const S = WATER_TILE.shore;
    const R = SHORE_TILES.searchTiles;
    const side = 2 * R + 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if ((d[o + WATER_TILE.depth] ?? 0) === 0 || ((d[o + WATER_TILE.flags] ?? 0) & WATER_TILE_FLAG.frozen) !== 0) {
          d[o + S] = 0;
          continue;
        }
        let best = SHORE_CAP_PX;
        for (let dy = -R; dy <= R; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const n = (ny * w + nx) * 4;
            const land = (d[n + WATER_TILE.depth] ?? 0) === 0 || ((d[n + WATER_TILE.flags] ?? 0) & WATER_TILE_FLAG.frozen) !== 0;
            if (land) best = Math.min(best, TILE_RECT_DISTANCE[(dy + R) * side + dx + R] ?? SHORE_CAP_PX);
          }
        }
        d[o + S] = Math.round(best);
      }
    }
  }

  /**
   * Sky, wind and shore ice from calendar, weather and temperature at the camera. They change slowly: sampled when the
   * calendar time passes into a new slot of `SKY.refreshTicks` ticks – a jump of the clock (`setTime`, a loaded save)
   * lands in another slot at once –, when the weather region at the camera or its weather period changes (a forced
   * weather starts a new period) or the layer does; the frames in between reuse the last sample.
   */
  private fillSky(water: WaterState, sim: Simulation, layer: Layer, cameraX: number, cameraY: number, wind: number): void {
    const clock = sim.clock;
    const slot = Math.floor((clock.dawns * clock.ticksPerDay + clock.dayTick) / SKY.refreshTicks);
    const tx = Math.floor(cameraX / TILE_PX);
    const ty = Math.floor(cameraY / TILE_PX);
    const region = layer === 0 && sim.world.materialized ? sim.world.regionAt(tx, ty) : NO_WEATHER_REGION;
    const period = region === NO_WEATHER_REGION ? -1 : sim.world.weather.periodCount(region);
    if (slot !== this.skySlot || region !== this.skyRegion || period !== this.skyPeriod || layer !== this.skyLayer) {
      this.skySlot = slot;
      this.skyRegion = region;
      this.skyPeriod = period;
      this.skyLayer = layer;
      this.sampleSky(sim, layer, region, tx, ty);
    }
    water.sky.copy(this.sky);
    water.windX = wind < 0 ? -WIND_X : WIND_X;
    water.windY = WIND_Y;
    water.windStrength = Math.min(1, Math.abs(wind) / FULL_WIND);
    water.shoreIcePx = this.iceWidth;
  }

  private sampleSky(sim: Simulation, layer: Layer, region: number, tx: number, ty: number): void {
    const cal = sim.world.calendar;
    const input = this.skyInput;
    const w = this.weather;
    w.cloudCover = 0;
    w.precipitation = 0;
    w.precipitationKind = 'keiner';
    if (region !== NO_WEATHER_REGION) sim.world.weather.sample(region, w);
    cal.sun(this.sun);
    cal.moon(this.moon);
    input.daylight = cal.daylight;
    input.sunElevationDeg = this.sun.elevationDeg;
    input.sunStrength = this.sun.strength;
    input.moonElevationDeg = this.moon.elevationDeg;
    input.moonShadowX = this.moon.dirX;
    input.moonIllumination = cal.moonIllumination;
    input.moonWaxing = moonPhaseOfNight(cal.night) < FULL_MOON_PHASE;
    input.cloudCover = w.cloudCover;
    input.underground = layer !== 0;
    waterSkyInto(this.sky, input);
    this.iceWidth = layer === 0 && sim.world.materialized ? shoreIcePx(sim.world.temperature.temperatureAt(layer, tx, ty)) : 0;
  }

  /** The player in the water: impulses by speed, the immersion mask (swimming: body frame under the cut; wading: ankle-deep). */
  private player(water: WaterState, manifest: AtlasManifest | null, figure: PlayerFigure, dt: number): void {
    const s = this.sample;
    const x = figure.drawn.x;
    const y = figure.drawn.y;
    const tiles = water.tiles;
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor((y - 1) / TILE_PX);
    const depth = tiles.get(tx, ty, WATER_TILE.depth);
    const frozen = (tiles.get(tx, ty, WATER_TILE.flags) & WATER_TILE_FLAG.frozen) !== 0;
    const wading = !s.swimming && depth === 1 && !frozen;
    if (!s.swimming && !wading) return;
    let line: number = IMMERSION.wadeDepthPx;
    let top = 0;
    let half: number = FIGURE_HALF_WIDTH;
    if (manifest !== null) {
      const swim = manifest.sprites[SWIM_SPRITE];
      const clip = swim?.clips[SWIM_CLIPS[s.facing]];
      const frameIndex = clip?.frames[0] ?? 0;
      const frame = swim?.frames[frameIndex];
      top = frame?.ay ?? 0;
      const socket = swim?.sockets?.['wasserlinie']?.[frameIndex];
      if (s.swimming && frame !== undefined && socket !== undefined && socket !== null) line = frame.ay - socket[1];
      // The box of the figure in the water covers every frame of its clip: a swimmer's stroke reaches out with the hands.
      const frames = clip?.frames;
      if (s.swimming && swim !== undefined && frames !== undefined) {
        for (let i = 0; i < frames.length; i++) {
          const f = swim.frames[frames[i] ?? 0];
          if (f !== undefined) half = Math.max(half, f.ax, f.w - f.ax);
        }
      }
    }
    const slot = water.immersions.push(x, y, half, Math.max(top, line + 1), line);
    if (slot < 0) return;
    this.stats.immersed++;
    if (s.swimming && manifest !== null) this.bodyFrame(water, manifest, slot);
    const speed = Math.min(1, s.speed / (BALANCE.player.movement.swimTilesPerSecond * TILE_PX));
    water.impulse('figureIdle', x, y - line, dt);
    if (speed > 0) water.impulse('figure', x, y - line, dt * speed);
  }

  /** Gives immersion `slot` the dressed body of the swimmer's facing, lowered like the swim frames; returns the frame or −1. */
  private bodyFrame(water: WaterState, manifest: AtlasManifest, slot: number): number {
    const sprite = manifest.sprites[BODY_SPRITE];
    const clip = sprite?.clips[IDLE_CLIPS[this.sample.facing]];
    const index = clip?.frames[0];
    const frame = index === undefined ? undefined : sprite?.frames[index];
    if (frame === undefined || index === undefined) return -1;
    water.immersions.body(slot, frame.x, frame.y, frame.w, frame.h, frame.ax, frame.ay, false, 0, IMMERSION.swimSinkPx);
    return index;
  }

  /** Raindrops on the water: fixed time slots, each with as many drops as the rain gives the view (hashed positions). */
  private rain(water: WaterState, cameraX: number, cameraY: number, viewW: number, viewH: number, from: number, to: number): void {
    const perSlot = (RAIN_RIPPLES.dropsPerSecond * this.weather.precipitation * ((viewW * viewH) / RAIN_CELL_AREA)) / RAIN_RIPPLES.slotsPerSecond;
    const first = Math.floor(from * RAIN_RIPPLES.slotsPerSecond) + 1;
    const last = Math.floor(to * RAIN_RIPPLES.slotsPerSecond);
    const left = cameraX - viewW / 2;
    const top = cameraY - viewH / 2;
    for (let k = first; k <= last; k++) {
      for (let j = 0; j < perSlot; j++) {
        if (slotHash(k, j, 1) >= perSlot - j) continue;
        const x = Math.floor(left + slotHash(k, j, 2) * viewW);
        const y = Math.floor(top + slotHash(k, j, 3) * viewH);
        if (water.tiles.get(Math.floor(x / TILE_PX), Math.floor(y / TILE_PX), WATER_TILE.depth) === 0) continue;
        if (water.impulse('rain', x + 0.5, y + 0.5)) this.stats.raindrops++;
      }
    }
  }

  /** A fish snaps at the surface of a deep tile now and then (hashed slots and tiles). */
  private fish(water: WaterState, from: number, to: number): void {
    const tiles = water.tiles;
    const chance = (FISH.perSecond * tiles.deepTiles) / FISH_TILES / FISH.slotsPerSecond;
    const first = Math.floor(from * FISH.slotsPerSecond) + 1;
    const last = Math.floor(to * FISH.slotsPerSecond);
    for (let k = first; k <= last; k++) {
      if (slotHash(k, tiles.originTx, 11) >= chance) continue;
      // The n-th deep open tile of the grid (row by row from the north-west).
      let n = Math.floor(slotHash(k, tiles.originTy, 12) * tiles.deepTiles);
      for (let y = 0; y < tiles.height && n >= 0; y++) {
        for (let x = 0; x < tiles.width; x++) {
          const tx = tiles.originTx + x;
          const ty = tiles.originTy + y;
          if (tiles.get(tx, ty, WATER_TILE.depth) !== 2 || (tiles.get(tx, ty, WATER_TILE.flags) & WATER_TILE_FLAG.frozen) !== 0) continue;
          if (n-- > 0) continue;
          const px = (tx + slotHash(k, x, 13)) * TILE_PX;
          const py = (ty + slotHash(k, y, 14)) * TILE_PX;
          if (water.impulse('fish', px, py)) this.stats.fish++;
          n = -1;
          break;
        }
      }
    }
  }
}
