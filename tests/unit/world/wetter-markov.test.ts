/**
 * M2-26: weather simulation (MASTERPROMPT §10, docs/WORLD.md §6) – Markov automaton per biome ×
 * season with transition matrices as content, the 12 states, durations of 1–8 game hours, soft
 * transitions and the temperature offsets; determinism of the per-region weather.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE, SEASON_IDS, type SeasonId } from '../../../src/content/balance';
import {
  CLIMATE_BALANCE,
  WEATHER_AFFINITY,
  WEATHER_CLIMATES,
  WEATHER_STATES,
  WEATHER_STATE_COUNT,
  WEATHER_STATE_IDS,
  buildWeatherTables,
  weatherStateIndex,
  weatherTables,
  type WeatherStateId,
} from '../../../src/content/weather';
import { GameClock, type DayLengthMinutes } from '../../../src/engine/time';
import { Calendar } from '../../../src/world/calendar';
import { TemperatureField, WORLD_START_MINUTE, WeatherSystem, createWeatherSample, minuteOf, nightEndMinute } from '../../../src/world/climate';
import { CatchUpRegistry, isTimeDependent } from '../../../src/world/stream/catchUp';

const SURFACE_BIOMES = ['gruenhain', 'salzkueste', 'nebelmoor', 'frostkamm', 'glutsand', 'aschenschlund', 'scherbenhain', 'nachtherz'] as const;
const HOUR = 60;

function calendar(dayLengthMinutes: DayLengthMinutes = 24): Calendar {
  return new Calendar(new GameClock({ tickHz: BALANCE.time.tickHz, worldTickHz: BALANCE.time.worldTickHz, dayLengthMinutes }));
}

interface Period {
  readonly region: number;
  readonly state: WeatherStateId;
  readonly start: number;
  readonly end: number;
}

/**
 * Runs the weather up to `until` in steps shorter than the shortest period and records every period
 * (the running ones last).
 */
function history(weather: WeatherSystem, until: number, step = 7): Period[] {
  const periods: Period[] = [];
  const seen = new Set<string>();
  const record = (): void => {
    for (let r = 0; r < weather.regionCount; r++) {
      const key = `${r}:${weather.periodStart(r)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      periods.push({ region: r, state: weather.state(r), start: weather.periodStart(r), end: weather.periodEnd(r) });
    }
  };
  record();
  for (let m = WORLD_START_MINUTE; m <= until; m += step) {
    weather.advanceTo(m);
    record();
  }
  weather.advanceTo(until);
  record();
  return periods;
}

describe('weather content', () => {
  it('has the 12 states of §10 with names in both languages', () => {
    const tables = weatherTables();
    expect(tables.states.map((s) => s.id)).toEqual([...WEATHER_STATE_IDS]);
    expect(WEATHER_STATE_COUNT).toBe(12);
    for (const s of tables.states) {
      expect(s.name.de.length).toBeGreaterThan(0);
      expect(s.name.en.length).toBeGreaterThan(0);
    }
    expect(tables.states.find((s) => s.id === 'sternschnuppennacht')?.name.de).toBe('Sternschnuppen-Nacht');
  });

  it('uses the temperature offsets of §10', () => {
    const offsets = Object.fromEntries(weatherTables().states.map((s) => [s.id, s.temperatureOffsetC]));
    expect(offsets).toEqual({
      klar: 0,
      bewoelkt: 0,
      nebel: 0,
      niesel: 0,
      regen: -3,
      gewitter: -5,
      schnee: -4,
      schneesturm: -10,
      hitzewelle: 8,
      sandsturm: 3,
      ascheregen: 2,
      sternschnuppennacht: 0,
    });
  });

  it('keeps every duration within 1–8 game hours and the daylight factor within 0,6–1', () => {
    for (const s of weatherTables().states) {
      expect(s.durationHours.min).toBeGreaterThanOrEqual(1);
      expect(s.durationHours.max).toBeLessThanOrEqual(8);
      expect(s.lightFactor).toBeGreaterThanOrEqual(0.6);
      expect(s.lightFactor).toBeLessThanOrEqual(1);
    }
    expect(CLIMATE_BALANCE.weatherBlendMinutes).toBeLessThan(Math.min(...weatherTables().states.map((s) => s.durationHours.min)) * HOUR);
  });

  it('builds a normalised transition matrix for every surface biome and season', () => {
    const tables = weatherTables();
    expect([...tables.biomes].sort()).toEqual([...SURFACE_BIOMES].sort());
    for (const biome of SURFACE_BIOMES) {
      for (const season of SEASON_IDS) {
        const m = tables.matrix(biome, season);
        const w = tables.weights(biome, season);
        expect(m.length).toBe(WEATHER_STATE_COUNT * WEATHER_STATE_COUNT);
        for (let from = 0; from < WEATHER_STATE_COUNT; from++) {
          let sum = 0;
          for (let to = 0; to < WEATHER_STATE_COUNT; to++) {
            const p = m[from * WEATHER_STATE_COUNT + to] as number;
            expect(p).toBeGreaterThanOrEqual(0);
            // A state that does not occur in this biome and season is never entered.
            expect(p > 0).toBe((w[to] as number) > 0);
            sum += p;
          }
          expect(sum).toBeCloseTo(1, 12);
        }
      }
    }
    expect(() => tables.matrix('wurzelhoehlen', 'winter')).toThrow(/no climate/);
  });

  it('reaches every one of the 12 states from clear weather in at least one matrix', () => {
    const tables = weatherTables();
    const reachable = new Set<WeatherStateId>();
    for (const biome of SURFACE_BIOMES) {
      for (const season of SEASON_IDS) {
        const m = tables.matrix(biome, season);
        const queue = [weatherStateIndex('klar')];
        const seen = new Set(queue);
        while (queue.length > 0) {
          const from = queue.shift() as number;
          for (let to = 0; to < WEATHER_STATE_COUNT; to++) {
            if ((m[from * WEATHER_STATE_COUNT + to] as number) > 0 && !seen.has(to)) {
              seen.add(to);
              queue.push(to);
            }
          }
        }
        for (const i of seen) reachable.add(WEATHER_STATE_IDS[i] as WeatherStateId);
      }
    }
    expect([...reachable].sort()).toEqual([...WEATHER_STATE_IDS].sort());
  });

  it('keeps the regional character: sandstorms only in the Glutsand, ash only near the volcanoes', () => {
    const tables = weatherTables();
    const occurs = (state: WeatherStateId): string[] =>
      SURFACE_BIOMES.filter((b) => SEASON_IDS.some((s) => (tables.weights(b, s)[weatherStateIndex(state)] as number) > 0));
    expect(occurs('sandsturm')).toEqual(['glutsand']);
    expect(occurs('ascheregen')).toEqual(['aschenschlund', 'nachtherz']);
    expect(occurs('schneesturm').includes('glutsand')).toBe(false);
    expect(occurs('hitzewelle').includes('frostkamm')).toBe(false);
    const snow = (season: SeasonId): number => {
      const w = tables.weights('frostkamm', season);
      const total = w.reduce((a, b) => a + b, 0);
      return ((w[weatherStateIndex('schnee')] as number) + (w[weatherStateIndex('schneesturm')] as number)) / total;
    };
    expect(snow('winter')).toBeGreaterThan(snow('sommer'));
  });

  it('rejects broken weather content', () => {
    expect(() => buildWeatherTables(WEATHER_STATES.slice(1))).toThrow(/"klar" is missing/);
    expect(() => buildWeatherTables([...WEATHER_STATES, WEATHER_STATES[0] as (typeof WEATHER_STATES)[number]])).toThrow(/defined twice/);
    expect(() => buildWeatherTables(WEATHER_STATES.map((s) => (s.id === 'regen' ? { ...s, durationHours: { min: 1, max: 9 } } : s)))).toThrow(/invalid/);
    expect(() => buildWeatherTables(WEATHER_STATES.map((s) => (s.id === 'klar' ? { ...s, precipitation: 0.5 } : s)))).toThrow(/precipitation/);
    expect(() => buildWeatherTables(WEATHER_STATES, WEATHER_CLIMATES.slice(1))).toThrow(/"gruenhain" has no weather climate/);
    expect(() => buildWeatherTables(WEATHER_STATES, [...WEATHER_CLIMATES, { ...(WEATHER_CLIMATES[0] as (typeof WEATHER_CLIMATES)[number]), id: 'tiefgrund', biome: 'tiefgrund' }])).toThrow(/not a surface biome/);
    const onlyNight = WEATHER_CLIMATES.map((c) => (c.id === 'glutsand' ? { ...c, winter: [{ state: 'sternschnuppennacht' as const, weight: 1 }] } : c));
    expect(() => buildWeatherTables(WEATHER_STATES, onlyNight)).toThrow(/by day/);
    const badAffinity = { ...WEATHER_AFFINITY, klar: { ...WEATHER_AFFINITY.klar, regen: 0 } };
    expect(() => buildWeatherTables(WEATHER_STATES, WEATHER_CLIMATES, badAffinity)).toThrow(/affinity klar → regen/);
  });
});

describe('weather automaton', () => {
  it('lasts 1–8 game hours per period and lets every state occur', () => {
    const weather = new WeatherSystem(calendar(), 20260924, [...SURFACE_BIOMES]);
    const periods = history(weather, minuteOf(4 * 28 + 1, 0));
    expect(periods.length).toBeGreaterThan(2000);
    const lengths = periods.map((p) => p.end - p.start);
    for (const p of periods) {
      const s = weatherTables().states[weatherStateIndex(p.state)];
      expect(p.end - p.start).toBeGreaterThanOrEqual((s?.durationHours.min ?? 1) * HOUR);
      expect(p.end - p.start).toBeLessThanOrEqual((s?.durationHours.max ?? 8) * HOUR);
    }
    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(HOUR);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(8 * HOUR);
    expect(new Set(periods.map((p) => p.state)).size).toBe(12);
  });

  it('starts falling-star nights only in full night and ends them by dawn', () => {
    const cal = calendar();
    const weather = new WeatherSystem(cal, 99, ['scherbenhain', 'scherbenhain', 'glutsand', 'scherbenhain']);
    const stars = history(weather, minuteOf(60, 0)).filter((p) => p.state === 'sternschnuppennacht');
    expect(stars.length).toBeGreaterThan(20);
    for (const p of stars) {
      const nightEnd = nightEndMinute(cal, p.start);
      expect(nightEnd).toBeGreaterThanOrEqual(0);
      expect(p.end).toBeLessThanOrEqual(nightEnd);
      expect(p.end - p.start).toBeGreaterThanOrEqual(2 * HOUR);
    }
  });

  it('is deterministic per seed and region, independent of how often it is sampled', () => {
    const until = minuteOf(30, 13.5);
    const a = new WeatherSystem(calendar(), 7, ['gruenhain', 'frostkamm', 'glutsand']);
    const b = new WeatherSystem(calendar(), 7, ['gruenhain', 'frostkamm', 'glutsand']);
    a.advanceTo(until);
    for (let m = WORLD_START_MINUTE; m <= until; m += 1.5) b.advanceTo(m);
    b.advanceTo(until);
    expect(b.save.serialize()).toEqual(a.save.serialize());
    // More regions (a bigger world) do not change the weather of the first ones.
    const c = new WeatherSystem(calendar(), 7, ['gruenhain', 'frostkamm', 'glutsand', 'nebelmoor', 'salzkueste']);
    c.advanceTo(until);
    const snapA = a.save.serialize();
    const snapC = c.save.serialize();
    for (const key of ['state', 'previous', 'startMinute', 'endMinute', 'changes'] as const) expect(snapC[key].slice(0, 3)).toEqual(snapA[key]);
    // Another seed gives other weather.
    const d = new WeatherSystem(calendar(), 8, ['gruenhain', 'frostkamm', 'glutsand']);
    d.advanceTo(until);
    expect(d.save.serialize()).not.toEqual(a.save.serialize());
  });

  it('counts game time, so the day length does not change the weather', () => {
    const short = new WeatherSystem(calendar(12), 5, ['nebelmoor', 'aschenschlund']);
    const long = new WeatherSystem(calendar(48), 5, ['nebelmoor', 'aschenschlund']);
    for (const w of [short, long]) {
      const clock = w.calendar.clock;
      clock.setTick(20 * clock.ticksPerDay);
      w.worldTick();
    }
    expect(short.nowMinute()).toBe(long.nowMinute());
    expect(short.save.serialize()).toEqual(long.save.serialize());
  });

  it('continues identically after save and restore', () => {
    const regions = ['salzkueste', 'nachtherz', 'frostkamm'];
    const original = new WeatherSystem(calendar(), 11, regions);
    original.advanceTo(minuteOf(9, 17));
    const restored = new WeatherSystem(calendar(), 11, regions);
    restored.save.deserialize(JSON.parse(JSON.stringify(original.save.serialize())));
    original.advanceTo(minuteOf(40, 3));
    restored.advanceTo(minuteOf(40, 3));
    expect(restored.save.serialize()).toEqual(original.save.serialize());
  });

  it('blends cloud cover, wind, precipitation and temperature smoothly into a new state', () => {
    const cal = calendar();
    const weather = new WeatherSystem(cal, 3, ['frostkamm']);
    cal.clock.setTick(cal.clock.ticksPerDay * 2);
    const now = Math.floor(weather.nowMinute());
    weather.force(0, 'schneesturm');
    const before = weather.previousState(0);
    const tables = weatherTables();
    const from = tables.states[weatherStateIndex(before)];
    const to = tables.states[weatherStateIndex('schneesturm')];
    const s = createWeatherSample();
    weather.sample(0, s, now);
    expect([s.state, s.previous, s.blend]).toEqual(['schneesturm', before, 0]);
    expect(s.cloudCover).toBeCloseTo(from?.cloudCover ?? -1, 12);
    expect(s.temperatureOffsetC).toBeCloseTo(from?.temperatureOffsetC ?? -99, 12);
    let last = Number.NEGATIVE_INFINITY;
    for (let m = 0; m <= CLIMATE_BALANCE.weatherBlendMinutes; m += 3) {
      weather.sample(0, s, now + m);
      expect(s.blend).toBeGreaterThanOrEqual(last);
      last = s.blend;
      expect(s.wind).toBeGreaterThanOrEqual(Math.min(from?.wind ?? 0, to?.wind ?? 0) - 1e-12);
      expect(s.wind).toBeLessThanOrEqual(Math.max(from?.wind ?? 0, to?.wind ?? 0) + 1e-12);
    }
    weather.sample(0, s, now + CLIMATE_BALANCE.weatherBlendMinutes);
    expect(s.blend).toBe(1);
    const settled = [s.cloudCover, s.wind, s.precipitation, s.haze, s.lightFactor, s.temperatureOffsetC];
    const target = [to?.cloudCover, to?.wind, to?.precipitation, to?.haze, to?.lightFactor, to?.temperatureOffsetC];
    settled.forEach((v, i) => expect(v).toBeCloseTo(target[i] ?? Number.NaN, 12));
    expect(s.precipitationKind).toBe('schnee');
    expect(weather.temperatureOffsetAt(0, now + CLIMATE_BALANCE.weatherBlendMinutes / 2)).toBeCloseTo(((from?.temperatureOffsetC ?? 0) + (to?.temperatureOffsetC ?? 0)) / 2, 12);
    // Rain fading out keeps its kind while the new state has none.
    weather.force(0, 'regen');
    weather.force(0, 'klar');
    weather.sample(0, s, now + 1);
    expect(s.precipitationKind).toBe('regen');
    expect(s.precipitation).toBeGreaterThan(0);
  });

  it('runs globally: weather and temperature field declare themselves to the catch-up registry', () => {
    const cal = calendar();
    const weather = new WeatherSystem(cal, 1, ['gruenhain']);
    const field = new TemperatureField({ calendar: cal, weather });
    expect(isTimeDependent(weather) && isTimeDependent(field)).toBe(true);
    expect(() => CatchUpRegistry.fromSystems([weather, field])).not.toThrow();
    // The world tick advances the weather to the clock.
    cal.clock.setTick(cal.clock.ticksPerDay * 3);
    weather.worldTick();
    expect(weather.periodEnd(0)).toBeGreaterThan(weather.nowMinute());
    expect(weather.periodCount(0)).toBeGreaterThan(1);
  });

  it('starts calm everywhere and validates its regions', () => {
    const weather = new WeatherSystem(calendar(), 1, [...SURFACE_BIOMES]);
    const s = createWeatherSample();
    for (let r = 0; r < weather.regionCount; r++) {
      expect(weather.state(r)).toBe(CLIMATE_BALANCE.initialWeather);
      weather.sample(r, s, WORLD_START_MINUTE);
      expect(s.blend).toBe(1);
    }
    expect(() => new WeatherSystem(calendar(), 1, [])).toThrow(RangeError);
    expect(() => new WeatherSystem(calendar(), 1, ['tiefgrund'])).toThrow(/no weather climate/);
    expect(() => weather.state(99)).toThrow(RangeError);
    expect(() => weather.force(0, 'orkan' as WeatherStateId)).toThrow(RangeError);
  });
});
