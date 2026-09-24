/**
 * M3-17: survival stats of §11.1 as pure functions and in the vitals system – health (regeneration
 * 0,5/s if satiety > 50, thirst > 30 and 5 s without damage; ×2 resting), stamina (+25/s after 0,8 s;
 * −50 % below satiety 20; costs), satiety (−100 in 36 min; ×2 sprint, ×1,25 fight/mining, ×1,3 cold,
 * ×0,5 sleep), thirst (−100 in 24 min, ×1,5 heat), wetness, exhaustion – with every edge case of
 * Hungrig, Verhungernd, Durstig, Verdurstend, Müde, Erschöpft, Durchnässt.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import {
  STAT_MAX,
  SWIMMING_WETNESS,
  actionSpeedFactor,
  clampStat,
  dehydrationDamagePerSecond,
  drowningDamagePerSecond,
  exhaustionGainPerSecond,
  exhaustionStage,
  fullScalePerSecond,
  healthRegenPerSecond,
  maxHealth,
  maxStamina,
  rollAllowed,
  satietyDrainPerSecond,
  satietyStage,
  sprintAllowed,
  staminaRegenPerSecond,
  starvationDamagePerSecond,
  thirstDrainPerSecond,
  thirstStage,
  wetnessChangePerSecond,
  wetnessStage,
} from '../../../src/game/survival/formulas';
import { createPlayerModifiers } from '../../../src/game/survival/modifiers';
import { createVitals } from '../../../src/game/survival/state';
import { spendStamina } from '../../../src/game/survival/system';
import { meadow, testEnvironment, testWorld } from './spieler-testwelt';

const S = BALANCE.survival;
const TICK = BALANCE.time.tickHz;
const REGEN = { satiety: 100, thirst: 100, damageFreeSeconds: 10, resting: false, factor: 1 };
const STAMINA = { satiety: 100, exhaustion: 0, temperature: 'normal' as const, restSeconds: 1, factor: 1 };
const HUNGER = { sprinting: false, exertion: false, coldStress: false, sleeping: false };

describe('Leben', () => {
  it('base 100 plus bonuses, times factors (heart splinters, Erschüttert)', () => {
    expect(maxHealth(0, 1)).toBe(100);
    expect(maxHealth(20, 1)).toBe(120);
    expect(maxHealth(0, 0.85)).toBeCloseTo(85, 12);
  });

  it('regenerates 0,5/s only with satiety > 50, thirst > 30 and 5 s without damage; ×2 resting', () => {
    expect(healthRegenPerSecond(REGEN)).toBe(0.5);
    expect(healthRegenPerSecond({ ...REGEN, resting: true })).toBe(1);
    expect(healthRegenPerSecond({ ...REGEN, satiety: 50 })).toBe(0);
    expect(healthRegenPerSecond({ ...REGEN, satiety: 50.01 })).toBe(0.5);
    expect(healthRegenPerSecond({ ...REGEN, thirst: 30 })).toBe(0);
    expect(healthRegenPerSecond({ ...REGEN, thirst: 30.01 })).toBe(0.5);
    expect(healthRegenPerSecond({ ...REGEN, damageFreeSeconds: 4.99 })).toBe(0);
    expect(healthRegenPerSecond({ ...REGEN, damageFreeSeconds: 5 })).toBe(0.5);
    expect(healthRegenPerSecond({ ...REGEN, factor: 1.5 })).toBe(0.75);
  });
});

describe('Ausdauer', () => {
  it('max 100 (+5 per Glutsplitter), regenerates +25/s after 0,8 s pause', () => {
    expect(maxStamina(0, 1, 'normal')).toBe(100);
    expect(maxStamina(10, 1, 'normal')).toBe(110);
    expect(maxStamina(0, 1.1, 'normal')).toBeCloseTo(110, 12);
    expect(staminaRegenPerSecond(STAMINA)).toBe(25);
    expect(staminaRegenPerSecond({ ...STAMINA, restSeconds: 0.79 })).toBe(0);
    expect(staminaRegenPerSecond({ ...STAMINA, restSeconds: 0.8 })).toBe(25);
  });

  it('−50 % below satiety 20, −15 % when tired (exhaustion > 70), factors multiply', () => {
    expect(staminaRegenPerSecond({ ...STAMINA, satiety: 20 })).toBe(25);
    expect(staminaRegenPerSecond({ ...STAMINA, satiety: 19.99 })).toBe(12.5);
    expect(staminaRegenPerSecond({ ...STAMINA, exhaustion: 70 })).toBe(25);
    expect(staminaRegenPerSecond({ ...STAMINA, exhaustion: 70.01 })).toBeCloseTo(21.25, 12);
    expect(staminaRegenPerSecond({ ...STAMINA, exhaustion: 95, satiety: 5 })).toBeCloseTo(25 * 0.85 * 0.5, 12);
    expect(staminaRegenPerSecond({ ...STAMINA, factor: 1.25 })).toBeCloseTo(31.25, 12);
  });

  it('costs: sprint 12/s (locked when run dry until 25 are back), roll 20 in reserve, swimming 5/s', () => {
    expect([S.stamina.sprintPerSecond, S.stamina.rollCost, S.stamina.swimPerSecond]).toEqual([12, 20, 5]);
    expect(sprintAllowed(0.1, false)).toBe(true);
    expect(sprintAllowed(0, false)).toBe(false);
    expect(sprintAllowed(24.9, true)).toBe(false);
    expect(sprintAllowed(25, true)).toBe(true);
    expect([rollAllowed(19.99), rollAllowed(20)]).toEqual([false, true]);
    const v = createVitals();
    v.staminaRestTicks = 99;
    spendStamina(v, 30);
    expect([v.stamina, v.staminaRestTicks]).toEqual([70, 0]);
    spendStamina(v, 500);
    expect(v.stamina).toBe(0);
  });
});

describe('Sättigung, Durst, Erschöpfung', () => {
  it('satiety empties in 36 min; ×2 sprint, ×1,25 fight/mining, ×1,3 cold stress, ×0,5 sleep, multiplied', () => {
    const base = satietyDrainPerSecond(HUNGER);
    expect(base * 36 * 60).toBeCloseTo(100, 10);
    expect(satietyDrainPerSecond({ ...HUNGER, sprinting: true }) / base).toBeCloseTo(2, 12);
    expect(satietyDrainPerSecond({ ...HUNGER, exertion: true }) / base).toBeCloseTo(1.25, 12);
    expect(satietyDrainPerSecond({ ...HUNGER, coldStress: true }) / base).toBeCloseTo(1.3, 12);
    expect(satietyDrainPerSecond({ ...HUNGER, sleeping: true }) / base).toBeCloseTo(0.5, 12);
    expect(satietyDrainPerSecond({ sprinting: true, exertion: true, coldStress: true, sleeping: false }) / base).toBeCloseTo(2 * 1.25 * 1.3, 12);
  });

  it('thirst empties in 24 min, ×1,5 in heat; exhaustion fills in 36 min awake, not while asleep', () => {
    expect(thirstDrainPerSecond(false, 'normal') * 24 * 60).toBeCloseTo(100, 10);
    expect(thirstDrainPerSecond(true, 'normal') * 24 * 60).toBeCloseTo(150, 10);
    expect(exhaustionGainPerSecond(false) * 36 * 60).toBeCloseTo(100, 10);
    expect(exhaustionGainPerSecond(true)).toBe(0);
    expect(fullScalePerSecond(1)).toBeCloseTo(100 / 60, 12);
  });

  it('stages: Hungrig < 20, Verhungernd at 0 (−1 HP / 2 s); Durstig < 20, Verdurstend at 0 (−1 HP/s)', () => {
    expect([satietyStage(100), satietyStage(20), satietyStage(19.999), satietyStage(0.001), satietyStage(0)]).toEqual(['satt', 'satt', 'hungrig', 'hungrig', 'verhungernd']);
    expect([thirstStage(100), thirstStage(20), thirstStage(19.999), thirstStage(0.001), thirstStage(0)]).toEqual(['getraenkt', 'getraenkt', 'durstig', 'durstig', 'verdurstend']);
    expect([starvationDamagePerSecond(0.001), starvationDamagePerSecond(0)]).toEqual([0, 0.5]);
    expect([dehydrationDamagePerSecond(0.001), dehydrationDamagePerSecond(0)]).toEqual([0, 1]);
  });

  it('stages: Müde > 70 (−15 % stamina regeneration), Erschöpft > 90 (−25 % action speed)', () => {
    expect([exhaustionStage(70), exhaustionStage(70.01), exhaustionStage(90), exhaustionStage(90.01)]).toEqual(['wach', 'muede', 'muede', 'erschoepft']);
    expect(actionSpeedFactor(90, 'normal')).toBe(1);
    expect(actionSpeedFactor(90.01, 'normal')).toBe(0.75);
    expect(actionSpeedFactor(95, 'frierend')).toBeCloseTo(0.675, 12);
  });
});

describe('Nässe und Ertrinken', () => {
  it('rain wets 2 %/s (the reference rain), drizzle less; dries 1 %/s at a fire, 0,2 indoors, 0,1 outdoors', () => {
    expect(wetnessChangePerSecond({ rain: 1, nearFire: false, indoors: false })).toBe(2);
    expect(wetnessChangePerSecond({ rain: 0.5, nearFire: true, indoors: false })).toBe(1);
    expect(wetnessChangePerSecond({ rain: 0, nearFire: true, indoors: true })).toBe(-1);
    expect(wetnessChangePerSecond({ rain: 0, nearFire: false, indoors: true })).toBe(-0.2);
    expect(wetnessChangePerSecond({ rain: 0, nearFire: false, indoors: false })).toBe(-0.1);
    expect(SWIMMING_WETNESS).toBe(100);
    expect([wetnessStage(49.9), wetnessStage(50)]).toEqual(['trocken', 'durchnaesst']);
  });

  it('drowning: −5 HP/s while swimming without stamina', () => {
    expect([drowningDamagePerSecond(true, 0), drowningDamagePerSecond(true, 0.1), drowningDamagePerSecond(false, 0)]).toEqual([5, 0, 0]);
    expect([clampStat(-1, STAT_MAX), clampStat(101, STAT_MAX), clampStat(50, STAT_MAX)]).toEqual([0, 100, 50]);
  });

  it('neutral modifiers are the naked, healthy player outdoors', () => {
    expect(createPlayerModifiers()).toEqual({
      armorWeight: 'leicht',
      insulation: 0,
      cooling: 0,
      maxHealthBonus: 0,
      maxHealthFactor: 1,
      maxStaminaBonus: 0,
      maxStaminaFactor: 1,
      healthRegenFactor: 1,
      staminaRegenFactor: 1,
      moveSpeedFactor: 1,
      resting: false,
      sleeping: false,
      exertion: false,
      indoors: false,
      roomTemperatureC: 0,
    });
  });
});

describe('Vitalsystem', () => {
  it('a new player starts with full bars at 37 °C; the stats run down at their rates', () => {
    const w = testWorld(meadow(10, 10));
    w.spawn(5, 5);
    const v = w.vit();
    expect([v.health, v.stamina, v.satiety, v.thirst, v.wetness, v.exhaustion]).toEqual([100, 100, expect.any(Number), expect.any(Number), 0, expect.any(Number)]);
    const s0 = v.satiety;
    const t0 = v.thirst;
    const e0 = v.exhaustion;
    w.run(10 * TICK);
    expect(s0 - v.satiety).toBeCloseTo(10 * satietyDrainPerSecond(HUNGER), 9);
    expect(t0 - v.thirst).toBeCloseTo(10 * thirstDrainPerSecond(false, 'normal'), 9);
    expect(v.exhaustion - e0).toBeCloseTo(10 * exhaustionGainPerSecond(false), 9);
  });

  it('starving and dehydrating damage once per second per cause; health regenerates only after 5 s without damage', () => {
    const w = testWorld(meadow(10, 10));
    w.spawn(5, 5);
    const v = w.vit();
    v.satiety = 0;
    v.thirst = 0;
    const events = w.run(4 * TICK);
    const hits = (events.get('playerDamaged') ?? []) as Array<{ cause: string; amount: number }>;
    expect(hits.filter((h) => h.cause === 'hunger')).toHaveLength(4);
    expect(hits.filter((h) => h.cause === 'durst')).toHaveLength(4);
    expect(100 - v.health).toBeCloseTo(4 * (0.5 + 1), 6);
    expect(events.get('survivalStageChanged')).toEqual(
      expect.arrayContaining([expect.objectContaining({ stat: 'satiety', stage: 'verhungernd', previous: 'satt' }), expect.objectContaining({ stat: 'thirst', stage: 'verdurstend', previous: 'getraenkt' })]),
    );
    // Fed and watered: no regeneration for 5 s, then 0,5/s.
    v.satiety = 80;
    v.thirst = 80;
    const h = v.health;
    w.run(5 * TICK - 2);
    expect(v.health).toBe(h);
    w.run(TICK + 2);
    expect(v.health - h).toBeCloseTo(0.5, 1);
  });

  it('resting (a modifier source: sitting at a fire, lying in bed) doubles the regeneration', () => {
    const w = testWorld(meadow(10, 10));
    w.spawn(5, 5);
    w.influences.addModifierSource((_s, _p, m) => (m.resting = true));
    w.vit().health = 50;
    w.run(6 * TICK);
    const h = w.vit().health;
    w.run(TICK);
    expect(w.vit().health - h).toBeCloseTo(1, 9);
  });

  it('rain wets the player at 2 %/s, the open sky dries it at 0,1 %/s, a roof keeps the rain off', () => {
    const env = testEnvironment(20, 1);
    const w = testWorld(meadow(10, 10), env);
    w.spawn(5, 5);
    const w0 = w.vit().wetness;
    w.run(10 * TICK);
    expect(w.vit().wetness - w0).toBeCloseTo(20, 6);
    expect(w.vit().wetnessStage).toBe('trocken');
    w.run(15 * TICK);
    expect(w.vit().wetnessStage).toBe('durchnaesst');
    env.wet = 0;
    const w1 = w.vit().wetness;
    w.run(10 * TICK);
    expect(w1 - w.vit().wetness).toBeCloseTo(1, 6);
    env.wet = 1;
    w.influences.addModifierSource((_s, _p, m) => (m.indoors = true));
    const w2 = w.vit().wetness;
    w.run(10 * TICK);
    expect(w2 - w.vit().wetness).toBeCloseTo(2, 6);
  });

  it('exertion and sleep change the hunger, a lethal hit is reported at once', () => {
    const w = testWorld(meadow(10, 10));
    w.spawn(5, 5);
    let exertion = true;
    w.influences.addModifierSource((_s, _p, m) => {
      m.exertion = exertion;
      m.sleeping = !exertion;
    });
    const s0 = w.vit().satiety;
    w.run(TICK);
    expect(s0 - w.vit().satiety).toBeCloseTo(1.25 * satietyDrainPerSecond(HUNGER), 9);
    exertion = false;
    const s1 = w.vit().satiety;
    const e1 = w.vit().exhaustion;
    w.run(TICK);
    expect(s1 - w.vit().satiety).toBeCloseTo(0.5 * satietyDrainPerSecond(HUNGER), 9);
    expect(w.vit().exhaustion).toBe(e1);
    const v = w.vit();
    v.health = 0.2;
    v.satiety = 0;
    const events = w.run(30);
    expect(v.health).toBe(0);
    expect(events.get('playerDamaged')).toEqual([expect.objectContaining({ cause: 'hunger', health: 0, lethal: true })]);
    // At 0 health the death system takes over (M3-26): no further damage, no regeneration.
    v.satiety = 100;
    v.thirst = 100;
    const after = w.run(10 * TICK);
    expect(after.get('playerDamaged')).toBeUndefined();
    expect(v.health).toBe(0);
  });
});
