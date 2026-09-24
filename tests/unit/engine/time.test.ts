import { describe, expect, it } from 'vitest';
import {
  CLOCK_SNAPSHOT_VERSION,
  DAY_LENGTH_OPTIONS,
  GameClock,
  isDayLength,
  ticksPerDayFor,
  type DayLengthMinutes,
} from '../../../src/engine/time';

const HZ = 60;

function clock(dayLengthMinutes: DayLengthMinutes = 24): GameClock {
  return new GameClock({ tickHz: HZ, worldTickHz: 1, dayLengthMinutes });
}

function advanceBy(c: GameClock, n: number): { world: number[]; daily: number[] } {
  const world: number[] = [];
  const daily: number[] = [];
  for (let i = 0; i < n; i++) {
    const flags = c.advance();
    if (flags.worldTick) world.push(c.tick);
    if (flags.dailyTick) daily.push(c.tick);
  }
  return { world, daily };
}

describe('GameClock', () => {
  it('starts at 06:00 of day 1', () => {
    const c = clock();
    expect(c.tick).toBe(0);
    expect(c.day).toBe(1);
    expect(c.hour).toBe(6);
    expect(c.minute).toBe(0);
    expect(c.minuteOfDay).toBe(360);
    expect(c.dayFraction).toBe(0.25);
    expect(c.dawns).toBe(0);
  });

  it('1 game hour = 1 real minute = 3600 ticks at a 24 minute day', () => {
    const c = clock(24);
    expect(c.ticksPerDay).toBe(24 * 60 * 60);
    expect(c.ticksPerGameHour).toBe(3600);
    expect(c.ticksPerGameMinute).toBe(60);
    advanceBy(c, 3599);
    expect(c.hour).toBe(6);
    expect(c.minute).toBe(59);
    advanceBy(c, 1);
    expect(c.hour).toBe(7);
    expect(c.minute).toBe(0);
    // One real minute of ticks = one game hour.
    advanceBy(c, HZ * 60);
    expect(c.hour).toBe(8);
  });

  it('game minutes advance every 60 ticks at a 24 minute day', () => {
    const c = clock(24);
    advanceBy(c, 59);
    expect(c.minuteOfDay).toBe(360);
    advanceBy(c, 1);
    expect(c.minuteOfDay).toBe(361);
  });

  it('fires the world tick every 60 ticks (1 Hz)', () => {
    const c = clock();
    const { world } = advanceBy(c, 600);
    expect(world).toHaveLength(10);
    expect(world).toEqual([60, 120, 180, 240, 300, 360, 420, 480, 540, 600]);
  });

  it('fires the daily tick exactly once per day when 06:00 is crossed', () => {
    const c = clock(12);
    const days = 3;
    const { daily } = advanceBy(c, c.ticksPerDay * days + 17);
    expect(daily).toEqual([c.ticksPerDay, c.ticksPerDay * 2, c.ticksPerDay * 3]);
    expect(c.dawns).toBe(days);
  });

  it('reports 06:00 and the new day number at the daily tick', () => {
    const c = clock();
    const seen: Array<{ day: number; hour: number; minute: number }> = [];
    for (let i = 0; i < c.ticksPerDay * 2; i++) {
      if (c.advance().dailyTick) seen.push({ day: c.day, hour: c.hour, minute: c.minute });
    }
    expect(seen).toEqual([
      { day: 2, hour: 6, minute: 0 },
      { day: 3, hour: 6, minute: 0 },
    ]);
  });

  it('changes the day number at midnight', () => {
    const c = clock();
    // 18 game hours after the 06:00 start is midnight.
    advanceBy(c, c.ticksPerGameHour * 18 - 1);
    expect(c.day).toBe(1);
    expect(c.hour).toBe(23);
    expect(c.minute).toBe(59);
    advanceBy(c, 1);
    expect(c.day).toBe(2);
    expect(c.hour).toBe(0);
    expect(c.minuteOfDay).toBe(0);
    expect(c.dayFraction).toBe(0);
  });

  it('computes dayFraction continuously from midnight', () => {
    const c = clock();
    advanceBy(c, c.ticksPerGameHour * 6);
    expect(c.hour).toBe(12);
    expect(c.dayFraction).toBe(0.5);
    advanceBy(c, c.ticksPerGameHour * 6);
    expect(c.hour).toBe(18);
    expect(c.dayFraction).toBe(0.75);
  });

  it('supports every selectable day length', () => {
    for (const len of DAY_LENGTH_OPTIONS) {
      const c = clock(len);
      expect(c.ticksPerDay).toBe(len * 60 * HZ);
      expect(ticksPerDayFor(len, HZ)).toBe(c.ticksPerDay);
      // A game hour lasts dayLength/24 real minutes.
      expect(c.ticksPerGameHour / HZ / 60).toBeCloseTo(len / 24, 12);
      const { daily } = advanceBy(c, c.ticksPerDay);
      expect(daily).toEqual([c.ticksPerDay]);
      expect(c.hour).toBe(6);
      expect(c.day).toBe(2);
    }
  });

  it('keeps the time of day when the day length changes', () => {
    const c = clock(24);
    advanceBy(c, c.ticksPerGameHour * 9 + c.ticksPerGameMinute * 30); // 15:30
    expect([c.hour, c.minute]).toEqual([15, 30]);
    const tick = c.tick;
    c.setDayLength(48);
    expect(c.tick).toBe(tick);
    expect(c.dayLengthMinutes).toBe(48);
    expect([c.hour, c.minute]).toEqual([15, 30]);
    expect(c.ticksPerGameHour).toBe(7200);
    c.setDayLength(12);
    expect([c.hour, c.minute]).toEqual([15, 30]);
    const { daily } = advanceBy(c, c.ticksPerGameHour * 15);
    expect(daily).toHaveLength(1);
    expect([c.day, c.hour, c.minute]).toEqual([2, 6, 30]);
  });

  it('setTick derives the time of day for a constant day length', () => {
    const c = clock();
    c.setTick(c.ticksPerDay * 2 + c.ticksPerGameHour * 3);
    expect(c.dawns).toBe(2);
    expect(c.day).toBe(3);
    expect(c.hour).toBe(9);
    const reference = clock();
    advanceBy(reference, c.tick);
    expect(reference.serialize()).toEqual(c.serialize());
    expect(() => c.setTick(-1)).toThrow(RangeError);
    expect(() => c.setTick(1.5)).toThrow(RangeError);
  });

  it('skip jumps like advancing tick by tick, also after a day length change, and counts the dawns', () => {
    const stepped = clock(24);
    const jumped = clock(24);
    advanceBy(stepped, 5000);
    jumped.skip(5000);
    stepped.setDayLength(12);
    jumped.setDayLength(12);
    const { daily } = advanceBy(stepped, 100_000);
    expect(jumped.skip(100_000)).toBe(daily.length);
    expect(jumped.serialize()).toEqual(stepped.serialize());
    expect(jumped.skip(0)).toBe(0);
    expect(() => jumped.skip(-1)).toThrow(RangeError);
    expect(() => jumped.skip(1.5)).toThrow(RangeError);
  });

  it('serializes and restores the exact state', () => {
    const c = clock();
    advanceBy(c, 12345);
    c.setDayLength(36);
    advanceBy(c, 777);
    const snap = c.serialize();
    expect(snap.version).toBe(CLOCK_SNAPSHOT_VERSION);
    const restored = clock(24);
    restored.deserialize(JSON.parse(JSON.stringify(snap)));
    expect(restored.serialize()).toEqual(snap);
    expect(restored.dayLengthMinutes).toBe(36);
    for (let i = 0; i < 5000; i++) expect(restored.advance()).toBe(c.advance());
    expect(restored.serialize()).toEqual(c.serialize());
  });

  it('rejects malformed snapshots and keeps its state', () => {
    const c = clock();
    advanceBy(c, 100);
    const before = c.serialize();
    expect(() => c.deserialize(null)).toThrow(TypeError);
    expect(() => c.deserialize({ ...before, version: 99 })).toThrow(TypeError);
    expect(() => c.deserialize({ ...before, dayLengthMinutes: 25 })).toThrow(TypeError);
    expect(() => c.deserialize({ ...before, tick: -3 })).toThrow(TypeError);
    expect(() => c.deserialize({ ...before, dayTick: c.ticksPerDay })).toThrow(/dayTick/);
    expect(() => c.deserialize({ ...before, extra: 1 })).toThrow(TypeError);
    expect(c.serialize()).toEqual(before);
  });

  it('validates its options', () => {
    expect(() => new GameClock({ tickHz: 0, worldTickHz: 1, dayLengthMinutes: 24 })).toThrow(RangeError);
    expect(() => new GameClock({ tickHz: 60, worldTickHz: 7, dayLengthMinutes: 24 })).toThrow(RangeError);
    expect(() => new GameClock({ tickHz: 60, worldTickHz: 1, dayLengthMinutes: 30 as DayLengthMinutes })).toThrow(RangeError);
    expect(() => clock().setDayLength(5 as DayLengthMinutes)).toThrow(RangeError);
    expect(isDayLength(24)).toBe(true);
    expect(isDayLength(25)).toBe(false);
  });

  it('never allocates flag objects in advance()', () => {
    const c = clock();
    const first = c.advance();
    const second = c.advance();
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
