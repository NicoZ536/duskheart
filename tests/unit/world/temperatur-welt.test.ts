/**
 * M2-25: temperature field (MASTERPROMPT §9.1, §9.3, §10; docs/WORLD.md §6) – biome base value,
 * season (0/+8/−3/−14), day curve (±6 °C, Glutsand ±18 °C), weather offset and −3 °C per height
 * level; caves near their base value; sampled on the 1 Hz world tick. Table values for all 11
 * biomes/layers.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE, SEASON_IDS, type SeasonId } from '../../../src/content/balance';
import { BIOMES } from '../../../src/content/biomes';
import { CLIMATE_BALANCE } from '../../../src/content/weather';
import { GameClock } from '../../../src/engine/time';
import { Calendar, dayTimes } from '../../../src/world/calendar';
import { TemperatureField, WeatherSystem, biomeTemperatureC, dayCurve, dayCurveInSeason, hourOfMinute, lavaHeatC, minuteOf, seasonFactor } from '../../../src/world/climate';
import { ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SIZE, packChunkId, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const IDS = contentWorldIdTables();
const PEAK = CLIMATE_BALANCE.dayCurvePeakHour;

/** Hour of a spring day at which the day curve passes the §9.3 table value (reference 4/9). */
function referenceHour(): number {
  let lo = dayTimes('fruehling').sunrise;
  let hi = PEAK;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (dayCurveInSeason('fruehling', 'fruehling', mid) < CLIMATE_BALANCE.dayCurveReference) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Expected temperatures [°C] per biome and season: coldest moment (sunrise, day curve −1) and
 * warmest moment (15:00, +1) at height level 0 without weather. Worked out by hand from §9.3: a
 * ±6 °C biome spans base −8,67 … +3,33 °C (the table value lies 4/9 of the amplitude above the daily
 * mean), Glutsand (±18 °C) base −26 … +10 °C; seasons add 0/+8/−3/−14. Caves: no day curve, the
 * season damped to ¼ (Wurzelhöhlen), 1/10 (Tiefgrund) and 0 (Glutadern).
 */
const TABLE: Readonly<Record<string, Readonly<Record<SeasonId, readonly [number, number]>>>> = {
  gruenhain: { fruehling: [7.333, 19.333], sommer: [15.333, 27.333], herbst: [4.333, 16.333], winter: [-6.667, 5.333] },
  salzkueste: { fruehling: [8.333, 20.333], sommer: [16.333, 28.333], herbst: [5.333, 17.333], winter: [-5.667, 6.333] },
  nebelmoor: { fruehling: [5.333, 17.333], sommer: [13.333, 25.333], herbst: [2.333, 14.333], winter: [-8.667, 3.333] },
  frostkamm: { fruehling: [-16.667, -4.667], sommer: [-8.667, 3.333], herbst: [-19.667, -7.667], winter: [-30.667, -18.667] },
  glutsand: { fruehling: [8, 44], sommer: [16, 52], herbst: [5, 41], winter: [-6, 30] },
  aschenschlund: { fruehling: [29.333, 41.333], sommer: [37.333, 49.333], herbst: [26.333, 38.333], winter: [15.333, 27.333] },
  scherbenhain: { fruehling: [3.333, 15.333], sommer: [11.333, 23.333], herbst: [0.333, 12.333], winter: [-10.667, 1.333] },
  nachtherz: { fruehling: [-3.667, 8.333], sommer: [4.333, 16.333], herbst: [-6.667, 5.333], winter: [-17.667, -5.667] },
  wurzelhoehlen: { fruehling: [12, 12], sommer: [14, 14], herbst: [11.25, 11.25], winter: [8.5, 8.5] },
  tiefgrund: { fruehling: [14, 14], sommer: [14.8, 14.8], herbst: [13.7, 13.7], winter: [12.6, 12.6] },
  glutadern: { fruehling: [30, 30], sommer: [30, 30], herbst: [30, 30], winter: [30, 30] },
};

function calendarAt(day: number, hour: number): Calendar {
  const clock = new GameClock({ tickHz: BALANCE.time.tickHz, worldTickHz: BALANCE.time.worldTickHz, dayLengthMinutes: 24 });
  clock.setTick(Math.round(((minuteOf(day, hour) - minuteOf(1, 6)) * clock.ticksPerDay) / (24 * 60)));
  return new Calendar(clock);
}

class Chunks {
  readonly map = new Map<number, ChunkData>();
  get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    return this.map.get(packChunkId(layer, cx, cy));
  }
  add(layer: Layer, cx: number, cy: number, biome: string): ChunkData {
    const c = new ChunkData(layer, cx, cy);
    c.ground.fill(IDS.terrain.runtimeId(layer === 0 ? 'gras' : 'hoehlenboden'));
    c.biome.fill(IDS.biomes.runtimeId(biome));
    this.map.set(packChunkId(layer, cx, cy), c);
    return c;
  }
}

describe('§9.3 table values of all 11 biomes and layers', () => {
  it('reproduces the base value of a spring day for every biome', () => {
    const h = referenceHour();
    expect(h).toBeGreaterThan(11.5);
    expect(h).toBeLessThan(12.5);
    for (const b of BIOMES) expect(biomeTemperatureC(b.id, 'fruehling', b.layer === 0 ? h : 3)).toBeCloseTo(b.baseTemperatureC, 9);
    expect(Object.keys(TABLE).sort()).toEqual(BIOMES.map((b) => b.id).sort());
  });

  it('matches the table of coldest and warmest temperatures per season', () => {
    for (const [biome, seasons] of Object.entries(TABLE)) {
      for (const season of SEASON_IDS) {
        const [coldest, warmest] = seasons[season];
        expect(biomeTemperatureC(biome, season, dayTimes(season).sunrise), `${biome} ${season} sunrise`).toBeCloseTo(coldest, 3);
        expect(biomeTemperatureC(biome, season, PEAK), `${biome} ${season} 15:00`).toBeCloseTo(warmest, 3);
      }
    }
  });

  it('meets the special values of §9.3: Glutsand nights 8 °C, Frostkamm peaks −20 °C, lava +20 °C', () => {
    expect(biomeTemperatureC('glutsand', 'fruehling', dayTimes('fruehling').sunrise)).toBeCloseTo(8, 9);
    expect(biomeTemperatureC('frostkamm', 'fruehling', referenceHour(), { heightLevel: 4 })).toBeCloseTo(-20, 9);
    expect(biomeTemperatureC('aschenschlund', 'fruehling', referenceHour(), { heatC: lavaHeatC(1) })).toBeCloseTo(58, 9);
  });

  it('lowers the surface by 3 °C per height level and ignores height and weather in caves', () => {
    for (let level = 0; level <= BALANCE.world.maxHeightLevel; level++) {
      expect(biomeTemperatureC('gruenhain', 'sommer', 13, { heightLevel: level }) - biomeTemperatureC('gruenhain', 'sommer', 13)).toBeCloseTo(-3 * level, 12);
    }
    expect(biomeTemperatureC('tiefgrund', 'winter', 13, { heightLevel: 3, weatherOffsetC: -10 })).toBeCloseTo(12.6, 9);
    expect(biomeTemperatureC('salzkueste', 'winter', 13, { weatherOffsetC: -10 }) - biomeTemperatureC('salzkueste', 'winter', 13)).toBeCloseTo(-10, 12);
  });

  it('keeps caves near their base value around the clock', () => {
    for (const cave of ['wurzelhoehlen', 'tiefgrund', 'glutadern']) {
      const values = Array.from({ length: 24 }, (_, h) => biomeTemperatureC(cave, 'fruehling', h));
      expect(new Set(values).size).toBe(1);
    }
    expect(seasonFactor(0)).toBe(1);
    expect(seasonFactor(-1)).toBeGreaterThan(seasonFactor(-2));
    expect(seasonFactor(-3)).toBe(0);
  });
});

describe('day curve', () => {
  it('is coldest at sunrise, warmest at 15:00 and monotone in between', () => {
    for (const season of SEASON_IDS) {
      const t = dayTimes(season);
      expect(dayCurveInSeason(season, season, t.sunrise)).toBe(-1);
      expect(dayCurveInSeason(season, season, PEAK)).toBe(1);
      let last = -1;
      for (let h = t.sunrise; h <= PEAK; h += 0.25) {
        const c = dayCurveInSeason(season, season, h);
        expect(c).toBeGreaterThanOrEqual(last);
        last = c;
      }
      for (let h = PEAK; h < 24 + t.sunrise; h += 0.25) {
        const c = dayCurveInSeason(season, season, h % 24);
        expect(c).toBeLessThanOrEqual(last + 1e-12);
        last = c;
      }
    }
  });

  it('is continuous across midnight, also when the season changes', () => {
    for (const [today, tomorrow] of [
      ['fruehling', 'sommer'],
      ['herbst', 'winter'],
      ['winter', 'fruehling'],
    ] as const) {
      const before = dayCurve(24 - 1e-9, dayTimes(today).sunrise, dayTimes(tomorrow).sunrise);
      const after = dayCurve(0, dayTimes(tomorrow).sunrise, dayTimes(tomorrow).sunrise);
      expect(after).toBeCloseTo(before, 6);
    }
  });
});

describe('temperature field', () => {
  function field(day: number, hour: number, weather = false): { f: TemperatureField; chunks: Chunks; cal: Calendar; w: WeatherSystem | undefined } {
    const cal = calendarAt(day, hour);
    const chunks = new Chunks();
    const w = weather ? new WeatherSystem(cal, 17, ['gruenhain', 'frostkamm']) : undefined;
    const f = new TemperatureField({ calendar: cal, chunks, ...(w === undefined ? {} : { weather: w, regionAt: (tx: number) => (tx < CHUNK_SIZE ? 0 : 1) }) });
    return { f, chunks, cal, w };
  }

  it('computes every tile from biome, season, day curve and height', () => {
    const { f, chunks, cal } = field(9, 15);
    const c = chunks.add(0, 0, 0, 'glutsand');
    c.height[5] = 2;
    const out = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
    f.fillChunk(c, out);
    // Day 9 is summer (seasons of 7 days); 15:00 is the warmest moment: 34 + 8 + 10.
    expect(cal.season).toBe('sommer');
    expect(out[0]).toBeCloseTo(52, 5);
    expect(out[5]).toBeCloseTo(46, 5);
    expect(f.temperatureAt(0, 5, 0)).toBeCloseTo(46, 9);
    expect(f.tileTemperature(c, 5)).toBe(f.temperatureAt(0, 5, 0));
    // Underground: the layer's biome, damped season, no day curve.
    const cave = chunks.add(-1, 0, 0, 'wurzelhoehlen');
    expect(f.temperatureAt(-1, 3, 3)).toBeCloseTo(14, 9);
    cave.biome.fill(0);
    expect(f.temperatureAt(-1, 3, 3)).toBeCloseTo(14, 9);
    // Tiles of chunks that are not loaded, and surface tiles without biome (open sea), use the coast.
    expect(f.temperatureAt(0, 500, 500)).toBeCloseTo(biomeTemperatureC('salzkueste', 'sommer', 15), 9);
    expect(f.temperatureAt(-3, 500, 500)).toBeCloseTo(30, 9);
  });

  it('adds the heat of nearby lava, fading with distance', () => {
    const { f, chunks } = field(3, 12);
    const c = chunks.add(0, 0, 0, 'aschenschlund');
    const lava = IDS.terrain.runtimeId('lava');
    c.ground[10 * CHUNK_SIZE + 10] = lava;
    const out = new Float64Array(CHUNK_SIZE * CHUNK_SIZE);
    f.fillChunk(c, out);
    const base = out[0] as number;
    const at = (x: number, y: number): number => (out[y * CHUNK_SIZE + x] as number) - base;
    expect(at(10, 10)).toBeCloseTo(20, 9);
    expect(at(11, 10)).toBeCloseTo(20, 9);
    expect(at(12, 10)).toBeCloseTo(lavaHeatC(4), 9);
    expect(at(13, 10)).toBeCloseTo(lavaHeatC(9), 9);
    expect(at(14, 10)).toBe(0);
    expect(at(12, 12)).toBeCloseTo(lavaHeatC(8), 9);
    expect(lavaHeatC(0)).toBe(20);
    expect(lavaHeatC(16)).toBe(0);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) expect(f.tileTemperature(c, y * CHUNK_SIZE + x)).toBeCloseTo(out[y * CHUNK_SIZE + x] as number, 9);
    // Lava across a chunk border warms the neighbour chunk.
    const east = chunks.add(0, 1, 0, 'aschenschlund');
    c.ground[10 * CHUNK_SIZE + 31] = lava;
    expect(f.temperatureAt(0, 32, 10) - f.biomeAirC(east.biome[0] as number, 0)).toBeCloseTo(20, 9);
  });

  it("includes the weather of the tile's region on the surface only", () => {
    const { f, chunks, cal, w } = field(2, 10, true);
    const weather = w as WeatherSystem;
    const west = chunks.add(0, 0, 0, 'gruenhain');
    chunks.add(0, 1, 0, 'frostkamm');
    const cave = chunks.add(-1, 0, 0, 'wurzelhoehlen');
    weather.force(0, 'schneesturm');
    // After the blend and the next world tick the storm's −10 °C apply to region 0.
    cal.clock.setTick(cal.clock.tick + Math.ceil((CLIMATE_BALANCE.weatherBlendMinutes * cal.clock.ticksPerDay) / (24 * 60)) + cal.clock.worldTickInterval);
    const minute = f.sampleMinute;
    const hour = hourOfMinute(minute);
    expect(f.weatherOffsetAt(0, 0)).toBeCloseTo(-10, 9);
    expect(f.tileTemperature(west, 0)).toBeCloseTo(biomeTemperatureC('gruenhain', 'fruehling', hour, { weatherOffsetC: -10 }), 9);
    expect(f.temperatureAt(0, 40, 0)).toBeCloseTo(biomeTemperatureC('frostkamm', 'fruehling', hour, { weatherOffsetC: weather.temperatureOffsetAt(1, minute) }), 9);
    expect(f.tileTemperature(cave, 0)).toBeCloseTo(12, 9);
    // A region the plan does not know (open sea) has no weather offset.
    const sea = new TemperatureField({ calendar: cal, chunks, weather, regionAt: () => -1 });
    expect(sea.weatherOffsetAt(0, 0)).toBe(0);
  });

  it('changes only on the world tick (1 Hz) and needs no saved state', () => {
    const { f, chunks, cal } = field(5, 8);
    const c = chunks.add(0, 0, 0, 'nebelmoor');
    const clock = cal.clock;
    const first = f.tileTemperature(c, 0);
    // Within the same second nothing changes …
    for (let k = 1; k < clock.worldTickInterval - (clock.tick % clock.worldTickInterval); k++) {
      clock.setTick(clock.tick + 1);
      expect(f.tileTemperature(c, 0)).toBe(first);
    }
    // … the next world tick samples the morning warming.
    clock.setTick(clock.tick + clock.worldTickInterval);
    const later = f.tileTemperature(c, 0);
    expect(later).toBeGreaterThan(first);
    // A fresh field on the same clock (e.g. after loading a save) gives the same values.
    const again = new TemperatureField({ calendar: cal, chunks });
    expect(again.tileTemperature(c, 0)).toBe(later);
    expect(again.sampleMinute).toBe(f.sampleMinute);
  });
});
