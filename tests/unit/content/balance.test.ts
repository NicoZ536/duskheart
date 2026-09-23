import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
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
