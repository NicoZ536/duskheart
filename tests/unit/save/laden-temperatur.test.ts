/**
 * Speichern → Laden → weiter (ADR-0024) für das Temperaturfeld (Review M6, savedet:temperature-minute-float): Das Feld
 * hält seine Zeitterme für den letzten Welttick und speichert nichts; ein geladenes Spiel baut sie im ersten Tick nach dem
 * Laden neu – in irgendeinem Tick der Sekunde, nicht im Welttick. Die Minute des Weltticks, die Lufttemperatur je Biom und
 * der Wetterversatz je Region müssen dann Bit für Bit dieselben sein wie im ununterbrochenen Lauf, der sie im Welttick
 * selbst gebildet hat – auch wenn 06:00 mitten in die Sekunde fällt (eine Uhr aus einem Spielstand hat ihre Morgendämmerung
 * nicht zwingend auf dem Welttick-Raster).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CLOCK_SNAPSHOT_VERSION, GameClock, type DayLengthMinutes, type GameClockSnapshot } from '../../../src/engine/time';
import { Calendar } from '../../../src/world/calendar';
import { TemperatureField, WeatherSystem } from '../../../src/world/climate';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const SURFACE = ['gruenhain', 'salzkueste', 'nebelmoor', 'frostkamm', 'glutsand', 'aschenschlund', 'scherbenhain', 'nachtherz'] as const;
/** Ticks per world tick. */
const SECOND = BALANCE.time.tickHz / BALANCE.time.worldTickHz;

function newClock(dayLengthMinutes: DayLengthMinutes): GameClock {
  return new GameClock({ tickHz: BALANCE.time.tickHz, worldTickHz: BALANCE.time.worldTickHz, dayLengthMinutes });
}

/** The time terms a field holds for the current world tick: its minute, the air of every biome, the weather of every region. */
function terms(field: TemperatureField): number[] {
  const out = [field.sampleMinute];
  const biomes = contentWorldIdTables().biomes.size;
  for (let b = 1; b <= biomes; b++) out.push(field.biomeAirC(b, 0));
  // `regionAt` below maps tile x to the region.
  for (let r = 0; r < SURFACE.length; r++) out.push(field.weatherOffsetAt(r, 0));
  return out;
}

/**
 * Runs a clock from `start` (a world tick) for `ticks` ticks like the simulation – weather, then temperature on every world
 * tick – and builds a fresh field, as after loading, at every tick: its terms must equal those the running field formed at
 * the world tick of that second. Returns the ticks compared and the ticks at which 06:00 fell inside a second.
 */
function compareFromEveryTick(start: GameClockSnapshot, ticks: number): { compared: number; dawnsInsideASecond: number } {
  const clock = newClock(start.dayLengthMinutes);
  clock.deserialize(start);
  expect(clock.tick % SECOND).toBe(0);
  const calendar = new Calendar(clock);
  const weather = new WeatherSystem(calendar, 7, [...SURFACE]);
  const regionAt = (tx: number): number => tx;
  const running = new TemperatureField({ calendar, weather, regionAt });
  weather.worldTick();
  running.worldTick();
  let compared = 0;
  let dawnsInsideASecond = 0;
  for (let i = 0; i < ticks; i++) {
    const dawnsBefore = clock.dawns;
    const due = clock.advance();
    if (clock.dawns !== dawnsBefore && clock.tick % SECOND !== 0) dawnsInsideASecond++;
    if (due.worldTick) {
      weather.worldTick();
      running.worldTick();
    }
    const expected = terms(running);
    // The loaded game: a clock restored from the save, a calendar and a field that never sampled.
    const loadedClock = newClock(start.dayLengthMinutes);
    loadedClock.deserialize(clock.serialize());
    const loaded = new TemperatureField({ calendar: new Calendar(loadedClock), weather, regionAt });
    const got = terms(loaded);
    for (let k = 0; k < expected.length; k++) {
      if (!Object.is(got[k], expected[k])) throw new Error(`tick ${clock.tick} (second offset ${clock.tick % SECOND}), term ${k}: ${String(got[k])} ≠ ${String(expected[k])}`);
    }
    compared++;
  }
  return { compared, dawnsInsideASecond };
}

describe('Temperaturfeld nach dem Laden', () => {
  it('baut aus jedem Tick der Sekunde dieselben Zeitterme wie im Welttick – auch wenn 06:00 mitten in der Sekunde liegt', () => {
    // 12-minute days; a world tick 230 ticks before dawn: 06:00 falls 50 ticks into a second.
    const perDay = newClock(12).ticksPerDay;
    const run = compareFromEveryTick({ version: CLOCK_SNAPSHOT_VERSION, tick: 37 * SECOND * 60, dayLengthMinutes: 12, dawns: 3, dayTick: perDay - 230 }, 12 * SECOND);
    expect(run.compared).toBe(12 * SECOND);
    expect(run.dawnsInsideASecond).toBe(1);
  });

  it('baut aus jedem Tick der Sekunde dieselben Zeitterme wie im Welttick – am Abend des Referenzspielstands', () => {
    // 24-minute days, from the world tick before the reference save's tick 48 315 (≈ 19:25 of day 1) on, 40 seconds.
    const start = 48_300;
    const run = compareFromEveryTick({ version: CLOCK_SNAPSHOT_VERSION, tick: start, dayLengthMinutes: 24, dawns: 0, dayTick: start }, 40 * SECOND);
    expect(run.compared).toBe(40 * SECOND);
    expect(run.dawnsInsideASecond).toBe(0);
  });
});
