import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BALANCE, SEASON_IDS } from '../../../src/content/balance';
import { deepFreeze } from '../../../src/content/freeze';
import { DAY_LENGTH_OPTIONS, isDayLength } from '../../../src/engine/time';

describe('BALANCE', () => {
  it('holds the M0 values from the spec', () => {
    expect(BALANCE.time.tickHz).toBe(60);
    expect(BALANCE.time.worldTickHz).toBe(1);
    expect(BALANCE.time.maxCatchUpSteps).toBe(5);
    expect(BALANCE.time.defaultDayLengthMinutes).toBe(24);
    expect(isDayLength(BALANCE.time.defaultDayLengthMinutes)).toBe(true);
    expect(DAY_LENGTH_OPTIONS).toContain(BALANCE.time.defaultDayLengthMinutes);
    expect(Number.isInteger(BALANCE.time.tickHz / BALANCE.time.worldTickHz)).toBe(true);
    expect(BALANCE.world.sizeTiles).toEqual({ small: 1024, medium: 1536, large: 2048 });
    expect(BALANCE.world.defaultSize).toBe('medium');
    expect(BALANCE.motion.walkSpeedTilesPerSecond).toBe(4.5);
  });

  it('holds the M2 world, calendar and gathering values from the spec', () => {
    expect(BALANCE.world.regionCount).toEqual({ small: 40, medium: 70, large: 110 });
    expect([BALANCE.world.maxHeightLevel, BALANCE.world.temperaturePerHeightLevelC]).toEqual([4, -3]);
    const c = BALANCE.calendar;
    expect([c.defaultSeasonLengthDays, c.minSeasonLengthDays, c.maxSeasonLengthDays]).toEqual([7, 3, 14]);
    expect(c.nightHours).toEqual({ fruehling: 8, sommer: 5, herbst: 8, winter: 11 });
    expect([c.twilightHours, c.moonCycleDays]).toEqual([2, 8]);
    expect(c.seasonTemperatureOffsetC).toEqual({ fruehling: 0, sommer: 8, herbst: -3, winter: -14 });
    expect([c.dayAmbientLight, c.nightAmbientMin, c.nightAmbientMax, c.finstermondAmbientLight]).toEqual([1, 0.05, 0.12, 0.02]);
    for (const season of SEASON_IDS) expect(c.nightHours[season] + 2 * c.twilightHours).toBeLessThan(24);
    expect([BALANCE.gathering.hitsWithTierTool, BALANCE.gathering.nodeRegrowDays]).toEqual([5, 7]);
  });

  it('holds the streaming and active zone radii (docs/WORLD.md §5, §12.4 spawn ring inside the zone)', () => {
    const st = BALANCE.stream;
    expect([st.surfaceLoadRadiusChunks, st.undergroundLoadRadiusChunks, st.activeRadiusChunks, st.hysteresisChunks, st.retainedLayers]).toEqual([4, 3, 2, 1, 1]);
    // The zone is loaded one ring ahead on every layer, and 40 tiles (§12.4) fit into the radius.
    expect(Math.min(st.surfaceLoadRadiusChunks, st.undergroundLoadRadiusChunks)).toBeGreaterThanOrEqual(st.activeRadiusChunks + 1);
    expect(st.activeRadiusChunks * 32).toBeGreaterThanOrEqual(40);
    expect([st.jobFrameBudgetMs, st.maxJobsInFlight]).toEqual([1, 4]);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(BALANCE)).toBe(true);
    expect(Object.isFrozen(BALANCE.time)).toBe(true);
    expect(Object.isFrozen(BALANCE.world.sizeTiles)).toBe(true);
    expect(() => {
      (BALANCE.time as { tickHz: number }).tickHz = 30;
    }).toThrow(TypeError);
  });

  it('documents every value with a unit and a reason', () => {
    const source = readFileSync(fileURLToPath(new URL('../../../src/content/balance.ts', import.meta.url)), 'utf8');
    const body = source.slice(source.indexOf('export const BALANCE'));
    const lines = body.split('\n');
    const valueLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => /^\s+[a-zA-Z]+: .*,\s*$/.test(l));
    expect(valueLines.length).toBeGreaterThan(0);
    for (const { l, i } of valueLines) {
      // The doc comment directly above a value must name a unit in brackets and give a reason.
      let j = i - 1;
      const doc: string[] = [];
      while (j >= 0 && /^\s*(\/\*\*|\*)/.test(lines[j] ?? '')) doc.unshift(lines[j--] ?? '');
      const text = doc.join(' ');
      expect(text, `value line: ${l.trim()}`).toMatch(/\[[^\]]+\]/);
      expect(text.replace(/\[[^\]]+\]/, '').replace(/[/*\s]/g, '').length, `reason for: ${l.trim()}`).toBeGreaterThan(10);
    }
  });
});

describe('deepFreeze', () => {
  it('freezes nested data but leaves typed arrays writable', () => {
    const data = deepFreeze({ a: { b: [1, { c: 2 }] }, buf: new Uint8Array(2) });
    expect(Object.isFrozen(data.a.b)).toBe(true);
    expect(Object.isFrozen(data.a.b[1])).toBe(true);
    data.buf[0] = 7;
    expect(data.buf[0]).toBe(7);
  });
});
