/**
 * M3-19: the condition system (MASTERPROMPT §11.3) – every condition of docs/SPIEL.md §6 as content with
 * icon `zustand_<id>` (frame kind = `art`), duration, stack rule, tooltip (DE/EN), visible effect and sound;
 * the stack rules, durations, derived conditions following the survival stages, the effects reaching the
 * player (speed, maxima, regeneration, damage, drains, pulses), water putting out fire, fever healing at
 * rest, a broken bone from a fall, and the §C count (≥ 30 status effects).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import zustandIcons, { ZUSTAND_ARTEN } from '../../../assets-src/sprites/zustaende/zustaende';
import { BALANCE } from '../../../src/content/balance';
import { CONDITIONS, CONDITION_VISUALS, VITALS_CONDITION_VALUES, conditionIconId, conditionSchema, type ConditionDef } from '../../../src/content/conditions';
import { CONTENT } from '../../../src/content/index';
import { SFX_ID_PATTERN } from '../../../src/content/schema/item';
import { ConditionCatalog } from '../../../src/game/conditions/catalog';
import { aggregateEffects, applyStack, countdownStep, isWellFed, quenched } from '../../../src/game/conditions/formulas';
import { UNTIMED, type ActiveCondition } from '../../../src/game/conditions/state';
import { exhaustionStage, staminaRegenPerSecond, healthRegenPerSecond, starvationDamagePerSecond, dehydrationDamagePerSecond, drowningDamagePerSecond, actionSpeedFactor } from '../../../src/game/survival/formulas';
import { temperatureDamagePerSecond, temperatureHeatsThirst, temperatureMaxStaminaFactor, temperatureStaminaRegenFactor, temperatureWorkFactor } from '../../../src/game/survival/temperature';
import { comfortBand } from '../../../src/game/survival/temperature';
import { checkConditionIcons, conditionIconIds } from '../../../tools/validator/zustaende';
import { conventionSpriteIds } from '../../../tools/validator/checks';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { meadow } from './spieler-testwelt';

const TICK = BALANCE.time.tickHz;
const DEFS = CONTENT.collection('conditions').values();
const catalog = new ConditionCatalog(DEFS);
const def = (id: string): ConditionDef => catalog.get(id);

function spielZustaende(): string[] {
  const text = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const line = text.split('\n').find((l) => l.startsWith('- **Zustände (M3-19)'));
  if (line === undefined) throw new Error('docs/SPIEL.md: Zustände fehlen');
  return [...line.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] ?? '').filter((id) => !id.startsWith('zustand_'));
}

function events(w: LifeWorld, ticks: number, commands?: Parameters<LifeWorld['run']>[1]): Map<string, unknown[]> {
  return w.run(ticks, commands);
}

function world(): LifeWorld {
  const w = lifeWorld(meadow(12, 12));
  w.spawn(5, 5);
  return w;
}

function active(w: LifeWorld, id: string): ActiveCondition | undefined {
  return w.life.conditions.active().find((c) => c.id === id);
}

describe('Zustände als Content', () => {
  it('all 31 conditions of docs/SPIEL.md §6 exist, in its order, and count as ≥ 30 status effects (§C)', () => {
    expect(DEFS.map((c) => c.id)).toEqual(spielZustaende());
    expect(DEFS.length).toBe(31);
    expect(CONTENT.countsByCategory().statusEffects).toBe(31);
    const targets = JSON.parse(readFileSync(join(process.cwd(), 'tools/validator/zielwerte.json'), 'utf8')) as { ziele: { statusEffects: number } };
    expect(targets.ziele.statusEffects).toBeGreaterThanOrEqual(30);
  });

  it('every condition has its icon zustand_<id> with the matching frame kind, a tooltip in DE and EN, a visible effect and a sound', () => {
    const icons = new Set(zustandIcons.map((s) => s.id));
    for (const c of DEFS) {
      expect(icons.has(conditionIconId(c.id)), c.id).toBe(true);
      expect(ZUSTAND_ARTEN[c.id], c.id).toBe(c.art);
      for (const text of [c.name, c.beschreibung]) {
        expect(text.de.trim().length).toBeGreaterThan(0);
        expect(text.en.trim().length).toBeGreaterThan(0);
      }
      expect(CONDITION_VISUALS).toContain(c.sichtbar);
      expect(c.sound).toMatch(SFX_ID_PATTERN);
    }
  });

  it('the validator: a condition without its icon is an error; the icons count as used by convention', () => {
    const all = new Set(zustandIcons.map((s) => s.id));
    expect(checkConditionIcons(CONTENT, all)).toEqual([]);
    const without = new Set([...all].filter((id) => id !== 'zustand_fieber'));
    expect(checkConditionIcons(CONTENT, without)).toEqual(['Zustand fieber: Icon zustand_fieber fehlt (assets-src/sprites/zustaende)']);
    expect(conventionSpriteIds()).toEqual(expect.arrayContaining(conditionIconIds()));
  });

  it('conditions of survival values carry their stage id; conditions that are applied have a real effect', () => {
    for (const c of DEFS) {
      if (c.dauer.art === 'wert') {
        expect(c.dauer.stufe).toBe(c.id);
        expect(c.stapel.regel).toBe('einmalig');
      } else expect(Object.keys(c.wirkung).length, c.id).toBeGreaterThan(0);
    }
  });

  it('the vitals system applies the real effect of every stage condition (§11.1, §11.2)', () => {
    const stageEffects: Record<string, boolean> = {
      frierend: temperatureWorkFactor('frierend') < 1,
      unterkuehlt: temperatureMaxStaminaFactor('unterkuehlt') < 1 && temperatureDamagePerSecond('unterkuehlt') > 0,
      erfrierend: temperatureDamagePerSecond('erfrierend') > temperatureDamagePerSecond('unterkuehlt'),
      erhitzt: temperatureHeatsThirst('erhitzt'),
      ueberhitzt: temperatureStaminaRegenFactor('ueberhitzt') < 1 && temperatureDamagePerSecond('ueberhitzt') > 0,
      hitzschlag: temperatureDamagePerSecond('hitzschlag') > temperatureDamagePerSecond('ueberhitzt'),
      muede: exhaustionStage(75) === 'muede' && staminaRegenPerSecond({ satiety: 100, exhaustion: 75, temperature: 'normal', restSeconds: 9, factor: 1 }) < BALANCE.survival.stamina.regenPerSecond,
      erschoepft: actionSpeedFactor(95, 'normal') < 1,
      durchnaesst: comfortBand(20, 0, 100).low > comfortBand(20, 0, 0).low,
      hungrig: staminaRegenPerSecond({ satiety: 10, exhaustion: 0, temperature: 'normal', restSeconds: 9, factor: 1 }) < BALANCE.survival.stamina.regenPerSecond,
      verhungernd: starvationDamagePerSecond(0) > 0,
      durstig: healthRegenPerSecond({ satiety: 100, thirst: 10, damageFreeSeconds: 9, resting: false, factor: 1 }) === 0,
      verdurstend: dehydrationDamagePerSecond(0) > 0,
      ertrinkend: drowningDamagePerSecond(true, 0) > 0,
    };
    const staged = DEFS.filter((c) => c.dauer.art === 'wert' && (VITALS_CONDITION_VALUES as readonly string[]).includes(c.dauer.quelle)).map((c) => c.id);
    expect(Object.keys(stageEffects).sort()).toEqual([...staged].sort());
    for (const [id, real] of Object.entries(stageEffects)) expect(real, id).toBe(true);
  });

  it('the schema refuses effects on vitals stages, missing effects and stack rules without a timer', () => {
    const blut = CONDITIONS[0];
    expect(conditionSchema.safeParse({ ...blut, wirkung: {} }).success).toBe(false);
    const frierend = CONDITIONS.find((c) => c.id === 'frierend');
    expect(conditionSchema.safeParse({ ...frierend, wirkung: { tempo: 0.5 } }).success).toBe(false);
    expect(conditionSchema.safeParse({ ...blut, dauer: { art: 'heilung' } }).success).toBe(false);
    expect(conditionSchema.safeParse({ ...blut, sichtbar: 'glitzern' }).success).toBe(false);
  });
});

describe('Stapelregeln und Wirkungen (reine Funktionen)', () => {
  it('erneuern restarts, verlaengern adds up to its maximum, stapeln adds stacks up to max, einmalig ignores', () => {
    expect(applyStack(def('verlangsamt'), null, 300)).toEqual({ stacks: 1, remainingTicks: 300, outcome: 'neu' });
    expect(applyStack(def('verlangsamt'), { stacks: 1, remainingTicks: 60 }, 300)).toEqual({ stacks: 1, remainingTicks: 300, outcome: 'erneuert' });
    expect(applyStack(def('verlangsamt'), { stacks: 1, remainingTicks: 400 }, 300).remainingTicks).toBe(400);
    expect(applyStack(def('vergiftung'), { stacks: 1, remainingTicks: 3000 }, 1200)).toEqual({ stacks: 1, remainingTicks: 60 * TICK, outcome: 'verlaengert' });
    expect(applyStack(def('vergiftung'), { stacks: 1, remainingTicks: 600 }, 1200).remainingTicks).toBe(1800);
    expect(applyStack(def('blutung'), { stacks: 2, remainingTicks: 100 }, 1800)).toEqual({ stacks: 3, remainingTicks: 1800, outcome: 'gestapelt' });
    expect(applyStack(def('blutung'), { stacks: 3, remainingTicks: 100 }, 1800).stacks).toBe(3);
    expect(applyStack(def('betaeubt'), { stacks: 1, remainingTicks: 10 }, 90)).toEqual({ stacks: 1, remainingTicks: 10, outcome: 'unveraendert' });
  });

  it('effects combine: factors multiply, damage counts per stack, resistance takes the strongest', () => {
    const list: ActiveCondition[] = [
      { id: 'blutung', stacks: 3, remainingTicks: 10, pulseTicks: 0, pendingDamage: 0 },
      { id: 'verlangsamt', stacks: 1, remainingTicks: 10, pulseTicks: 0, pendingDamage: 0 },
      { id: 'knochenbruch', stacks: 1, remainingTicks: UNTIMED, pulseTicks: 0, pendingDamage: 0 },
      { id: 'ausgeruht', stacks: 1, remainingTicks: 10, pulseTicks: 0, pendingDamage: 0 },
      { id: 'beschwipst', stacks: 1, remainingTicks: 10, pulseTicks: 0, pendingDamage: 0 },
      { id: 'erleuchtet', stacks: 1, remainingTicks: 10, pulseTicks: 0, pendingDamage: 0 },
    ];
    const e = aggregateEffects(list, def);
    expect(e.damagePerSecond).toBeCloseTo(1.5, 12);
    expect(e.moveSpeed).toBeCloseTo(0.7 * 0.6, 12);
    expect(e.maxStamina).toBeCloseTo(1.1, 12);
    expect(e.staminaRegen).toBeCloseTo(1.25, 12);
    expect(e.xp).toBeCloseTo(1.05, 12);
    expect(e.damageResistance).toBeCloseTo(0.1, 12);
    expect(e.precision).toBeCloseTo(0.85, 12);
    expect(e.fearPerSecond).toBe(-1);
    expect(aggregateEffects([], def)).toMatchObject({ moveSpeed: 1, damagePerSecond: 0, xp: 1 });
  });

  it('water puts out burning, fever runs out three times as fast at rest, well fed from satiety and thirst 80', () => {
    expect(quenched(def('brennen').wirkung, true, false)).toBe(true);
    expect(quenched(def('brennen').wirkung, false, true)).toBe(true);
    expect(quenched(def('brennen').wirkung, false, false)).toBe(false);
    expect(quenched(def('blutung').wirkung, true, true)).toBe(false);
    expect(countdownStep(def('fieber').wirkung, true)).toBe(3);
    expect(countdownStep(def('fieber').wirkung, false)).toBe(1);
    expect(countdownStep(def('blutung').wirkung, true)).toBe(1);
    expect(isWellFed(80, 80)).toBe(true);
    expect(isWellFed(79.9, 100)).toBe(false);
  });
});

describe('Zustandssystem', () => {
  it('a timed condition lasts exactly its duration and raises applied/removed events', () => {
    const w = world();
    const first = events(w, 1, [{ type: 'conditions.apply', id: 'verlangsamt' }]);
    expect(first.get('conditionApplied')).toEqual([expect.objectContaining({ id: 'verlangsamt', outcome: 'neu', stacks: 1, remainingTicks: 5 * TICK })]);
    expect(events(w, 5 * TICK - 2).get('conditionRemoved')).toBeUndefined();
    expect(events(w, 1).get('conditionRemoved')).toEqual([expect.objectContaining({ id: 'verlangsamt', reason: 'abgelaufen' })]);
    expect(w.life.conditions.has('verlangsamt')).toBe(false);
  });

  it('bleeding costs 0,5 HP/s per wound, reported once per second; three wounds at most', () => {
    const w = world();
    events(w, 1, [{ type: 'conditions.apply', id: 'blutung' }]);
    events(w, 1, [{ type: 'conditions.apply', id: 'blutung' }]);
    events(w, 1, [{ type: 'conditions.apply', id: 'blutung' }]);
    events(w, 1, [{ type: 'conditions.apply', id: 'blutung' }]);
    expect(active(w, 'blutung')?.stacks).toBe(3);
    const h0 = w.vit().health;
    const second = events(w, TICK);
    expect(h0 - w.vit().health).toBeCloseTo(1.5, 6);
    const reports = (second.get('playerAfflicted') ?? []) as Array<{ source: string; id: string; amount: number }>;
    expect(reports.length).toBe(1);
    expect(reports[0]).toMatchObject({ source: 'zustand', id: 'blutung' });
    // Health does not regenerate while bleeding.
    expect(w.vit().damageFreeTicks).toBe(0);
  });

  it('a cure ends a condition at once; stage conditions and inactive ones cannot be cured', () => {
    const w = world();
    events(w, 1, [{ type: 'conditions.apply', id: 'knochenbruch' }]);
    expect(active(w, 'knochenbruch')?.remainingTicks).toBe(UNTIMED);
    events(w, 10 * TICK);
    expect(w.life.conditions.has('knochenbruch')).toBe(true);
    const cured = events(w, 1, [{ type: 'conditions.cure', id: 'knochenbruch' }]);
    expect(cured.get('conditionRemoved')).toEqual([expect.objectContaining({ id: 'knochenbruch', reason: 'geheilt' })]);
    const refused = events(w, 1, [
      { type: 'conditions.cure', id: 'knochenbruch' },
      { type: 'conditions.apply', id: 'hungrig' },
      { type: 'conditions.apply', id: 'nicht_da' },
    ]);
    expect((refused.get('commandRejected') as Array<{ reason: string }>).map((r) => r.reason)).toEqual(['notActive', 'derivedCondition', 'unknownCondition']);
  });

  it('stage conditions follow the vitals: hungry and starving, soaked, drowning; well fed', () => {
    const w = world();
    events(w, 1);
    expect(w.life.conditions.has('wohlgenaehrt')).toBe(true);
    w.vit().satiety = 10;
    const hungry = events(w, 1);
    expect(hungry.get('conditionApplied')).toEqual([expect.objectContaining({ id: 'hungrig', remainingTicks: UNTIMED })]);
    expect(hungry.get('conditionRemoved')).toEqual([expect.objectContaining({ id: 'wohlgenaehrt', reason: 'stufe' })]);
    w.vit().satiety = 0;
    const starving = events(w, 1);
    expect(starving.get('conditionApplied')).toEqual([expect.objectContaining({ id: 'verhungernd' })]);
    expect(starving.get('conditionRemoved')).toEqual([expect.objectContaining({ id: 'hungrig', reason: 'stufe' })]);
    w.vit().satiety = 90;
    w.vit().wetness = 80;
    const soaked = events(w, 1);
    expect(w.life.conditions.active().map((c) => c.id)).toEqual(['durchnaesst', 'wohlgenaehrt']);
    expect(soaked.get('conditionRemoved')).toEqual([expect.objectContaining({ id: 'verhungernd' })]);
  });

  it('effects reach the player: a broken bone slows to 60 %, Erschüttert lowers the maximum health by 15 %', () => {
    const slow = world();
    const fast = world();
    events(slow, 1, [{ type: 'conditions.apply', id: 'knochenbruch' }]);
    events(slow, 1, [{ type: 'player.move', dx: 1, dy: 0 }]);
    events(fast, 2, [{ type: 'player.move', dx: 1, dy: 0 }]);
    const x0s = slow.pos().x;
    const x0f = fast.pos().x;
    events(slow, TICK);
    events(fast, TICK);
    expect((slow.pos().x - x0s) / (fast.pos().x - x0f)).toBeCloseTo(0.6, 6);
    const w = world();
    events(w, 2, [{ type: 'conditions.apply', id: 'erschuettert' }]);
    expect(w.vit().maxHealth).toBeCloseTo(85, 9);
    expect(w.vit().health).toBeLessThanOrEqual(85);
  });

  it('food poisoning makes the player throw up every 20 s (satiety −10, thirst −8)', () => {
    const w = world();
    events(w, 1, [{ type: 'conditions.apply', id: 'lebensmittelvergiftung' }]);
    const s0 = w.vit().satiety;
    const t0 = w.vit().thirst;
    const pulses = events(w, 20 * TICK).get('conditionPulse') as Array<{ satiety: number; thirst: number }>;
    expect(pulses).toEqual([expect.objectContaining({ id: 'lebensmittelvergiftung', satiety: -10, thirst: -8 })]);
    expect(s0 - w.vit().satiety).toBeGreaterThan(10);
    expect(t0 - w.vit().thirst).toBeGreaterThan(8);
  });

  it('burning ends in deep water; fever heals three times as fast while resting', () => {
    const w = lifeWorld(['......', '..ww..', '..ww..', '......']);
    w.spawn(0, 1);
    events(w, 1, [{ type: 'conditions.apply', id: 'brennen' }]);
    const splash = events(w, TICK, [{ type: 'player.move', dx: 1, dy: 0 }]);
    expect(splash.get('conditionRemoved')).toEqual([expect.objectContaining({ id: 'brennen', reason: 'geloescht' })]);
    const resting = world();
    const awake = world();
    resting.bed(6, 5, 'bett');
    resting.jumpToHour(20);
    awake.jumpToHour(20);
    events(resting, 1, [{ type: 'sleep.start', ...resting.tile(6, 5) }]);
    events(resting, 1, [{ type: 'conditions.apply', id: 'fieber' }]);
    events(awake, 1, [{ type: 'conditions.apply', id: 'fieber' }]);
    events(resting, 100);
    events(awake, 100);
    const left = (w: LifeWorld): number => active(w, 'fieber')?.remainingTicks ?? 0;
    expect(600 * TICK - left(resting)).toBe(3 * (600 * TICK - left(awake)));
  });

  it('a fall that breaks a bone brings Knochenbruch (the player system’s fracture hook)', () => {
    const plateau = ['4444.......', '4444.......', '4444.......', '4444.......', '4444.......'];
    let broken = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const w = lifeWorld(plateau, seed);
      w.spawn(1, 2);
      const ev = events(w, TICK, [{ type: 'player.move', dx: 1, dy: 0 }]);
      const land = (ev.get('playerLanded') as Array<{ fracture: boolean }>)[0];
      expect(w.life.conditions.has('knochenbruch')).toBe(land?.fracture === true);
      if (land?.fracture === true) broken++;
    }
    expect(broken).toBeGreaterThan(0);
  });

  it('lethal damage of a condition is reported at once and names the condition as the cause of death', () => {
    const w = world();
    w.vit().health = 1;
    events(w, 1, [{ type: 'conditions.apply', id: 'brennen' }]);
    const ev = events(w, TICK);
    expect(ev.get('playerAfflicted')).toEqual([expect.objectContaining({ id: 'brennen', lethal: true, health: 0 })]);
    expect(ev.get('playerDied')).toEqual([expect.objectContaining({ cause: 'brennen' })]);
    expect(w.life.conditions.active()).toEqual([]);
  });
});
