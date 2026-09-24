/**
 * M3-21 – the gameplay light map (MASTERPROMPT §12.1): stages, ambient light of the calendar and the
 * weather, per-tile levels from the canonical light model of the shader, bilinear sampling, tile-raycast
 * occlusion against walls and cliffs, the per-light occlusion cache with invalidation, and the one light
 * source list that the light map and the renderer both read.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { lightLevelAt, LIGHT_FULL_CIRCLE } from '../../../src/engine/lightFalloff';
import { nightAmbientLight } from '../../../src/world/calendar';
import { CollisionGrid } from '../../../src/world/collision/tiles';
import { ambientLevel, surfaceAmbient } from '../../../src/world/lightmap/ambient';
import { GameplayLightMap, steadyLightLevel, type MapLight } from '../../../src/world/lightmap/lightmap';
import { OcclusionCache, rayVisible, traceVisibility, windowSize } from '../../../src/world/lightmap/occlusion';
import { lightStage } from '../../../src/world/lightmap/stages';
import { TILE_PX } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { paletteLight } from '../../../src/render/light/lightColors';
import { RenderScene } from '../../../src/render/scene';
import { createLightFrame, LightBridge } from '../../../src/render/game/lights';
import { draw, OFFSET, TestChunks, WORLD_TILES } from '../game/spieler-testwelt';
import { lightWorld } from '../game/licht-testwelt';
import { createSimulation } from '../../../src/game/setup';
import type { LightSystem } from '../../../src/game/light/system';
import { createWeatherSample } from '../../../src/world/climate/weather';

const IDS = contentWorldIdTables();
const FELS = IDS.terrain.runtimeId('fels');

/** A light on the ground of tile (tx, ty) with the torch's shape. */
function torchAt(id: number, tx: number, ty: number, over: Partial<MapLight> = {}): MapLight {
  return {
    id,
    layer: 0,
    windowTiles: BALANCE.light.torch.radiusTiles,
    x: (tx + 0.5) * TILE_PX,
    y: (ty + 0.5) * TILE_PX,
    height: BALANCE.light.torch.flameHeightPx.stand,
    radius: BALANCE.light.torch.radiusTiles * TILE_PX,
    intensity: BALANCE.light.torch.intensity,
    flicker: BALANCE.light.torch.flicker,
    seed: id,
    coneDirection: 0,
    coneAngle: LIGHT_FULL_CIRCLE,
    ...over,
  };
}

/** A light map over hand-drawn `rows` (at OFFSET) with the given lights and ambient. */
function mapOver(rows: readonly string[], lights: MapLight[], ambient = 0): { map: GameplayLightMap; grid: CollisionGrid; chunks: TestChunks } {
  const chunks = new TestChunks();
  draw(chunks, rows);
  const grid = new CollisionGrid({ chunks, worldTiles: WORLD_TILES, memo: true, epoch: () => 0 });
  const map = new GameplayLightMap({ lights: () => lights, ambient: () => ambient, occluders: grid }, BALANCE.light.map.movingCacheEntries);
  map.setStamp(1);
  return { map, grid, chunks };
}

describe('Lichtstufen und Umgebungslicht (§12.1)', () => {
  it('Stufen: Dunkel < 0,15 · Dämmrig 0,15–0,4 · Hell 0,4–0,9 · Gleißend > 0,9', () => {
    expect(BALANCE.light.map.stages).toEqual({ darkBelow: 0.15, brightFrom: 0.4, glaringAbove: 0.9 });
    expect([0, 0.149, 0.15, 0.399, 0.4, 0.9, 0.901, 1, 2].map(lightStage)).toEqual(['dunkel', 'dunkel', 'daemmrig', 'daemmrig', 'hell', 'hell', 'gleissend', 'gleissend', 'gleissend']);
  });

  it('Tag 1,0 (Wetter bis 0,6), Nacht 0,05–0,12 nach Mondphase, Finstermond 0,02, Dämmerung verlaufend, Höhle 0', () => {
    expect(surfaceAmbient(1, 4, 1)).toBe(1);
    expect(surfaceAmbient(1, 0, 0.6)).toBeCloseTo(0.6, 12);
    // Night: the moon alone – clouds do not change it.
    expect(surfaceAmbient(0, 4, 1)).toBeCloseTo(0.12, 12);
    expect(surfaceAmbient(0, 4, 0.6)).toBeCloseTo(0.12, 12);
    expect(surfaceAmbient(0, 1, 1)).toBeCloseTo(0.05, 12);
    expect(surfaceAmbient(0, 7, 1)).toBeCloseTo(0.05, 12);
    expect(surfaceAmbient(0, 0, 1)).toBeCloseTo(0.02, 12);
    for (let phase = 0; phase < BALANCE.calendar.moonCycleDays; phase++) {
      const night = surfaceAmbient(0, phase, 1);
      expect(night).toBe(nightAmbientLight(phase));
      expect(night).toBeGreaterThanOrEqual(0.02);
      expect(night).toBeLessThanOrEqual(0.12);
    }
    // Dusk blends: halfway daylight lies halfway between the night and the (weather-dimmed) day.
    expect(surfaceAmbient(0.5, 4, 0.8)).toBeCloseTo((0.12 + 0.8) / 2, 12);
    const dusk = [0, 0.25, 0.5, 0.75, 1].map((d) => surfaceAmbient(d, 2, 1));
    for (let i = 1; i < dusk.length; i++) expect(dusk[i]).toBeGreaterThan(dusk[i - 1] as number);
    expect(ambientLevel(-1, 1, 4, 1)).toBe(0);
    expect(ambientLevel(-3, 0, 0, 1)).toBe(0);
    expect(ambientLevel(0, 1, 4, 1)).toBe(1);
  });
});

describe('Umgebungslicht der echten Welt', () => {
  it('Kalender, Mondphase und das Wetter über der Kachel; im Untergrund 0', () => {
    const sim = createSimulation({ seed: 11, worldSize: 'small' });
    sim.step([{ type: 'player.spawn' }]);
    const player = sim.system('player') as unknown as { position(s: typeof sim, o: { x: number; y: number }): boolean };
    const p = { x: 0, y: 0 };
    player.position(sim, p);
    const tx = Math.floor(p.x / TILE_PX);
    const ty = Math.floor(p.y / TILE_PX);
    const light = sim.system('light') as unknown as LightSystem;
    const sample = createWeatherSample();
    const expected = (): number => {
      const cal = sim.world.calendar;
      return surfaceAmbient(cal.daylight, cal.moonPhase, sim.world.weather.sample(sim.world.regionAt(tx, ty), sample).lightFactor);
    };
    // Noon, midnight and the dawn blend: the map's ambient is §12.1's of the calendar and the weather there.
    for (const [hour, minute] of [
      [12, 0],
      [0, 0],
      [5, 30],
    ] as const) {
      sim.step([{ type: 'setTime', hour, minute }]);
      sim.step();
      const level = light.mapFor(sim).tileLevel(0, tx, ty);
      expect(level, `${hour}:${minute}`).toBeCloseTo(expected(), 12);
      if (hour === 12) expect(level).toBeGreaterThanOrEqual(0.6);
      if (hour === 0) expect(lightStage(level)).toBe('dunkel');
      // No light reaches below the surface without a source (§12.1 "Höhle 0").
      expect(light.mapFor(sim).tileLevel(-1, tx, ty)).toBe(0);
    }
    // A thunderstorm dims the day towards 0,6 (§12.1 "wetterabhängig bis 0,6").
    sim.step([{ type: 'setTime', hour: 11, minute: 0 }]);
    sim.step([{ type: 'setWeather', state: 'gewitter' }]);
    sim.step([{ type: 'advanceTime', minutes: 60 }]);
    sim.step();
    const stormy = light.mapFor(sim).tileLevel(0, tx, ty);
    expect(stormy).toBeCloseTo(expected(), 12);
    expect(stormy).toBeLessThan(1);
    expect(stormy).toBeGreaterThanOrEqual(0.6 - 1e-12);
  });
});

describe('Kachelwerte und bilineare Abtastung', () => {
  it('eine Kachel = Umgebung + Lichtquellen nach dem kanonischen Modell des Shaders (ohne Flackern)', () => {
    const tx = OFFSET + 10;
    const ty = OFFSET + 10;
    const light = torchAt(1, tx, ty);
    const { map } = mapOver([], [light], 0.07);
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [2, 3],
      [-4, 1],
      [0, -5],
      [6, 6],
    ] as const) {
      const cx = (tx + dx + 0.5) * TILE_PX;
      const cy = (ty + dy + 0.5) * TILE_PX;
      const steady = lightLevelAt({ ...light, flicker: 0 }, cx, cy, 0, 12.3);
      expect(steadyLightLevel(light, cx, cy)).toBeCloseTo(steady, 12);
      expect(map.tileSourceLevel(0, tx + dx, ty + dy)).toBeCloseTo(steady, 12);
      expect(map.tileLevel(0, tx + dx, ty + dy)).toBeCloseTo(0.07 + steady, 12);
    }
    // Other layers see nothing of it.
    expect(map.tileSourceLevel(-1, tx, ty)).toBe(0);
  });

  it('Punktabtastung: an Kachelmitten = Kachelwert, dazwischen das Modell des Renderers, stetig über Kachelgrenzen', () => {
    const tx = OFFSET + 10;
    const ty = OFFSET + 10;
    // The hand torch as the light system places it: 3 px in front of the feet.
    const lights = [
      torchAt(1, tx, ty, { height: BALANCE.light.torch.flameHeightPx.hand, y: (ty + 0.5) * TILE_PX + BALANCE.light.torch.handReachPx }),
      torchAt(2, tx + 1, ty + 1, { intensity: 1.2, radius: 8 * TILE_PX, height: 10 }),
    ];
    const { map } = mapOver([], lights, 0.05);
    const c = (t: number): number => (t + 0.5) * TILE_PX;
    const model = (x: number, y: number): number => 0.05 + lights.reduce((sum, l) => sum + steadyLightLevel(l, x, y), 0);
    expect(map.levelAt(0, c(tx + 2), c(ty + 1))).toBeCloseTo(map.tileLevel(0, tx + 2, ty + 1), 12);
    for (const [x, y] of [
      [(tx + 3) * TILE_PX, c(ty)],
      [(tx + 3) * TILE_PX, (ty + 1) * TILE_PX],
      [tx * TILE_PX + 3.25, ty * TILE_PX + 11.5],
      [c(tx) - 8, c(ty) + 7],
    ] as const) {
      expect(map.levelAt(0, x, y)).toBeCloseTo(model(x, y), 12);
    }
    // Interpolating the levels of the tile centres would miss the hot cores of hand torch and camp fire by more
    // than 0,05 (the acceptance's tolerance against the renderer); the point sample follows the model exactly.
    const tileBilinear = (px: number, py: number): number => {
      const u = px / TILE_PX - 0.5;
      const v = py / TILE_PX - 0.5;
      const ux = Math.floor(u);
      const vy = Math.floor(v);
      const a = map.tileLevel(0, ux, vy);
      const b = map.tileLevel(0, ux + 1, vy);
      const d0 = map.tileLevel(0, ux, vy + 1);
      const d1 = map.tileLevel(0, ux + 1, vy + 1);
      const top = a + (b - a) * (u - ux);
      return top + (d0 + (d1 - d0) * (u - ux) - top) * (v - vy);
    };
    let worst = 0;
    for (let py = (ty - 1) * TILE_PX; py < (ty + 3) * TILE_PX; py++) {
      for (let px = (tx - 1) * TILE_PX; px < (tx + 3) * TILE_PX; px++) {
        worst = Math.max(worst, Math.abs(model(px + 0.5, py + 0.5) - tileBilinear(px + 0.5, py + 0.5)));
        expect(Math.abs(map.levelAt(0, px + 0.5, py + 0.5) - model(px + 0.5, py + 0.5))).toBeLessThan(1e-12);
      }
    }
    expect(worst).toBeGreaterThan(0.05);
    // Across a tile border the level changes by a small step per pixel, never jumps.
    let prev = map.levelAt(0, tx * TILE_PX, c(ty));
    for (let px = tx * TILE_PX + 1; px < (tx + 6) * TILE_PX; px++) {
      const v = map.levelAt(0, px, c(ty));
      expect(Math.abs(v - prev)).toBeLessThan(0.03);
      prev = v;
    }
    expect(map.stageAt(0, c(tx), c(ty))).toBe(lightStage(map.levelAt(0, c(tx), c(ty))));
    expect(map.stageAt(0, c(tx + 12), c(ty))).toBe('dunkel');
    // The batch forms: tiles at their centres, the lattice as point samples.
    const tiles = new Float64Array(6);
    map.fillTiles(0, tx, ty, 3, 2, tiles);
    expect(tiles[4]).toBe(map.tileLevel(0, tx + 1, ty + 1));
    const lattice = new Float64Array(6);
    map.fillLattice(0, tx * TILE_PX, ty * TILE_PX, 4, 3, 2, lattice, false);
    expect(lattice[5]).toBeCloseTo(model(tx * TILE_PX + 8, ty * TILE_PX + 4) - 0.05, 12);
  });

  it('Verdeckung weich: zwischen einer beleuchteten und einer verdeckten Kachel mischt der Punkt beide', () => {
    const rows = ['.....#....', '.....#....', '.....#....', '.....#....', '.....#....', '.....#....', '.....#....'];
    const light = torchAt(1, OFFSET + 2, OFFSET + 3);
    const { map } = mapOver(rows, [light]);
    const y = (OFFSET + 3.5) * TILE_PX;
    const x = (OFFSET + 6) * TILE_PX;
    // Halfway between the wall tile (lit face) and the tile behind it (dark): half the light of the point.
    expect(map.sourceLevelAt(0, x, y)).toBeCloseTo(0.5 * steadyLightLevel(light, x, y), 12);
    expect(map.sourceLevelAt(0, (OFFSET + 6.5) * TILE_PX, y)).toBe(0);
  });

  it('eine Fackel: hell am Fuß, Hell bis zwei Kacheln, Dunkel ab vier (§12.2 Radius 6)', () => {
    const tx = OFFSET + 10;
    const ty = OFFSET + 10;
    const { map } = mapOver([], [torchAt(1, tx, ty, { height: BALANCE.light.torch.flameHeightPx.hand })]);
    const c = (t: number): number => (t + 0.5) * TILE_PX;
    const at = (d: number): number => map.levelAt(0, c(tx + d), c(ty));
    expect(at(0)).toBeGreaterThan(0.8);
    expect(at(0)).toBeLessThanOrEqual(BALANCE.light.map.stages.glaringAbove);
    expect(at(2)).toBeGreaterThan(0.5);
    expect(lightStage(at(3))).toBe('daemmrig');
    expect(lightStage(at(4))).toBe('dunkel');
    expect(at(6)).toBe(0);
  });
});

describe('Verdeckung per Tile-Raycast (Wände und Klippen)', () => {
  it('Felswand: dahinter dunkel, davor und die Wand selbst beleuchtet; Bäume verdecken nicht', () => {
    // Light at (2, 3); a rock wall in column 5, rows 0–4; a birch at (2, 6).
    const rows = ['.....#....', '.....#....', '.....#....', '.....#....', '.....#....', '..........', '..T.......'];
    const light = torchAt(1, OFFSET + 2, OFFSET + 3);
    const { map } = mapOver(rows, [light]);
    const at = (x: number, y: number): number => map.tileSourceLevel(0, OFFSET + x, OFFSET + y);
    expect(at(4, 3)).toBeGreaterThan(0);
    expect(at(5, 3)).toBeGreaterThan(0);
    expect(at(6, 3)).toBe(0);
    expect(at(7, 2)).toBe(0);
    // The tree does not shade the tile behind it.
    expect(at(2, 7)).toBeCloseTo(steadyLightLevel(light, (OFFSET + 2.5) * TILE_PX, (OFFSET + 7.5) * TILE_PX), 12);
    // Past the end of the wall the light reaches again.
    expect(at(6, 6)).toBeGreaterThan(0);
    expect(at(6, 4)).toBe(0);
  });

  it('Klippe: ein Licht am Fuß erhellt die Hochebene dahinter nicht, ein Licht oben erhellt den Fuß', () => {
    // Plateau of level 1 in rows 0–2; its face (the tile south of the edge) is row 3; the lower ground below.
    const rows = ['1111111111', '1111111111', '1111111111', '..........', '..........', '..........', '..........'];
    const below = torchAt(1, OFFSET + 5, OFFSET + 6);
    const { map: m1 } = mapOver(rows, [below]);
    expect(m1.tileSourceLevel(0, OFFSET + 5, OFFSET + 4)).toBeGreaterThan(0);
    expect(m1.tileSourceLevel(0, OFFSET + 5, OFFSET + 3)).toBeGreaterThan(0);
    expect(m1.tileSourceLevel(0, OFFSET + 5, OFFSET + 2)).toBe(0);
    expect(m1.tileSourceLevel(0, OFFSET + 5, OFFSET + 1)).toBe(0);
    const above = torchAt(2, OFFSET + 5, OFFSET + 1);
    const { map: m2 } = mapOver(rows, [above]);
    expect(m2.tileSourceLevel(0, OFFSET + 5, OFFSET + 2)).toBeGreaterThan(0);
    expect(m2.tileSourceLevel(0, OFFSET + 5, OFFSET + 3)).toBeGreaterThan(0);
    expect(m2.tileSourceLevel(0, OFFSET + 5, OFFSET + 4)).toBeGreaterThan(0);
  });

  it('der Strahl läuft durch die Kacheln der Strecke (ganzzahlig, diagonal durch exakte Ecken)', () => {
    const r = 3;
    const size = windowSize(r);
    const blockers = new Uint8Array(size * size);
    const set = (dx: number, dy: number): void => {
      blockers[(dy + r) * size + (dx + r)] = 1;
    };
    set(1, 0);
    expect(rayVisible(blockers, r, 1, 0)).toBe(true);
    expect(rayVisible(blockers, r, 2, 0)).toBe(false);
    expect(rayVisible(blockers, r, 3, 1)).toBe(false);
    expect(rayVisible(blockers, r, 0, 3)).toBe(true);
    // An exact diagonal passes between two blocked side tiles.
    blockers.fill(0);
    set(1, 0);
    set(0, 1);
    expect(rayVisible(blockers, r, 2, 2)).toBe(true);
    set(1, 1);
    expect(rayVisible(blockers, r, 2, 2)).toBe(false);
    expect(rayVisible(blockers, r, 0, 0)).toBe(true);
  });

  it('nicht geladene Kacheln zählen als offen, die Maske gilt dann als unvollständig', () => {
    const grid = new CollisionGrid({ chunks: { get: () => undefined }, worldTiles: WORLD_TILES });
    const r = 2;
    const mask = new Uint8Array(windowSize(r) ** 2);
    expect(traceVisibility(grid, 0, 100, 100, r, 0, mask, new Uint8Array(mask.length))).toBe(false);
    expect([...mask].every((v) => v === 1)).toBe(true);
  });
});

describe('Verdeckungs-Cache je Lichtquelle', () => {
  it('trifft bei gleicher Lage, verfolgt neu bei Bewegung, behält die letzten Lagen einer bewegten Quelle', () => {
    const { grid } = mapOver([], []);
    const cache = new OcclusionCache(3);
    const e1 = cache.window(grid, 0, 0, OFFSET, OFFSET, 6, 0);
    expect(cache.stats.traces).toBe(1);
    expect(cache.window(grid, 0, 0, OFFSET, OFFSET, 6, 0)).toBe(e1);
    expect(cache.stats).toEqual({ traces: 1, hits: 1 });
    cache.window(grid, 0, 0, OFFSET + 1, OFFSET, 6, 0);
    cache.window(grid, 0, 0, OFFSET + 2, OFFSET, 6, 0);
    expect(cache.stats.traces).toBe(3);
    // Back to the first spot: still cached (three positions per light).
    cache.window(grid, 0, 0, OFFSET, OFFSET, 6, 0);
    expect(cache.stats.traces).toBe(3);
    // A fourth spot evicts the least recently used one (OFFSET + 1).
    cache.window(grid, 0, 0, OFFSET + 3, OFFSET, 6, 0);
    cache.window(grid, 0, 0, OFFSET + 1, OFFSET, 6, 0);
    expect(cache.stats.traces).toBe(5);
    expect(cache.size).toBe(3);
    cache.forget(0);
    expect(cache.size).toBe(0);
  });

  it('Bauänderung: invalidiert nur Masken, deren Fenster die Kachel berührt – danach stimmt das Licht', () => {
    const rows = ['.....#....', '.....#....', '.....#....', '.....#....', '.....#....', '.....#....', '.....#....'];
    const light = torchAt(1, OFFSET + 2, OFFSET + 3);
    const far = torchAt(2, OFFSET + 40, OFFSET + 3);
    const lights = [light, far];
    const { map, chunks, grid } = mapOver(rows, lights);
    expect(map.tileSourceLevel(0, OFFSET + 6, OFFSET + 3)).toBe(0);
    const traces = map.occlusion.stats.traces;
    // Mining the wall tile in front of the light: the chunk changes, the owner reports it.
    const { chunk, i } = chunks.at(OFFSET + 5, OFFSET + 3);
    chunk.solid[i] = 0;
    grid.invalidateTile(0, OFFSET + 5, OFFSET + 3);
    map.invalidateTile(0, OFFSET + 5, OFFSET + 3);
    map.setStamp(2);
    expect(map.tileSourceLevel(0, OFFSET + 6, OFFSET + 3)).toBeGreaterThan(0);
    // Only the light next to the change traced again.
    expect(map.occlusion.stats.traces).toBe(traces + 1);
    // Without the report the cache keeps the old mask (the contract: every wall change is reported).
    chunk.solid[i] = FELS;
    grid.invalidateTile(0, OFFSET + 5, OFFSET + 3);
    map.setStamp(3);
    expect(map.tileSourceLevel(0, OFFSET + 6, OFFSET + 3)).toBeGreaterThan(0);
    map.invalidateChunk(0, (OFFSET + 5) >> 5, (OFFSET + 3) >> 5);
    expect(map.tileSourceLevel(0, OFFSET + 6, OFFSET + 3)).toBe(0);
  });
});

describe('eine Lichtquellenliste für Lichtkarte und Renderer', () => {
  it('Lagerfeuer und Fackel des Lichtsystems: die Karte liest die Liste, der Renderer bekommt dieselben Lichter', () => {
    const rows = Array.from({ length: 24 }, () => '.'.repeat(24));
    const w = lightWorld(rows);
    w.lenv.ambientLevel = 0.05;
    w.spawn(10, 10);
    w.give('lagerfeuer', 1);
    w.give('holz', 3);
    w.give('fackel', 2);
    const fire = w.place('lagerfeuer', 11, 10);
    w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('holz') }]);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    w.place('fackel', 16, 10);
    w.equipTorch();
    w.step(1, [{ type: 'light.toggle' }]);
    const sources = w.light.sources(w.sim);
    expect(sources.map((s) => [s.id, s.kind, s.mount])).toEqual([
      [0, 'fackel', 'hand'],
      [1, 'lagerfeuer', 'boden'],
      [2, 'fackel', 'stand'],
    ]);
    // The map: ambient + every source at the tile centre.
    const map = w.light.mapFor(w.sim);
    const tx = OFFSET + 13;
    const ty = OFFSET + 12;
    let sum = 0.05;
    for (const s of sources) sum += steadyLightLevel(s, (tx + 0.5) * TILE_PX, (ty + 0.5) * TILE_PX);
    expect(map.tileLevel(0, tx, ty)).toBeCloseTo(sum, 12);
    const c = w.centre(11, 11);
    expect(w.light.levelAt(w.sim, 0, c.x, c.y)).toBeCloseTo(map.levelAt(0, c.x, c.y), 12);
    expect(w.light.stageAt(w.sim, 0, c.x, c.y)).toBe('gleissend');
    const sampler = w.light.sampler();
    expect(sampler(w.sim, 0, c.x, c.y)).toBe(w.light.levelAt(w.sim, 0, c.x, c.y));
    // The renderer's lights: the same list, one by one (the carried torch at the drawn figure).
    const scene = new RenderScene();
    scene.beginFrame(0);
    const frame = createLightFrame();
    frame.layer = 0;
    frame.hasFigure = true;
    const p = w.pos();
    frame.figureX = p.x;
    frame.figureY = p.y;
    const bridge = new LightBridge();
    bridge.fill(scene, null, w.sim, frame);
    expect(scene.lights.count).toBe(3);
    const fire3 = paletteLight('feuer.3');
    sources.forEach((s, i) => {
      expect([scene.lights.x[i], scene.lights.y[i], scene.lights.height[i], scene.lights.radius[i], scene.lights.intensity[i], scene.lights.flicker[i], scene.lights.seed[i]]).toEqual(
        [s.x, s.y, s.height, s.radius, s.intensity, s.flicker, s.seed].map((v) => Math.fround(v)),
      );
      expect([scene.lights.r[i], scene.lights.g[i], scene.lights.b[i]]).toEqual(fire3.map((v) => Math.fround(v)));
    });
    // Another layer: no lights.
    const other = new RenderScene();
    other.beginFrame(0);
    frame.layer = -1;
    bridge.fill(other, null, w.sim, frame);
    expect(other.lights.count).toBe(0);
  });

  it('Kosten: eine Radius-8-Maske in unter einer Millisekunde, die Kachelwerte eines Bildschirms in wenigen', () => {
    const lights = Array.from({ length: 12 }, (_, i) => torchAt(i + 1, OFFSET + (i % 4) * 6, OFFSET + Math.floor(i / 4) * 6, { windowTiles: 8, radius: 8 * TILE_PX }));
    const { map } = mapOver([], lights);
    const out = new Float32Array(48 * 24);
    map.fillTiles(0, OFFSET - 6, OFFSET - 6, 48, 24, out);
    const start = performance.now();
    const rounds = 20;
    for (let k = 0; k < rounds; k++) {
      map.occlusion.invalidateAll();
      map.setStamp(10 + k);
      map.fillTiles(0, OFFSET - 6, OFFSET - 6, 48, 24, out);
    }
    const ms = (performance.now() - start) / rounds;
    expect(ms).toBeLessThan(12 * 1 + 5);
    expect(out.some((v) => v > 0)).toBe(true);
  });
});
