/**
 * M3-18: temperature model of §11.2 – felt temperature (ambient + fire +15 °C in the core, falling off
 * + room value), comfort band [18 − insulation × (1 − 0,7 × wetness), 26 + cooling], core change
 * 0,002 °C/s × stress or return at 0,01 °C/s, the six stages with every threshold (36 / 35 / 33 / 38 /
 * 39 / 40,5 °C) and their effects – as pure functions and in the vitals system.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { maxStamina, staminaRegenPerSecond, thirstDrainPerSecond, fullScalePerSecond, actionSpeedFactor, precisionFactor } from '../../../src/game/survival/formulas';
import {
  clampCooling,
  clampInsulation,
  comfortBand,
  coreRatePerSecond,
  feltTemperatureC,
  heatSourceC,
  stageAtLeast,
  stepCoreTemperature,
  temperatureDamagePerSecond,
  temperatureMaxStaminaFactor,
  temperatureStaminaRegenFactor,
  temperatureStage,
  temperatureWorkFactor,
  thermalStress,
} from '../../../src/game/survival/temperature';
import { worldSurvivalEnvironment } from '../../../src/game/survival/environment';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { VitalsSystem } from '../../../src/game/survival/system';
import { TILE_PX } from '../../../src/world/model/coords';
import { T, meadow, testEnvironment, testWorld } from './spieler-testwelt';

const TEMP = BALANCE.survival.temperature;
const TICK = BALANCE.time.tickHz;

describe('gefühlte Temperatur und Wärmequellen', () => {
  it('felt = ambient + heat of sources + room value', () => {
    expect(feltTemperatureC(8, 0, 0)).toBe(8);
    expect(feltTemperatureC(8, 15, 0)).toBe(23);
    expect(feltTemperatureC(-4, 15, 6)).toBe(17);
  });

  it('a fire warms +15 °C in its core and falls off linearly to its edge', () => {
    const { coreHeatC, coreRadiusTiles, radiusTiles } = TEMP.fire;
    expect(coreHeatC).toBe(15);
    const core = coreRadiusTiles * TILE_PX;
    const edge = radiusTiles * TILE_PX;
    expect(heatSourceC(0, coreHeatC, core, edge)).toBe(15);
    expect(heatSourceC(core, coreHeatC, core, edge)).toBe(15);
    expect(heatSourceC((core + edge) / 2, coreHeatC, core, edge)).toBeCloseTo(7.5, 12);
    expect(heatSourceC(edge, coreHeatC, core, edge)).toBe(0);
    expect(heatSourceC(edge + 1, coreHeatC, core, edge)).toBe(0);
  });
});

describe('Komfortband und Stress', () => {
  it('band = [18 − insulation × (1 − 0,7 × wetness), 26 + cooling]', () => {
    expect(comfortBand(0, 0, 0)).toEqual({ low: 18, high: 26 });
    expect(comfortBand(20, 5, 0)).toEqual({ low: -2, high: 31 });
    // Soaked: 70 % of the insulation is lost.
    expect(comfortBand(20, 0, 100).low).toBeCloseTo(18 - 20 * 0.3, 12);
    expect(comfortBand(20, 0, 50).low).toBeCloseTo(18 - 20 * 0.65, 12);
    // Clothing ranges 0–40 and 0–15.
    expect([clampInsulation(55), clampInsulation(-3), clampCooling(20), clampCooling(-1)]).toEqual([40, 0, 15, 0]);
    expect(comfortBand(99, 99, 0)).toEqual({ low: 18 - 40, high: 26 + 15 });
  });

  it('stress is the distance to the band: negative in the cold, positive in the heat, 0 inside', () => {
    expect(thermalStress(10, 18, 26)).toBe(-8);
    expect(thermalStress(30, 18, 26)).toBe(4);
    expect(thermalStress(18, 18, 26)).toBe(0);
    expect(thermalStress(26, 18, 26)).toBe(0);
  });
});

describe('Kerntemperatur', () => {
  it('changes by 0,002 °C/s per degree of stress; returns to 37,0 at 0,01 °C/s without overshooting', () => {
    expect(coreRatePerSecond(-10, 37)).toBeCloseTo(-0.02, 15);
    expect(coreRatePerSecond(5, 37)).toBeCloseTo(0.01, 15);
    expect(coreRatePerSecond(0, 36)).toBe(0.01);
    expect(coreRatePerSecond(0, 38)).toBe(-0.01);
    expect(coreRatePerSecond(0, 37)).toBe(0);
    expect(stepCoreTemperature(37, -10, 1)).toBeCloseTo(36.98, 12);
    expect(stepCoreTemperature(36.995, 0, 1)).toBe(37);
    expect(stepCoreTemperature(37.004, 0, 1)).toBe(37);
    expect(stepCoreTemperature(36.5, 0, 10)).toBeCloseTo(36.6, 12);
    // Bounded to [28, 44] °C.
    expect(stepCoreTemperature(28.01, -40, 10)).toBe(TEMP.coreMinC);
    expect(stepCoreTemperature(43.9, 40, 10)).toBe(TEMP.coreMaxC);
  });

  it('stages at every threshold (exclusive): 36 / 35 / 33 / 38 / 39 / 40,5 °C', () => {
    const cases: Array<[number, string]> = [
      [37, 'normal'],
      [36, 'normal'],
      [35.999, 'frierend'],
      [35, 'frierend'],
      [34.999, 'unterkuehlt'],
      [33, 'unterkuehlt'],
      [32.999, 'erfrierend'],
      [28, 'erfrierend'],
      [38, 'normal'],
      [38.001, 'erhitzt'],
      [39, 'erhitzt'],
      [39.001, 'ueberhitzt'],
      [40.5, 'ueberhitzt'],
      [40.501, 'hitzschlag'],
      [44, 'hitzschlag'],
    ];
    for (const [core, stage] of cases) expect(temperatureStage(core), `${core} °C`).toBe(stage);
  });

  it('stage effects: Frierend −10 % precision/work, Unterkühlt −30 % max stamina and −0,5 HP/s, Erfrierend −2 HP/s', () => {
    expect([temperatureWorkFactor('normal'), temperatureWorkFactor('frierend'), temperatureWorkFactor('unterkuehlt'), temperatureWorkFactor('erfrierend')]).toEqual([1, 0.9, 0.9, 0.9]);
    expect(precisionFactor('frierend')).toBe(0.9);
    expect(actionSpeedFactor(0, 'frierend')).toBe(0.9);
    expect([temperatureMaxStaminaFactor('frierend'), temperatureMaxStaminaFactor('unterkuehlt'), temperatureMaxStaminaFactor('erfrierend')]).toEqual([1, 0.7, 0.7]);
    expect(maxStamina(0, 1, 'unterkuehlt')).toBeCloseTo(70, 12);
    expect([temperatureDamagePerSecond('frierend'), temperatureDamagePerSecond('unterkuehlt'), temperatureDamagePerSecond('erfrierend')]).toEqual([0, 0.5, 2]);
  });

  it('stage effects: Erhitzt thirst ×1,5, Überhitzt −50 % stamina regeneration and −0,5 HP/s, Hitzschlag −2 HP/s', () => {
    const base = fullScalePerSecond(BALANCE.survival.thirst.minutesToEmpty);
    expect(thirstDrainPerSecond(false, 'normal')).toBeCloseTo(base, 15);
    expect(thirstDrainPerSecond(false, 'erhitzt')).toBeCloseTo(base * 1.5, 15);
    expect(thirstDrainPerSecond(true, 'hitzschlag')).toBeCloseTo(base * 1.5, 15);
    expect([temperatureStaminaRegenFactor('erhitzt'), temperatureStaminaRegenFactor('ueberhitzt'), temperatureStaminaRegenFactor('hitzschlag')]).toEqual([1, 0.5, 0.5]);
    expect(staminaRegenPerSecond({ satiety: 100, exhaustion: 0, temperature: 'ueberhitzt', restSeconds: 1, factor: 1 })).toBe(12.5);
    expect([temperatureDamagePerSecond('erhitzt'), temperatureDamagePerSecond('ueberhitzt'), temperatureDamagePerSecond('hitzschlag')]).toEqual([0, 0.5, 2]);
    expect(stageAtLeast('hitzschlag', 'erhitzt')).toBe(true);
    expect(stageAtLeast('frierend', 'erhitzt')).toBe(false);
    expect(stageAtLeast('erfrierend', 'frierend')).toBe(true);
    expect(stageAtLeast('normal', 'normal')).toBe(true);
  });
});

describe('Temperaturmodell im Vitalsystem', () => {
  it('in the cold the core falls by 0,002 °C/s per degree of stress and the stages follow with their damage', () => {
    const env = testEnvironment(8);
    const w = testWorld(meadow(10, 10), env);
    w.spawn(5, 5);
    const c0 = w.vit().coreC;
    w.run(TICK);
    const v = w.vit();
    expect([v.ambientC, v.heatC, v.roomC, v.feltC, v.bandLowC, v.bandHighC]).toEqual([8, 0, 0, 8, 18, 26]);
    // Stress −10 ⇒ −0,02 °C/s.
    expect(v.coreRateCps).toBeCloseTo(-0.02, 9);
    expect(c0 - v.coreC).toBeCloseTo(0.02, 9);
    // Set just above the threshold: one second later Frierend is reported, then Unterkühlt damages.
    v.coreC = 36.01;
    const events = w.run(TICK);
    expect(events.get('survivalStageChanged')).toEqual([expect.objectContaining({ stat: 'temperature', stage: 'frierend', previous: 'normal' })]);
    v.coreC = 34.5;
    const hurt = w.run(2 * TICK);
    expect(hurt.get('survivalStageChanged')).toEqual([expect.objectContaining({ stat: 'temperature', stage: 'unterkuehlt' })]);
    expect(hurt.get('playerDamaged')).toEqual([expect.objectContaining({ cause: 'kaelte' }), expect.objectContaining({ cause: 'kaelte' })]);
    expect(w.vit().health).toBeCloseTo(100 - 2 * 0.5, 6);
    // Hypothermia caps the stamina at 70 %.
    expect(w.vit().maxStamina).toBeCloseTo(70, 9);
    expect(w.vit().stamina).toBeLessThanOrEqual(70);
  });

  it('a fire in reach warms: felt temperature +15 °C in its core, the core returns to 37,0 at 0,01 °C/s', () => {
    const env = testEnvironment(8);
    const w = testWorld(meadow(20, 10), env);
    w.spawn(5, 5);
    const at = w.centre(6, 5);
    w.influences.addHeatSources(() => [{ x: at.x, y: at.y, layer: 0, coreHeatC: TEMP.fire.coreHeatC, coreRadiusPx: TEMP.fire.coreRadiusTiles * T, radiusPx: TEMP.fire.radiusTiles * T }]);
    w.vit().coreC = 36;
    w.run(TICK);
    const v = w.vit();
    expect(v.heatC).toBe(15);
    expect(v.feltC).toBe(23);
    expect(v.coreRateCps).toBeCloseTo(0.01, 9);
    expect(v.coreC).toBeCloseTo(36.01, 6);
    // Two fires do not add up: the warmest one counts.
    w.influences.addHeatSources(() => [{ x: at.x, y: at.y, layer: 0, coreHeatC: 10, coreRadiusPx: T, radiusPx: 4 * T }]);
    w.run(1);
    expect(w.vit().heatC).toBe(15);
    // Out of reach (5 tiles away and more) the fire warms nothing.
    w.run(1, [{ type: 'player.teleport', x: at.x + 6 * T, y: at.y, layer: 0 }]);
    expect(w.vit().heatC).toBe(0);
  });

  it('insulation and wetness shape the band; the room value adds to the felt temperature', () => {
    const env = testEnvironment(10);
    const w = testWorld(meadow(10, 10), env);
    w.spawn(5, 5);
    let insulation = 20;
    let room = 0;
    w.influences.addModifierSource((_s, _p, m) => {
      m.insulation = insulation;
      m.roomTemperatureC = room;
    });
    w.vit().coreC = 37;
    w.run(1);
    expect(w.vit().bandLowC).toBe(-2);
    expect(w.vit().coreRateCps).toBe(0);
    // Soaked: the band shrinks back towards 18 °C, 10 °C is cold again.
    w.vit().wetness = 100;
    w.run(1);
    expect(w.vit().bandLowC).toBeCloseTo(18 - 20 * (1 - 0.7 * w.vit().wetness / 100), 9);
    expect(w.vit().coreRateCps).toBeLessThan(0);
    insulation = 0;
    room = 8;
    w.run(1);
    expect(w.vit().roomC).toBe(8);
    expect(w.vit().feltC).toBe(18);
  });

  it(
    'the world environment reads the temperature field at the player tile',
    () => {
      const sim = createSimulation({ seed: 20260924, worldSize: 'small', dayLengthMinutes: 12 });
      sim.step([{ type: 'player.spawn' }]);
      sim.step();
      const p = { x: 0, y: 0 };
      (sim.system('player') as PlayerSystem).position(sim, p);
      const tx = Math.floor(p.x / TILE_PX);
      const ty = Math.floor(p.y / TILE_PX);
      const v = (sim.system('vitals') as VitalsSystem).vitalsOf(sim);
      expect(v?.ambientC).toBe(sim.world.temperature.temperatureAt(0, tx, ty));
      expect(worldSurvivalEnvironment().ambientC(sim, 0, tx, ty)).toBe(v?.ambientC);
      // Caves have no rain.
      expect(worldSurvivalEnvironment().rain(sim, -1, tx, ty)).toBe(0);
    },
    30_000,
  );
});
