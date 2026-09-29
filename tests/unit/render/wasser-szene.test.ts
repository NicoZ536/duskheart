/**
 * M5-07 … M5-09: what the game view hands the water pass (`src/render/world/waterScene.ts`). The tile grid around the
 * camera carries depth class, frozen/river/sea/lake/glacier flags, level and the Chebyshev distance to the shore and
 * changes its version only when its content does; the player gets an immersion mask – swimming at the waterline of the
 * swim frames with the dressed body under water, wading ankle-deep in the shallows – and kicks the waves by speed;
 * raindrops and fish come from fixed time slots, so the same stretch of presentation time gives the same rings however
 * it is cut into frames; the swim frames and the renderer agree on how deep the swimmer sinks.
 */
import { describe, expect, it } from 'vitest';
import { SCHWIMM_TIEFE, WASSERLINIE_Y } from '../../../assets-src/sprites/figuren/_spieler_sonder';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import type { PlayerFigure } from '../../../src/render/game/playerFigure';
import { RenderScene } from '../../../src/render/scene';
import { IMMERSION, IMPULSES, SHORE_TILES, SKY } from '../../../src/render/water/params';
import { WATER_TILE, WATER_TILE_FLAG } from '../../../src/render/water/state';
import { slotHash, WaterSceneFiller, type WaterSceneBinding } from '../../../src/render/world/waterScene';
import { createPlayerSample, type PlayerSample } from '../../../src/game/session';
import type { Simulation } from '../../../src/game/sim';
import { ChunkData, WATER_DEPTH_DEEP, WATER_DEPTH_SHALLOW, WATER_FROZEN, WATER_LAKE, WATER_SEA } from '../../../src/world/model/chunk';
import type { Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { createShadowVector, type ShadowVector } from '../../../src/world/calendar';
import type { WeatherSample } from '../../../src/world/climate/weather';

const CS = 32;
const TILE = 16;

/** One chunk at (0, 0): a lake of deep water (tiles 10…19 × 10…19) ringed by shallows, a frozen pond, glacier ice. */
function lakeChunk(): ChunkData {
  const c = new ChunkData(0, 0, 0);
  for (let y = 9; y <= 20; y++) for (let x = 9; x <= 20; x++) c.water[y * CS + x] = WATER_DEPTH_SHALLOW | WATER_LAKE;
  for (let y = 10; y <= 19; y++) for (let x = 10; x <= 19; x++) c.water[y * CS + x] = WATER_DEPTH_DEEP | WATER_LAKE;
  c.water[3 * CS + 3] = WATER_DEPTH_DEEP | WATER_FROZEN | WATER_SEA;
  c.ground[5 * CS + 25] = contentWorldIdTables().terrain.runtimeId('eis');
  c.height[5 * CS + 25] = 2;
  return c;
}

interface FakeWorld {
  weather: WeatherSample | null;
  temperatureC: number;
}

/** A simulation stand-in: calendar at noon in summer, optionally a world with weather and temperature. */
function fakeSim(world: FakeWorld): Simulation {
  const sun: ShadowVector = { ...createShadowVector(), elevationDeg: 50, strength: 1 };
  const calendar = {
    daylight: 1,
    moonIllumination: 0.5,
    night: 2,
    sun: (out: ShadowVector) => Object.assign(out, sun),
    moon: (out: ShadowVector) => Object.assign(out, createShadowVector()),
  };
  const materialized = world.weather !== null;
  // The calendar time moves on by a sampling slot of the water sky with every read (each frame samples anew).
  const clock = { dayTick: 0 };
  return {
    clock: {
      dawns: 0,
      ticksPerDay: 86_400,
      get dayTick() {
        clock.dayTick += SKY.refreshTicks;
        return clock.dayTick;
      },
    },
    world: {
      calendar,
      materialized,
      regionAt: () => 0,
      weather: { periodCount: () => 1, sample: (_region: number, out: WeatherSample) => Object.assign(out, world.weather) },
      temperature: { temperatureAt: () => world.temperatureC },
    },
  } as unknown as Simulation;
}

function binding(chunks: Map<string, ChunkData>, sim: Simulation, player: Partial<PlayerSample> | null): WaterSceneBinding {
  return {
    session: {
      sim,
      samplePlayer: (out: PlayerSample) => {
        if (player === null) return false;
        Object.assign(out, createPlayerSample(), player);
        return true;
      },
    },
    host: { get: (layer: Layer, cx: number, cy: number) => chunks.get(`${layer}:${cx}:${cy}`) },
  };
}

function figureAt(x: number, y: number): PlayerFigure {
  return { drawn: { x, y, heightBase: 0 } } as unknown as PlayerFigure;
}

function manifest(): AtlasManifest {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
}

const calm: FakeWorld = { weather: null, temperatureC: 10 };

describe('water tile grid', () => {
  it('carries depth, flags, level and shore distance of the tiles around the camera', () => {
    const chunks = new Map([['0:0:0', lakeChunk()]]);
    const scene = new RenderScene();
    const f = new WaterSceneFiller();
    scene.beginFrame(1);
    f.fill(scene, binding(chunks, fakeSim(calm), null), null, 0, 15 * TILE, 15 * TILE, 480, 270, 1);
    const t = scene.water.tiles;
    expect(t.known).toBe(true);
    expect(t.get(15, 15, WATER_TILE.depth)).toBe(2);
    expect(t.get(9, 15, WATER_TILE.depth)).toBe(1);
    expect(t.get(8, 15, WATER_TILE.depth)).toBe(0);
    expect(t.get(15, 15, WATER_TILE.flags) & WATER_TILE_FLAG.lake).toBe(WATER_TILE_FLAG.lake);
    expect(t.get(3, 3, WATER_TILE.flags) & (WATER_TILE_FLAG.frozen | WATER_TILE_FLAG.sea)).toBe(WATER_TILE_FLAG.frozen | WATER_TILE_FLAG.sea);
    expect(t.get(25, 5, WATER_TILE.flags) & WATER_TILE_FLAG.iceGround).toBe(WATER_TILE_FLAG.iceGround);
    expect(t.get(25, 5, WATER_TILE.level)).toBe(2);
    // Distance from the tile's centre to the nearest land tile [px]: half a tile per step inwards, capped where no
    // land lies within SHORE_TILES.searchTiles tiles; 0 on land and on frozen water.
    expect([9, 10, 11, 12].map((x) => t.get(x, 15, WATER_TILE.shore))).toEqual([8, 24, 40, 56]);
    expect(t.get(15, 15, WATER_TILE.shore)).toBe(SHORE_TILES.searchTiles * TILE + TILE / 2);
    expect(t.get(10, 12, WATER_TILE.shore)).toBe(24);
    expect(t.get(8, 15, WATER_TILE.shore)).toBe(0);
    expect(t.get(3, 3, WATER_TILE.shore)).toBe(0);
    // Open water: 12 × 12 lake; deep: its 10 × 10 core; frozen or glacier: two tiles.
    expect([t.waterTiles, t.deepTiles, t.frozenTiles]).toEqual([144, 100, 2]);
  });

  it('bumps its version only when its content or place changes', () => {
    const lake = lakeChunk();
    const chunks = new Map([['0:0:0', lake]]);
    const scene = new RenderScene();
    const f = new WaterSceneFiller();
    const b = binding(chunks, fakeSim(calm), null);
    scene.beginFrame(1);
    f.fill(scene, b, null, 0, 300, 300, 480, 270, 1);
    const v = scene.water.tiles.version;
    scene.beginFrame(2);
    f.fill(scene, b, null, 0, 300, 300, 480, 270, 2);
    expect(scene.water.tiles.version).toBe(v);
    lake.water[15 * CS + 15] = (lake.water[15 * CS + 15] ?? 0) | WATER_FROZEN;
    scene.beginFrame(3);
    f.fill(scene, b, null, 0, 300, 300, 480, 270, 3);
    expect(scene.water.tiles.version).toBe(v + 1);
    scene.beginFrame(4);
    f.fill(scene, b, null, 0, 300 + TILE, 300, 480, 270, 4);
    expect(scene.water.tiles.version).toBe(v + 2);
  });
});

describe('what the scenarios read of the grid, and the sky of every frame', () => {
  it('depthAt: the depth classes once every chunk under the grid is loaded, −1 before and outside it', () => {
    const chunks = new Map([['0:0:0', lakeChunk()]]);
    const scene = new RenderScene();
    const f = new WaterSceneFiller();
    const b = binding(chunks, fakeSim(calm), null);
    expect(f.depthAt(15, 15)).toBe(-1);
    // The grid around tile (15, 15) reaches into the chunks west of (0, 0): still loading.
    scene.beginFrame(1);
    f.fill(scene, b, null, 0, 15 * TILE, 15 * TILE, 480, 270, 1);
    expect(f.depthAt(15, 15)).toBe(-1);
    chunks.set('0:-1:0', new ChunkData(0, -1, 0));
    chunks.set('0:1:0', new ChunkData(0, 1, 0));
    scene.beginFrame(2);
    f.fill(scene, b, null, 0, 15 * TILE, 15 * TILE, 480, 270, 2);
    expect([f.depthAt(15, 15), f.depthAt(9, 15), f.depthAt(8, 15)]).toEqual([2, 1, 0]);
    // Frozen water counts as none (nobody swims in it), a tile outside the grid is unknown.
    expect(f.depthAt(3, 3)).toBe(0);
    expect(f.depthAt(15, 200)).toBe(-1);
  });

  it('samples calendar and weather per slot of calendar time, at once after a clock jump or a new weather period', () => {
    const chunks = new Map([['0:0:0', lakeChunk()]]);
    const scene = new RenderScene();
    const f = new WaterSceneFiller();
    const clear = { state: 'klar', previous: 'klar', blend: 1, cloudCover: 0, wind: 0.1, precipitation: 0, precipitationKind: 'keiner', haze: 0, lightFactor: 1, temperatureOffsetC: 0 } as const;
    const calendar = { daylight: 1, moonIllumination: 0, night: 2, sun: (o: ShadowVector) => Object.assign(o, { ...createShadowVector(), elevationDeg: 50, strength: 1 }), moon: (o: ShadowVector) => Object.assign(o, createShadowVector()) };
    const clock = { dawns: 0, ticksPerDay: 86_400, dayTick: 36_000 };
    const weather = { period: 1, sample: { ...clear } as WeatherSample };
    const sim = {
      clock,
      world: {
        calendar,
        materialized: true,
        regionAt: () => 0,
        weather: { periodCount: () => weather.period, sample: (_r: number, out: WeatherSample) => Object.assign(out, weather.sample) },
        temperature: { temperatureAt: () => 12 },
      },
    } as unknown as Simulation;
    const b = binding(chunks, sim, null);
    const frame = (t: number): void => {
      scene.beginFrame(t);
      f.fill(scene, b, null, 0, 240, 240, 480, 270, t);
    };
    frame(1);
    expect(scene.water.sky.stars).toBe(0);
    // Within the slot the last sample stands (the sky changes slowly).
    calendar.daylight = 0;
    clock.dayTick += 1;
    frame(1 + 1 / 60);
    expect(scene.water.sky.stars).toBe(0);
    // `setTime 23:00` moves the calendar (not the tick counter): the next frame shows the night.
    clock.dayTick += 12 * 3600;
    frame(1 + 2 / 60);
    expect(scene.water.sky.stars).toBe(1);
    expect(scene.water.sky.share).toBeCloseTo(SKY.nightShare, 6);
    // `setWeather` starts a new period: the clouds show at once.
    weather.sample = { ...clear, state: 'bewoelkt', cloudCover: 1 };
    weather.period = 2;
    frame(1 + 3 / 60);
    expect(scene.water.sky.stars).toBe(0);
  });

  it('M5-43: hands the water the tick of the world it shows – the key of its drifts (a world stepped under a frozen clock: a still picture)', () => {
    const chunks = new Map([['0:0:0', lakeChunk()]]);
    const scene = new RenderScene();
    const f = new WaterSceneFiller();
    const world = { tick: 700 };
    const sim = Object.defineProperty({ ...(fakeSim(calm) as unknown as Record<string, unknown>) }, 'tick', { get: () => world.tick }) as unknown as Simulation;
    const b = binding(chunks, sim, null);
    const frame = (t: number): number => {
      scene.beginFrame(t);
      f.fill(scene, b, null, 0, 240, 240, 480, 270, t);
      return scene.water.stepKey;
    };
    expect(frame(4)).toBe(700);
    // A scenario's command steps the world while the clock stands: the key changes (within the sky's sampling slot too).
    world.tick = 701;
    expect(frame(4)).toBe(701);
    expect(frame(4)).toBe(701);
    // A new frame starts without a world until the filler sets it.
    scene.beginFrame(5);
    expect(scene.water.stepKey).toBe(0);
  });
});

describe('the player in the water', () => {
  it('swimming: cut at the waterline of the swim frames, the dressed body under water, waves by speed', () => {
    const chunks = new Map([['0:0:0', lakeChunk()]]);
    const scene = new RenderScene();
    scene.atlas = { manifest: manifest(), albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
    const f = new WaterSceneFiller();
    const x = 15 * TILE + 8;
    const y = 15 * TILE + 12;
    const b = binding(chunks, fakeSim(calm), { layer: 0, swimming: true, facing: 'down', speed: 40 });
    scene.beginFrame(1);
    f.fill(scene, b, figureAt(x, y), 0, x, y, 480, 270, 1);
    scene.beginFrame(1 + 1 / 30);
    f.fill(scene, b, figureAt(x, y), 0, x, y, 480, 270, 1 + 1 / 30);
    const m = scene.water.immersions;
    expect(m.count).toBe(1);
    expect([m.x[0], m.y[0]]).toEqual([x, y]);
    expect(m.line[0]).toBe(31 - WASSERLINIE_Y);
    // The box spans every frame of the stroke (the hands reach out): the mirror search skips all of the swimmer.
    const swim = scene.atlas.manifest.sprites['spieler_basis'];
    const stroke = (swim?.clips['swim_down']?.frames ?? []).map((i) => swim?.frames[i]);
    expect(stroke.length).toBeGreaterThan(1);
    for (const fr of stroke) expect(m.halfWidth[0]).toBeGreaterThanOrEqual(Math.max(fr?.ax ?? 99, (fr?.w ?? 0) - (fr?.ax ?? 0)));
    expect(m.frameW[0]).toBeGreaterThan(0);
    expect(m.sink[0]).toBe(IMMERSION.swimSinkPx);
    // An idle bob and the push of the stroke, both over the frame's time, at the waterline.
    const k = scene.water.impulses;
    expect(k.count).toBe(2);
    expect(k.y[0]).toBe(y - m.line[0]!);
    expect(k.strength[0]).toBeCloseTo(IMPULSES.figureIdle.strength / 30, 5);
    expect(k.strength[1]).toBeGreaterThan(0);
  });

  it('wading in the shallows: ankle-deep, the drawn figure cut; on land or frozen water: nothing', () => {
    const lake = lakeChunk();
    const chunks = new Map([['0:0:0', lake]]);
    const scene = new RenderScene();
    const f = new WaterSceneFiller();
    const b = binding(chunks, fakeSim(calm), { layer: 0, swimming: false, facing: 'up', speed: 0 });
    scene.beginFrame(1);
    f.fill(scene, b, figureAt(9 * TILE + 8, 15 * TILE + 10), 0, 240, 240, 480, 270, 1);
    expect(scene.water.immersions.count).toBe(1);
    expect(scene.water.immersions.line[0]).toBe(IMMERSION.wadeDepthPx);
    expect(scene.water.immersions.frameW[0]).toBe(0);
    scene.beginFrame(2);
    f.fill(scene, b, figureAt(5 * TILE + 8, 5 * TILE + 10), 0, 240, 240, 480, 270, 2);
    expect(scene.water.immersions.count).toBe(0);
    scene.beginFrame(3);
    f.fill(scene, b, figureAt(3 * TILE + 8, 3 * TILE + 10), 0, 240, 240, 480, 270, 3);
    expect(scene.water.immersions.count).toBe(0);
  });

  it('the renderer lowers the body like the swim frames sink the figure', () => {
    expect(IMMERSION.swimSinkPx).toBe(SCHWIMM_TIEFE);
  });
});

describe('raindrops and fish', () => {
  const rain: FakeWorld = {
    weather: { state: 'regen', previous: 'regen', blend: 1, cloudCover: 0.9, wind: 0.2, precipitation: 1, precipitationKind: 'regen', haze: 0, lightFactor: 0.7, temperatureOffsetC: -3 },
    temperatureC: 12,
  };

  /** Impulses of the rain over [1, 2] s with frames of `dt`, as sorted position strings. */
  const drops = (dt: number): string[] => {
    const chunks = new Map([['0:0:0', lakeChunk()]]);
    const scene = new RenderScene();
    const f = new WaterSceneFiller();
    const b = binding(chunks, fakeSim(rain), null);
    const out: string[] = [];
    const frames = Math.round(1 / dt);
    for (let i = 0; i <= frames; i++) {
      const t = 1 + i * dt;
      scene.beginFrame(t);
      f.fill(scene, b, null, 0, 15 * TILE, 15 * TILE, 480, 270, t);
      const k = scene.water.impulses;
      for (let j = 0; j < k.count; j++) if (k.strength[j] === Math.fround(IMPULSES.rain.strength)) out.push(`${k.x[j]},${k.y[j]}`);
    }
    return out.sort();
  };

  it('fall on the water only, the same drops however the time is cut into frames', () => {
    const a = drops(1 / 60);
    const b = drops(1 / 30);
    expect(a.length).toBeGreaterThan(10);
    expect(b).toEqual(a);
    for (const p of a) {
      const [x, y] = p.split(',').map(Number) as [number, number];
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      expect(tx >= 9 && tx <= 20 && ty >= 9 && ty <= 20).toBe(true);
    }
  });

  it('the slot hash is deterministic and spreads over [0, 1)', () => {
    let sum = 0;
    for (let k = 0; k < 2000; k++) {
      const h = slotHash(k, 7, 3);
      expect(h).toBe(slotHash(k, 7, 3));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      sum += h;
    }
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
  });

  it('fish snap at the surface of deep water now and then', () => {
    const chunks = new Map([['0:0:0', lakeChunk()]]);
    const scene = new RenderScene();
    const f = new WaterSceneFiller();
    const b = binding(chunks, fakeSim(calm), null);
    let fish = 0;
    for (let i = 0; i <= 60 * 30; i++) {
      const t = i / 30;
      scene.beginFrame(t);
      f.fill(scene, b, null, 0, 15 * TILE, 15 * TILE, 480, 270, t);
      const k = scene.water.impulses;
      for (let i = 0; i < k.count; i++) {
        if (k.strength[i] !== Math.fround(IMPULSES.fish.strength)) continue;
        fish++;
        expect(scene.water.tiles.get(Math.floor((k.x[i] ?? 0) / TILE), Math.floor((k.y[i] ?? 0) / TILE), WATER_TILE.depth)).toBe(2);
      }
    }
    // 100 deep tiles at 0.35 per second and 100 tiles: about 21 in a minute.
    expect(fish).toBeGreaterThan(8);
    expect(fish).toBeLessThan(40);
  });
});
