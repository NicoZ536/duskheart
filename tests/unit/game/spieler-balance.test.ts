/**
 * Balance groups of M3-08, M3-09, M3-17, M3-18 (`BALANCE.player`, `BALANCE.survival`): the start values
 * of MASTERPROMPT §11.1, §11.2 and §11.4, every value documented with a unit and a reason (like
 * src/content/balance.ts itself, tests/unit/content/balance.test.ts).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';

/** Value lines of a balance module whose doc comment lacks a `[unit]` or a reason. */
function undocumented(file: string, marker: string): string[] {
  const source = readFileSync(fileURLToPath(new URL(`../../../src/content/balance/${file}`, import.meta.url)), 'utf8');
  const lines = source.slice(source.indexOf(marker)).split('\n');
  const missing: string[] = [];
  let values = 0;
  lines.forEach((l, i) => {
    if (!/^\s+[a-zA-Z]+: .*,\s*$/.test(l)) return;
    values++;
    let j = i - 1;
    const doc: string[] = [];
    while (j >= 0 && /^\s*(\/\*\*|\*)/.test(lines[j] ?? '')) doc.unshift(lines[j--] ?? '');
    const text = doc.join(' ');
    const reason = text.replace(/\[[^\]]+\]/, '').replace(/[/*\s]/g, '');
    if (!/\[[^\]]+\]/.test(text) || reason.length <= 10) missing.push(l.trim());
  });
  if (values === 0) missing.push(`${file}: no values found`);
  return missing;
}

describe('BALANCE.player und BALANCE.survival', () => {
  it('document every value with a unit and a reason', () => {
    expect(undocumented('player.ts', 'export const PLAYER_BALANCE')).toEqual([]);
    expect(undocumented('survival.ts', 'export const SURVIVAL_BALANCE')).toEqual([]);
  });

  it('hold the movement values of §11.4', () => {
    const m = BALANCE.player.movement;
    expect([m.walkTilesPerSecond, m.sprintTilesPerSecond, m.sneakTilesPerSecond, m.swimTilesPerSecond]).toEqual([4.5, 7, 2.5, 2.5]);
    expect(m.armorWeightFactor).toEqual({ leicht: 1, mittel: 0.95, schwer: 0.9 });
    expect(m.noise.sneak).toBeCloseTo(0.3 * m.noise.walk, 12);
    expect([BALANCE.player.roll.distanceTiles, BALANCE.player.roll.invulnerableSeconds]).toEqual([3, 0.25]);
    const c = BALANCE.player.cliffs;
    expect([c.safeDropLevels, c.fractureMinLevels]).toEqual([1, 3]);
    // The walking speed of the M2 debug movers is the player's.
    expect(BALANCE.motion.walkSpeedTilesPerSecond).toBe(m.walkTilesPerSecond);
  });

  it('hold the survival values of §11.1 and the temperature model of §11.2', () => {
    const s = BALANCE.survival;
    expect([s.health.base, s.health.regenPerSecond, s.health.regenAboveSatiety, s.health.regenAboveThirst, s.health.regenDamageFreeSeconds, s.health.restingRegenFactor]).toEqual([100, 0.5, 50, 30, 5, 2]);
    expect([s.stamina.base, s.stamina.regenPerSecond, s.stamina.regenDelaySeconds, s.stamina.hungryBelowSatiety, s.stamina.hungryRegenFactor]).toEqual([100, 25, 0.8, 20, 0.5]);
    expect([s.stamina.sprintPerSecond, s.stamina.rollCost, s.stamina.swimPerSecond]).toEqual([12, 20, 5]);
    expect([s.satiety.minutesToEmpty, s.satiety.sprintFactor, s.satiety.exertionFactor, s.satiety.coldFactor, s.satiety.sleepFactor, s.satiety.hungryBelow, s.satiety.starvingDamagePerSecond]).toEqual([36, 2, 1.25, 1.3, 0.5, 20, 0.5]);
    expect([s.thirst.minutesToEmpty, s.thirst.heatFactor, s.thirst.dehydratedDamagePerSecond]).toEqual([24, 1.5, 1]);
    expect([s.wetness.rainPercentPerSecond, s.wetness.dryAtFirePercentPerSecond, s.wetness.dryIndoorsPercentPerSecond, s.wetness.dryOutdoorsPercentPerSecond]).toEqual([2, 1, 0.2, 0.1]);
    expect([s.exhaustion.minutesToFull, s.exhaustion.tiredAbove, s.exhaustion.tiredStaminaRegenFactor, s.exhaustion.exhaustedAbove, s.exhaustion.exhaustedActionFactor]).toEqual([36, 70, 0.85, 90, 0.75]);
    expect(s.drowning.damagePerSecond).toBe(5);
    const t = s.temperature;
    expect([t.coreNormalC, t.comfortLowC, t.comfortHighC, t.maxInsulation, t.maxCooling, t.wetInsulationLoss, t.stressRatePerSecond, t.returnRatePerSecond]).toEqual([37, 18, 26, 40, 15, 0.7, 0.002, 0.01]);
    expect(t.stages).toEqual({ frierendBelow: 36, unterkuehltBelow: 35, erfrierendBelow: 33, erhitztAbove: 38, ueberhitztAbove: 39, hitzschlagAbove: 40.5 });
    expect(t.fire.coreHeatC).toBe(15);
    expect(Object.isFrozen(BALANCE.survival.temperature.stages)).toBe(true);
  });
});
