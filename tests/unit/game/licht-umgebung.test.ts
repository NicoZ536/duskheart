/**
 * M6-16f Umgebungslicht der echten Welt ohne Allokation je Kachel: `worldLightEnvironment().ambient` schreibt den Pegel in
 * einen Ausgabeparameter und rechnet den Oberflächenwert je Wetterregion und Uhrstand einmal (Tageslicht und Nachtlicht des
 * Mondes einmal je Uhrstand, das Wetter je Region und Wetterperiode). Geprüft wird, dass der Wert bitgleich bleibt mit
 * `ambientLevel` (src/world/lightmap/ambient.ts) aus Kalender und Wetterprobe je Kachel:
 * - über einen Tag (Mittag, Dämmerung, Mitternacht), über viele Kacheln verschiedener Regionen, im Untergrund 0;
 * - wenn sich das Wetter einer Region innerhalb desselben Ticks ändert (Debug-Befehl: die Wetterperiode zählt weiter);
 * - wenn sich die Tageslänge innerhalb eines Ticks ändert (Einstellung „Tageslänge“: der Uhrstand ist ein anderer).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGameCommand } from '../../../src/game/commands';
import { worldLightEnvironment } from '../../../src/game/light/environment';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import { NO_WEATHER_REGION } from '../../../src/world/climate/temperature';
import { createWeatherSample } from '../../../src/world/climate/weather';
import { ambientLevel } from '../../../src/world/lightmap/ambient';
import type { Layer } from '../../../src/world/model/coords';
import { worldDimensions } from '../../../src/world/model/worldSize';

const sample = createWeatherSample();

/** §12.1 per tile, computed afresh: calendar now, the weather over the tile (none outside every region). */
function expected(sim: Simulation, layer: Layer, tx: number, ty: number): number {
  const cal = sim.world.calendar;
  const region = layer === 0 ? sim.world.regionAt(tx, ty) : NO_WEATHER_REGION;
  const factor = region === NO_WEATHER_REGION ? 1 : sim.world.weather.sample(region, sample).lightFactor;
  return ambientLevel(layer, cal.daylight, cal.moonPhase, factor);
}

/** The world of the tests (small, the player standing): built once, its time only moves forward. */
let sim: Simulation;
beforeAll(() => {
  sim = createSimulation({ seed: 23, worldSize: 'small' });
  sim.step([parseGameCommand({ type: 'player.spawn' })]);
  sim.step();
}, 60_000);

const out = new Float64Array(2);

/**
 * Every 9th tile across the whole small world (regions, sea, coasts) on the surface and below: bit for bit. The tiles
 * that differ are collected and checked in one expect (one expect per tile were 150 000 calls, M6-93).
 */
function compareAll(sim: Simulation, env: ReturnType<typeof worldLightEnvironment>, label: string): number {
  let regions = 0;
  const seen = new Set<number>();
  const size = worldDimensions(sim.config.worldSize).tiles;
  const abweichend: string[] = [];
  for (let ty = 0; ty < size; ty += 9) {
    for (let tx = 0; tx < size; tx += 9) {
      for (const layer of [0, -1] as const) {
        out[1] = Number.NaN;
        env.ambient(sim, layer, tx, ty, out, 1);
        if (!Object.is(out[1], expected(sim, layer, tx, ty))) abweichend.push(`${label} ${layer}:${tx}:${ty}`);
      }
      const r = sim.world.regionAt(tx, ty);
      if (!seen.has(r)) {
        seen.add(r);
        regions++;
      }
    }
  }
  expect(abweichend).toEqual([]);
  return regions;
}

describe('Umgebungslicht je Region und Uhrstand (M6-16f)', () => {
  it('bitgleich mit Kalender und Wetter je Kachel – über den Tag, über alle Regionen, im Untergrund 0', () => {
    const env = worldLightEnvironment();
    for (const [hour, minute] of [
      [12, 0],
      [19, 40],
      [0, 0],
      [5, 30],
    ] as const) {
      sim.step([parseGameCommand({ type: 'setTime', hour, minute })]);
      sim.step();
      // Several weather regions and the sea beyond them.
      expect(compareAll(sim, env, `${hour}:${minute}`)).toBeGreaterThan(2);
    }
    env.ambient(sim, -2, 10, 10, out, 0);
    expect(out[0]).toBe(0);
  }, 30_000);

  it('eine Wetteränderung im selben Tick gilt sofort (die Wetterperiode der Region zählt weiter)', () => {
    const env = worldLightEnvironment();
    sim.step([parseGameCommand({ type: 'setTime', hour: 11, minute: 0 })]);
    sim.step();
    const size = worldDimensions(sim.config.worldSize).tiles;
    let tx = -1;
    let ty = -1;
    for (let y = 0; y < size && tx < 0; y += 7) for (let x = 0; x < size && tx < 0; x += 7) if (sim.world.regionAt(x, y) !== NO_WEATHER_REGION) [tx, ty] = [x, y];
    expect(tx).toBeGreaterThanOrEqual(0);
    env.ambient(sim, 0, tx, ty, out, 0);
    const before = out[0] as number;
    const region = sim.world.regionAt(tx, ty);
    const period = sim.world.weather.periodCount(region);
    // The same tick (the clock does not move): a thunderstorm forced over the region, then fully blended in.
    sim.world.weather.force(region, 'gewitter');
    expect(sim.world.weather.periodCount(region)).toBe(period + 1);
    env.ambient(sim, 0, tx, ty, out, 0);
    expect(Object.is(out[0], expected(sim, 0, tx, ty))).toBe(true);
    // An hour later (a time jump): the storm has blended in.
    sim.step([parseGameCommand({ type: 'setTime', hour: 12, minute: 0 })]);
    env.ambient(sim, 0, tx, ty, out, 0);
    expect(Object.is(out[0], expected(sim, 0, tx, ty))).toBe(true);
    expect(out[0]).toBeLessThan(before);
  }, 30_000);

  it('eine neue Tageslänge im selben Tick gilt sofort (ein anderer Uhrstand)', () => {
    const env = worldLightEnvironment();
    sim.step([parseGameCommand({ type: 'setTime', hour: 18, minute: 30 })]);
    sim.step();
    // An odd tick of the day: two thirds of it are no whole tick, the time of day moves back by a fraction (rounded down).
    if (sim.clock.dayTick % 2 === 0) sim.step();
    compareAll(sim, env, 'vorher');
    const before = sim.world.calendar.daylight;
    sim.clock.setDayLength(sim.clock.dayLengthMinutes === 36 ? 24 : 36);
    expect(sim.world.calendar.daylight).not.toBe(before);
    compareAll(sim, env, 'nachher');
  }, 30_000);
});
