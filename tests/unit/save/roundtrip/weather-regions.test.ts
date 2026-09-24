import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../../src/content/balance';
import { GameClock } from '../../../../src/engine/time';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { Calendar } from '../../../../src/world/calendar';
import { WeatherSystem, minuteOf } from '../../../../src/world/climate';

const REGIONS = ['gruenhain', 'salzkueste', 'frostkamm', 'glutsand', 'scherbenhain'];

function freshWeather(regions: readonly string[] = REGIONS): WeatherSystem {
  const clock = new GameClock({ tickHz: BALANCE.time.tickHz, worldTickHz: BALANCE.time.worldTickHz, dayLengthMinutes: BALANCE.time.defaultDayLengthMinutes });
  return new WeatherSystem(new Calendar(clock), 4711, regions);
}

describe('save roundtrip: weather-regions', () => {
  it('restores the weather periods of every region', () => {
    const report = expectRoundtrip(
      () => freshWeather(),
      (w) => {
        w.advanceTo(minuteOf(12, 19.5));
        w.calendar.clock.setTick(w.calendar.clock.ticksPerDay * 11);
        w.force(2, 'schneesturm');
      },
      (w) => w.save,
    );
    expect(report.id).toBe('weather-regions');
    expect(report.transports).toEqual(['structuredClone', 'json']);
  });

  it('restored weather continues exactly like the original', () => {
    const source = freshWeather();
    source.advanceTo(minuteOf(8, 3));
    const target = freshWeather();
    target.save.deserialize(JSON.parse(JSON.stringify(source.save.serialize())));
    source.advanceTo(minuteOf(33, 21));
    target.advanceTo(minuteOf(33, 21));
    expect(target.save.serialize()).toEqual(source.save.serialize());
  });

  it('rejects malformed snapshots and snapshots of another world, keeping its state', () => {
    const w = freshWeather();
    w.advanceTo(minuteOf(5, 0));
    const before = w.save.serialize();
    const ok = JSON.parse(JSON.stringify(before)) as Record<string, unknown[]>;
    const bad: unknown[] = [
      null,
      { ...ok, extra: 1 },
      { ...ok, state: ['klar'] },
      { ...ok, state: (ok['state'] ?? []).map(() => 'orkan') },
      { ...ok, endMinute: ok['startMinute'] },
      { ...ok, changes: (ok['changes'] ?? []).map(() => -1) },
      { ...ok, biomes: ['gruenhain'], state: ['klar'], previous: ['klar'], startMinute: [0], endMinute: [60], changes: [1] },
      { ...ok, biomes: [...(ok['biomes'] ?? [])].reverse() },
    ];
    for (const data of bad) expect(() => w.save.deserialize(data)).toThrow(TypeError);
    expect(w.save.serialize()).toEqual(before);
    expect(() => freshWeather(['gruenhain']).save.deserialize(before)).toThrow(/do not match/);
  });

  it('roundtrips through the simulation: one region per plan region', () => {
    const config = { seed: 20260924, worldSize: 'small', dayLengthMinutes: 12 } as const;
    const report = expectRoundtrip(
      () => createSimulation(config),
      (sim) => {
        for (let i = 0; i < 60 * 90; i++) sim.step();
        sim.world.weather.force(1, 'nebel');
      },
      (sim) => sim.participant('weather-regions'),
    );
    const data = JSON.parse(report.canonical) as { biomes: string[] };
    expect(data.biomes).toEqual(createSimulation(config).world.generated.plan.regions.map((r) => r.biome));
  });
});
