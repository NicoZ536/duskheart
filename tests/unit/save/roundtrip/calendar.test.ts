import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../../src/content/balance';
import { GameClock } from '../../../../src/engine/time';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { Calendar } from '../../../../src/world/calendar';

function freshCalendar(): Calendar {
  return new Calendar(new GameClock({ tickHz: BALANCE.time.tickHz, worldTickHz: BALANCE.time.worldTickHz, dayLengthMinutes: BALANCE.time.defaultDayLengthMinutes }));
}

describe('save roundtrip: calendar', () => {
  it('restores the season length history', () => {
    const report = expectRoundtrip(
      freshCalendar,
      (cal) => {
        cal.clock.setTick(cal.clock.ticksPerDay * 9 + 1234);
        cal.setSeasonLength(12);
        cal.clock.setTick(cal.clock.ticksPerDay * 40);
        cal.setSeasonLength(4);
      },
      (cal) => cal.save,
    );
    expect(report.id).toBe('calendar');
    expect(report.transports).toEqual(['structuredClone', 'json']);
  });

  it('restored calendars place every day in the same season', () => {
    const source = freshCalendar();
    source.clock.setTick(source.clock.ticksPerDay * 17);
    source.setSeasonLength(3);
    const target = freshCalendar();
    target.save.deserialize(JSON.parse(JSON.stringify(source.save.serialize())));
    for (let day = 1; day <= 80; day++) expect(target.seasonDayOf(day)).toEqual(source.seasonDayOf(day));
  });

  it('rejects malformed snapshots and keeps its state', () => {
    const cal = freshCalendar();
    const before = cal.save.serialize();
    const bad: unknown[] = [
      null,
      { segments: [] },
      { segments: [{ fromDay: 2, lengthDays: 7, season: 0, dayOfSeason: 1 }] },
      { segments: [{ fromDay: 1, lengthDays: 2, season: 0, dayOfSeason: 1 }] },
      {
        segments: [
          { fromDay: 1, lengthDays: 7, season: 0, dayOfSeason: 1 },
          { fromDay: 1, lengthDays: 5, season: 0, dayOfSeason: 1 },
        ],
      },
      { segments: [{ fromDay: 1, lengthDays: 7, season: 0, dayOfSeason: 1 }], extra: true },
    ];
    for (const data of bad) expect(() => cal.save.deserialize(data)).toThrow(TypeError);
    expect(cal.save.serialize()).toEqual(before);
  });
});
