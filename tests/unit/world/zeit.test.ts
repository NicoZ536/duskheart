/**
 * M2-24: world time and seasons (MASTERPROMPT §10, docs/WORLD.md §6). Tables per season, season
 * progression and length changes, moon phases with Finstermond, ambient light and sun/moon vectors.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { DAY_LENGTH_OPTIONS, GameClock, type DayLengthMinutes } from '../../../src/engine/time';
import {
  Calendar,
  SEASONS,
  ambientLightAt,
  createShadowVector,
  dayPhaseAt,
  dayTimes,
  daylightAt,
  isFinstermondPhase,
  moonIllumination,
  moonPhaseOfNight,
  nightAmbientLight,
  nightOf,
  seasonTemperatureOffsetC,
  sunShadowAt,
  type DayPhase,
  type Season,
} from '../../../src/world/calendar';

const TICK_HZ = BALANCE.time.tickHz;

function clock(dayLengthMinutes: DayLengthMinutes = 24): GameClock {
  return new GameClock({ tickHz: TICK_HZ, worldTickHz: BALANCE.time.worldTickHz, dayLengthMinutes });
}

/** Sets the clock to `hour` (may be fractional) of `day`. The world starts at 06:00 of day 1. */
function setTime(c: GameClock, day: number, hour: number): void {
  const hoursSinceStart = (day - 1) * 24 + hour - 6;
  c.setTick(Math.round((hoursSinceStart * c.ticksPerDay) / 24));
}

function calendarAt(day: number, hour: number, seasonLength?: number): Calendar {
  const cal = new Calendar(clock(), seasonLength);
  setTime(cal.clock, day, hour);
  return cal;
}

describe('day tables per season (§10)', () => {
  const expected: Record<Season, [night: number, dawnStart: number, sunrise: number, sunset: number, duskEnd: number, dayHours: number]> = {
    fruehling: [8, 4, 6, 18, 20, 12],
    sommer: [5, 2.5, 4.5, 19.5, 21.5, 15],
    herbst: [8, 4, 6, 18, 20, 12],
    winter: [11, 5.5, 7.5, 16.5, 18.5, 9],
  };

  it('night lengths 8/5/8/11 h, 2 h twilights, sunrise and sunset', () => {
    for (const season of SEASONS) {
      const t = dayTimes(season);
      expect([t.nightHours, t.dawnStart, t.sunrise, t.sunset, t.duskEnd, t.dayHours], season).toEqual(expected[season]);
      expect(t.twilightHours).toBe(2);
    }
  });

  it('measured phase durations match the table (minute resolution)', () => {
    for (const season of SEASONS) {
      const minutes: Record<DayPhase, number> = { nacht: 0, morgendaemmerung: 0, tag: 0, abenddaemmerung: 0 };
      for (let m = 0; m < 24 * 60; m++) minutes[dayPhaseAt(season, (m + 0.5) / 60)]++;
      expect(minutes.nacht / 60, season).toBe(dayTimes(season).nightHours);
      expect(minutes.morgendaemmerung / 60, season).toBe(2);
      expect(minutes.abenddaemmerung / 60, season).toBe(2);
      expect(minutes.tag / 60, season).toBe(dayTimes(season).dayHours);
    }
  });

  it('daylight is 0 at night, 1 by day and blends smoothly through the twilights', () => {
    for (const season of SEASONS) {
      const t = dayTimes(season);
      expect(daylightAt(season, 0)).toBe(0);
      expect(daylightAt(season, 12)).toBe(1);
      expect(daylightAt(season, t.dawnStart + 1)).toBeCloseTo(0.5, 12);
      expect(daylightAt(season, t.sunset + 1)).toBeCloseTo(0.5, 12);
      let previous = 0;
      let maxStep = 0;
      for (let m = 0; m <= 24 * 60; m++) {
        const v = daylightAt(season, Math.min(m / 60, 23.9999));
        maxStep = Math.max(maxStep, Math.abs(v - previous));
        if (m / 60 >= t.dawnStart && m / 60 <= t.sunrise) expect(v).toBeGreaterThanOrEqual(previous);
        previous = v;
      }
      // No jumps: at most 1.5 × the average slope (2 h twilight = 120 minutes) per game minute.
      expect(maxStep).toBeLessThan(1.5 / 120 + 1e-9);
    }
  });

  it('season temperature offsets (§9.3)', () => {
    expect(SEASONS.map(seasonTemperatureOffsetC)).toEqual([0, 8, -3, -14]);
  });
});

describe('seasons', () => {
  it('start in spring on day 1 and last 7 days each by default', () => {
    const cal = new Calendar(clock());
    expect(cal.day).toBe(1);
    expect(cal.hour).toBe(6);
    expect([cal.season, cal.dayOfSeason, cal.dayOfYear, cal.year]).toEqual(['fruehling', 1, 1, 1]);
    expect(cal.seasonLengthDays).toBe(7);
    const table: Array<[number, Season, number, number, number]> = [
      [7, 'fruehling', 7, 7, 1],
      [8, 'sommer', 1, 8, 1],
      [14, 'sommer', 7, 14, 1],
      [15, 'herbst', 1, 15, 1],
      [22, 'winter', 1, 22, 1],
      [28, 'winter', 7, 28, 1],
      [29, 'fruehling', 1, 1, 2],
      [60, 'fruehling', 4, 4, 3],
    ];
    for (const [day, season, dayOfSeason, dayOfYear, year] of table) {
      const d = cal.seasonDayOf(day);
      expect([d.season, d.dayOfSeason, d.dayOfYear, d.year], `day ${day}`).toEqual([season, dayOfSeason, dayOfYear, year]);
    }
  });

  it('supports every season length from 3 to 14 days', () => {
    for (let length = 3; length <= 14; length++) {
      const cal = new Calendar(clock(), length);
      expect(cal.seasonOfDay(length)).toBe('fruehling');
      expect(cal.seasonOfDay(length + 1)).toBe('sommer');
      expect(cal.seasonOfDay(3 * length + 1)).toBe('winter');
      expect(cal.seasonDayOf(4 * length + 1).year).toBe(2);
    }
    expect(() => new Calendar(clock(), 2)).toThrow(RangeError);
    expect(() => new Calendar(clock(), 15)).toThrow(RangeError);
    expect(() => new Calendar(clock(), 7.5)).toThrow(RangeError);
  });

  it('follows the clock: the season changes at midnight, independent of the day length', () => {
    for (const minutes of DAY_LENGTH_OPTIONS) {
      const cal = new Calendar(clock(minutes));
      setTime(cal.clock, 7, 23.9);
      expect(cal.season, `${minutes} min`).toBe('fruehling');
      setTime(cal.clock, 8, 0.1);
      expect(cal.season, `${minutes} min`).toBe('sommer');
      setTime(cal.clock, 8, 13);
      expect([cal.day, cal.hour, cal.dayPhase, cal.moonPhase], `${minutes} min`).toEqual([8, 13, 'tag', 0]);
    }
    // Ticking through the midnight between day 7 and 8.
    const cal = new Calendar(clock());
    setTime(cal.clock, 7, 23.99);
    const seen = new Set<Season>();
    for (let i = 0; i < 2 * cal.clock.ticksPerGameMinute; i++) {
      cal.clock.advance();
      seen.add(cal.season);
    }
    expect([...seen]).toEqual(['fruehling', 'sommer']);
  });

  it('changing the season length keeps the current season and day, and past days', () => {
    const cal = new Calendar(clock());
    setTime(cal.clock, 10, 12); // summer, day 3 of 7
    cal.setSeasonLength(14);
    expect([cal.season, cal.dayOfSeason, cal.seasonLengthDays]).toEqual(['sommer', 3, 14]);
    expect(cal.seasonDayOf(5)).toMatchObject({ season: 'fruehling', dayOfSeason: 5, seasonLengthDays: 7 });
    expect(cal.seasonDayOf(21)).toMatchObject({ season: 'sommer', dayOfSeason: 14 });
    expect(cal.seasonDayOf(22)).toMatchObject({ season: 'herbst', dayOfSeason: 1 });
    // Shortening clamps the day of season: day 6 of summer → last day of a 3 day summer.
    setTime(cal.clock, 13, 12);
    cal.setSeasonLength(3);
    expect([cal.season, cal.dayOfSeason]).toEqual(['sommer', 3]);
    expect(cal.seasonOfDay(14)).toBe('herbst');
    expect(cal.seasonDayOf(10)).toMatchObject({ season: 'sommer', dayOfSeason: 3, seasonLengthDays: 14 });
    expect(cal.seasonSegments()).toHaveLength(3);
    // Same length again: no new segment; changing twice on one day replaces that day's segment.
    cal.setSeasonLength(3);
    expect(cal.seasonSegments()).toHaveLength(3);
    cal.setSeasonLength(5);
    expect(cal.seasonSegments()).toHaveLength(3);
    expect([cal.season, cal.dayOfSeason, cal.seasonLengthDays]).toEqual(['sommer', 5, 5]);
    expect(() => cal.setSeasonLength(20)).toThrow(RangeError);
    expect(() => cal.seasonDayOf(0)).toThrow(RangeError);
  });
});

describe('moon (§10: 8-day cycle, Finstermond)', () => {
  it('cycles through 8 phases; first full moon night 4, first Finstermond night 8', () => {
    expect(Array.from({ length: 17 }, (_, i) => moonPhaseOfNight(i + 1))).toEqual([1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
    const finstermond = Array.from({ length: 40 }, (_, i) => i + 1).filter((n) => isFinstermondPhase(moonPhaseOfNight(n)));
    expect(finstermond).toEqual([8, 16, 24, 32, 40]);
  });

  it('a night keeps one phase from noon to noon', () => {
    expect(nightOf(9, 3)).toBe(8);
    expect(nightOf(8, 13)).toBe(8);
    expect(calendarAt(8, 11).moonPhase).toBe(7);
    expect(calendarAt(8, 13).isFinstermond).toBe(true);
    expect(calendarAt(8, 23).isFinstermond).toBe(true);
    expect(calendarAt(9, 3).isFinstermond).toBe(true);
    expect(calendarAt(9, 12.5).isFinstermond).toBe(false);
    expect(calendarAt(4, 22).isFullMoon).toBe(true);
    // The first morning belongs to night 1 (there is no night 0).
    expect([calendarAt(1, 8).night, calendarAt(1, 8).isFinstermond]).toEqual([1, false]);
  });

  it('illumination: new moon dark, full moon brightest, symmetric', () => {
    expect(moonIllumination(0)).toBe(0);
    expect(moonIllumination(4)).toBe(1);
    for (let p = 1; p < 8; p++) {
      expect(moonIllumination(p)).toBeCloseTo(moonIllumination(8 - p), 12);
      expect(moonIllumination(p)).toBeGreaterThan(0);
    }
  });
});

describe('ambient light (§12.1)', () => {
  it('day 1.0, night 0.05–0.12 by moon phase, Finstermond 0.02', () => {
    expect(nightAmbientLight(0)).toBe(0.02);
    expect(nightAmbientLight(1)).toBeCloseTo(0.05, 12);
    expect(nightAmbientLight(7)).toBeCloseTo(0.05, 12);
    expect(nightAmbientLight(4)).toBeCloseTo(0.12, 12);
    for (let p = 1; p < 8; p++) {
      expect(nightAmbientLight(p)).toBeGreaterThanOrEqual(0.05 - 1e-12);
      expect(nightAmbientLight(p)).toBeLessThanOrEqual(0.12 + 1e-12);
    }
    expect(ambientLightAt(1, 0)).toBe(1);
    expect(calendarAt(3, 12).ambientLight).toBe(1);
    expect(calendarAt(4, 23).ambientLight).toBeCloseTo(0.12, 12);
    expect(calendarAt(8, 23).ambientLight).toBeCloseTo(0.02, 12);
    const dusk = calendarAt(4, 19).ambientLight;
    expect(dusk).toBeGreaterThan(0.12);
    expect(dusk).toBeLessThan(1);
  });
});

describe('sun and moon vectors (shadow pass)', () => {
  const out = createShadowVector();

  it('noon: shadows point north, short in summer, long in winter', () => {
    const lengths: number[] = [];
    for (const season of SEASONS) {
      sunShadowAt(season, 12, out);
      expect(out.dirX).toBeCloseTo(0, 12);
      expect(out.dirY).toBeCloseTo(-1, 12);
      expect(out.strength).toBe(1);
      expect(out.elevationDeg).toBeCloseTo(BALANCE.calendar.noonSunElevationDeg[season], 9);
      lengths.push(out.length);
    }
    const [spring, summer, autumn, winter] = lengths as [number, number, number, number];
    expect(spring).toBeCloseTo(1, 9);
    expect(autumn).toBeCloseTo(spring, 12);
    expect(summer).toBeLessThan(0.6);
    expect(winter).toBeGreaterThan(1.8);
  });

  it('morning shadows fall west and long, evening shadows east; the direction turns steadily', () => {
    sunShadowAt('fruehling', 6.5, out);
    expect(out.dirX).toBeLessThan(-0.95);
    expect(out.length).toBeGreaterThan(2.5);
    expect(out.length).toBeLessThanOrEqual(BALANCE.calendar.maxShadowLength);
    sunShadowAt('fruehling', 17.5, out);
    expect(out.dirX).toBeGreaterThan(0.95);
    let previous = -Infinity;
    for (let h = 6; h <= 18; h += 0.25) {
      sunShadowAt('fruehling', h, out);
      expect(Math.hypot(out.dirX, out.dirY)).toBeCloseTo(1, 12);
      expect(out.dirX).toBeGreaterThan(previous);
      expect(out.dirY).toBeLessThanOrEqual(1e-12);
      previous = out.dirX;
    }
  });

  it('no sun shadow at night, fading in after sunrise', () => {
    for (const h of [0, 3, 21, 23.5]) expect(sunShadowAt('winter', h, out).strength).toBe(0);
    expect(sunShadowAt('fruehling', 6, out).strength).toBe(0);
    const early = sunShadowAt('fruehling', 6.25, out).strength;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(1);
  });

  it('moon shadows: full moon at midnight points north, none on a Finstermond or by day', () => {
    const full = calendarAt(5, 0);
    expect(full.moonPhase).toBe(4);
    full.moon(out);
    expect(out.dirY).toBeCloseTo(-1, 9);
    expect(out.strength).toBeCloseTo(BALANCE.calendar.moonShadowStrength, 12);
    expect(calendarAt(9, 0).moon(out).strength).toBe(0);
    expect(calendarAt(5, 12).moon(out).strength).toBe(0);
    const v = createShadowVector();
    expect(full.shadow(v)).toBe(v);
    expect(v.strength).toBeCloseTo(BALANCE.calendar.moonShadowStrength, 12);
    const noon = calendarAt(5, 12);
    noon.shadow(v);
    expect([v.strength, v.dirY]).toEqual([1, -1]);
  });

  it('writes into the caller’s vector (no allocation per frame)', () => {
    const cal = calendarAt(3, 10);
    const v = createShadowVector();
    expect(cal.sun(v)).toBe(v);
    expect(cal.moon(v)).toBe(v);
    expect(cal.today).toBe(cal.today);
  });
});
