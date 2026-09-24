/**
 * M3-24: sleep (MASTERPROMPT §11.5) – possible from 19:00 or with exhaustion above 60, never with an enemy
 * within 20 tiles; time ×30 until 06:00 (or, after a nap, until exhaustion 0); a bed sets the respawn
 * point and gives "Ausgeruht" (+10 % max. stamina, +25 % stamina regeneration, +5 % XP; 8 min + 1 min per
 * comfort point, ×1,5 in a bedroom); grass bed and sleeping bag recover half and give no "Ausgeruht";
 * attacks wake.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { exhaustionRecoveryPerSecond, isNap, isSleepingHour, restedSeconds, sleepAllowed, sleepPlaceRules, sleepTimeScale } from '../../../src/game/sleep/formulas';
import { baseItem, defineItemGroup, ITEM_SFX } from '../../../src/content/items/define';
import { ITEMS } from '../../../src/content/items/index';
import { ItemCatalog } from '../../../src/game/items/catalog';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { meadow } from './spieler-testwelt';

const TICK = BALANCE.time.tickHz;
const S = BALANCE.sleep;

/** A sleeping bag (its item comes with a later milestone; the sleep rules already know the kind). */
const SCHLAFSACK = defineItemGroup('schlaf_proben', [
  baseItem({
    id: 'schlafsack',
    name: { de: 'Schlafsack', en: 'Sleeping Bag' },
    beschreibung: { de: 'Testgegenstand.', en: 'Test item.' },
    kategorie: 'platzierbar',
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
]);

function world(rows: readonly string[] = meadow(30, 30)): LifeWorld {
  const w = lifeWorld(rows);
  w.spawn(10, 10);
  return w;
}

function rejected(ev: Map<string, unknown[]>): string[] {
  return ((ev.get('commandRejected') ?? []) as Array<{ reason: string }>).map((r) => r.reason);
}

/** Runs until the player wakes (or `limit` ticks); returns the events of the whole sleep. */
function sleepThrough(w: LifeWorld, limit: number): Map<string, unknown[]> {
  const all = new Map<string, unknown[]>();
  for (let i = 0; i < limit && w.life.sleep.asleep; i++) {
    for (const [k, v] of w.run(1)) all.set(k, [...(all.get(k) ?? []), ...v]);
  }
  return all;
}

describe('Schlaf (reine Funktionen)', () => {
  it('from 19:00 until 06:00, or with exhaustion above 60 at any hour; a sleep begun by day is a nap', () => {
    expect([18, 19, 23, 0, 5, 6].map(isSleepingHour)).toEqual([false, true, true, true, true, false]);
    expect(sleepAllowed(12, 60)).toBe(false);
    expect(sleepAllowed(12, 60.1)).toBe(true);
    expect(sleepAllowed(20, 0)).toBe(true);
    expect([isNap(14), isNap(21), isNap(3)]).toEqual([true, false, false]);
  });

  it('time runs ×30 asleep; a bed recovers 100 exhaustion in 8 game hours, grass bed and sleeping bag half', () => {
    expect([sleepTimeScale(true), sleepTimeScale(false)]).toEqual([30, 1]);
    const hourSeconds = 60;
    expect(exhaustionRecoveryPerSecond(sleepPlaceRules('bett').recovery, hourSeconds) * 8 * hourSeconds).toBeCloseTo(100, 9);
    expect(exhaustionRecoveryPerSecond(sleepPlaceRules('grasbett').recovery, hourSeconds) * 8 * hourSeconds).toBeCloseTo(50, 9);
    expect(exhaustionRecoveryPerSecond(sleepPlaceRules('schlafsack').recovery, hourSeconds) * 8 * hourSeconds).toBeCloseTo(50, 9);
  });

  it('Ausgeruht lasts 8 min + 1 min per comfort point, ×1,5 in a bedroom; only the bed gives it, the sleeping bag sets no respawn', () => {
    expect(restedSeconds(0, false)).toBe(480);
    expect(restedSeconds(12, false)).toBe(480 + 12 * 60);
    expect(restedSeconds(12, true)).toBe((480 + 12 * 60) * 1.5);
    expect([sleepPlaceRules('bett').rested, sleepPlaceRules('grasbett').rested, sleepPlaceRules('schlafsack').rested]).toEqual([true, false, false]);
    expect([sleepPlaceRules('bett').respawn, sleepPlaceRules('grasbett').respawn, sleepPlaceRules('schlafsack').respawn]).toEqual([true, true, false]);
  });
});

describe('Schlafsystem', () => {
  it('before 19:00 without exhaustion sleep is refused; from 19:00 or exhausted it begins', () => {
    const w = world();
    w.bed(11, 10, 'bett');
    const bed = w.tile(11, 10);
    expect(rejected(w.run(1, [{ type: 'sleep.start', ...bed }]))).toEqual(['tooEarly']);
    w.vit().exhaustion = 61;
    const nap = w.run(1, [{ type: 'sleep.start', ...bed }]);
    expect(nap.get('sleepStarted')).toEqual([expect.objectContaining({ place: 'bett', nap: true })]);
    const w2 = world();
    w2.bed(11, 10, 'bett');
    w2.jumpToHour(19);
    expect(w2.run(1, [{ type: 'sleep.start', ...bed }]).get('sleepStarted')).toEqual([expect.objectContaining({ nap: false })]);
    expect(w2.life.sleep.timeScale).toBe(S.timeScale);
  });

  it('refused: no bed, a bed out of reach, no sleeping bag, an enemy within 20 tiles, already asleep', () => {
    const w = world();
    w.jumpToHour(22);
    w.bed(20, 10, 'bett');
    expect(rejected(w.run(1, [{ type: 'sleep.start', ...w.tile(12, 12) }]))).toEqual(['noSleepPlace']);
    expect(rejected(w.run(1, [{ type: 'sleep.start', ...w.tile(20, 10) }]))).toEqual(['outOfReach']);
    expect(rejected(w.run(1, [{ type: 'sleep.start' }]))).toEqual(['noSleepPlace']);
    let enemyAt = 21;
    w.life.sleep.addThreats((_sim, _layer, x, _y, radius) => Math.abs(w.centre(enemyAt, 10).x - x) <= radius);
    w.bed(11, 10, 'bett');
    enemyAt = 11 + 20;
    expect(rejected(w.run(1, [{ type: 'sleep.start', ...w.tile(11, 10) }]))).toEqual(['enemiesNear']);
    enemyAt = 11 + 21;
    expect(w.run(1, [{ type: 'sleep.start', ...w.tile(11, 10) }]).get('sleepStarted')).toBeDefined();
    expect(rejected(w.run(1, [{ type: 'sleep.start', ...w.tile(11, 10) }]))).toEqual(['asleep']);
  });

  it('a night in a bed: exhaustion falls, satiety ×0,5, the respawn point is set, wake at 06:00 with Ausgeruht', () => {
    const w = world();
    w.bed(11, 10, 'bett', 4, true);
    w.jumpToHour(22);
    w.vit().exhaustion = 100;
    const start = w.run(1, [{ type: 'sleep.start', ...w.tile(11, 10) }]);
    expect(start.get('respawnPointSet')).toEqual([expect.objectContaining({ kind: 'bett' })]);
    expect(w.life.death.state.respawn).toMatchObject({ kind: 'bett', layer: 0 });
    const hour = w.sim.clock.ticksPerGameHour;
    const s0 = w.vit().satiety;
    const e0 = w.vit().exhaustion;
    w.run(hour);
    expect(e0 - w.vit().exhaustion).toBeCloseTo(100 / 8, 6);
    // Asleep the satiety drains at half its awake rate (§11.1).
    expect(s0 - w.vit().satiety).toBeCloseTo((100 / (36 * 60)) * 0.5 * (hour / TICK), 3);
    const night = sleepThrough(w, 9 * hour);
    expect(night.get('sleepEnded')).toEqual([expect.objectContaining({ reason: 'morgen', rested: true })]);
    expect(w.sim.clock.hour).toBe(6);
    expect(w.vit().exhaustion).toBe(0);
    const rested = w.life.conditions.remainingSeconds('ausgeruht', TICK);
    expect(rested).toBeCloseTo(restedSeconds(4, true), 6);
  });

  it('Ausgeruht: +10 % max. stamina, +25 % stamina regeneration, +5 % XP', () => {
    const w = world();
    // Not well fed, so only Ausgeruht acts on the stamina regeneration.
    w.vit().satiety = 60;
    w.run(1, [{ type: 'conditions.apply', id: 'ausgeruht' }]);
    w.run(1);
    expect(w.vit().maxStamina).toBeCloseTo(110, 9);
    expect(w.life.conditions.effects().staminaRegen).toBeCloseTo(1.25, 9);
    expect(w.life.conditions.effects().xp).toBeCloseTo(1.05, 9);
    const xp = w.life.skills.award(w.sim, 'baum_gefaellt');
    expect(xp).toBeCloseTo(8 * 1.05, 9);
  });

  it('a nap ends when exhaustion reaches 0; a grass bed recovers half, sets the respawn point, gives no Ausgeruht', () => {
    const w = world();
    w.bed(11, 10, 'grasbett');
    w.vit().exhaustion = 70;
    w.run(1, [{ type: 'sleep.start', ...w.tile(11, 10) }]);
    const hour = w.sim.clock.ticksPerGameHour;
    const e0 = w.vit().exhaustion;
    w.run(hour);
    expect(e0 - w.vit().exhaustion).toBeCloseTo(100 / 16, 3);
    const nap = sleepThrough(w, 16 * hour);
    expect(nap.get('sleepEnded')).toEqual([expect.objectContaining({ reason: 'erholt', rested: false })]);
    expect(w.vit().exhaustion).toBe(0);
    expect(w.life.conditions.has('ausgeruht')).toBe(false);
    expect(w.life.death.state.respawn?.kind).toBe('grasbett');
  });

  it('a sleeping bag from the bags: anywhere, half recovery, no respawn point, no Ausgeruht', () => {
    const w = lifeWorld(meadow(30, 30), 1, new ItemCatalog([...ITEMS, ...SCHLAFSACK]));
    w.spawn(10, 10);
    w.jumpToHour(20);
    expect(rejected(w.run(1, [{ type: 'sleep.start' }]))).toEqual(['noSleepPlace']);
    w.run(1, [{ type: 'inventory.give', item: 'schlafsack', count: 1 }]);
    const start = w.run(1, [{ type: 'sleep.start' }]);
    expect(start.get('sleepStarted')).toEqual([expect.objectContaining({ place: 'schlafsack', x: w.pos().x, y: w.pos().y })]);
    expect(start.get('respawnPointSet')).toBeUndefined();
    w.vit().exhaustion = 80;
    const hour = w.sim.clock.ticksPerGameHour;
    w.run(hour);
    expect(80 - w.vit().exhaustion).toBeCloseTo(100 / 16, 3);
    const night = sleepThrough(w, 11 * hour);
    expect(night.get('sleepEnded')).toEqual([expect.objectContaining({ reason: 'morgen', rested: false })]);
    expect(w.life.death.state.respawn).toBeNull();
  });

  it('attacks wake: a hit ends the sleep at once, without Ausgeruht', () => {
    const w = world();
    w.bed(11, 10, 'bett');
    w.jumpToHour(21);
    w.run(1, [{ type: 'sleep.start', ...w.tile(11, 10) }]);
    w.run(TICK);
    expect(w.life.sleep.asleep).toBe(true);
    // Damage over time (hunger) does not wake …
    w.vit().satiety = 0;
    expect(w.run(3 * TICK).get('sleepEnded')).toBeUndefined();
    // … a hit does: instant damage dealt before the sleep system runs in the tick (as falls and attacks are).
    w.vitals.damage(w.sim, 12, 'sturz');
    const woke = w.run(1);
    expect(woke.get('sleepEnded')).toEqual([expect.objectContaining({ reason: 'angriff', rested: false })]);
    expect(w.life.conditions.has('ausgeruht')).toBe(false);
  });

  it('a movement key wakes the sleeper, who does not move in that tick; sleep.wake gets up', () => {
    const w = world();
    w.bed(11, 10, 'bett');
    w.jumpToHour(21);
    w.run(1, [{ type: 'sleep.start', ...w.tile(11, 10) }]);
    const x0 = w.pos().x;
    const moved = w.run(1, [{ type: 'player.move', dx: 1, dy: 0 }]);
    expect(moved.get('sleepEnded')).toEqual([expect.objectContaining({ reason: 'geweckt', rested: false })]);
    expect(w.pos().x).toBe(x0);
    w.run(1, [{ type: 'player.move', dx: 0, dy: 0 }]);
    w.run(1, [{ type: 'sleep.start', ...w.tile(11, 10) }]);
    expect(w.run(1, [{ type: 'sleep.wake' }]).get('sleepEnded')).toEqual([expect.objectContaining({ reason: 'geweckt' })]);
    expect(rejected(w.run(1, [{ type: 'sleep.wake' }]))).toEqual(['notAsleep']);
  });

  it('asleep the player lies still and rests: health regenerates twice as fast in a bed', () => {
    const w = world();
    const awake = world();
    w.bed(11, 10, 'bett');
    w.jumpToHour(21);
    awake.jumpToHour(21);
    w.run(1, [{ type: 'sleep.start', ...w.tile(11, 10) }]);
    w.vit().health = 50;
    awake.vit().health = 50;
    w.vit().damageFreeTicks = 10 * TICK;
    awake.vit().damageFreeTicks = 10 * TICK;
    w.run(TICK);
    awake.run(TICK);
    const regen = BALANCE.survival.health.regenPerSecond;
    expect(awake.vit().health - 50).toBeCloseTo(regen * 1.5, 6);
    expect(w.vit().health - 50).toBeCloseTo(regen * 2 * 1.5, 6);
    expect(w.body().state).toBe('idle');
  });
});
