/**
 * Betäubung und Aktionstempo für jede Tat des Spielers (M7-68; MASTERPROMPT §11.1 „Erschöpft (−25 % Aktionstempo)“, §11.2
 * „Frierend (−10 % … Arbeitstempo)“, §11.3 Verlangsamt/Betäubt; docs/SPIEL.md §6; ADR-0171 für den Kampf): bis M7 lasen nur
 * Angriff, Block, Rolle und Benutzen das Tempo. Jetzt zählen Sammeln und Werkzeugschwung, Handwerk in der Hand und an Stationen,
 * Essen und Trinken Arbeitsticks (`workStepOf`: das Tempo über die Ticks der Weltuhr verteilt – 0,75 arbeitet drei Ticks von
 * vier), und eine Betäubung hält jede Tat an: ein laufendes Sammeln endet, das Handwerk wartet (`stunned`), Essen und Trinken
 * brechen ab (`betaeubt`), Zerlegen und Fallen werden abgelehnt (`stunned`). Die Texte von Erschöpft und Verlangsamt
 * („Alle Arbeiten … 25 % langsamer“, „15 % langsameres Arbeiten“) stimmen damit.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { workStepOf } from '../../../src/game/conditions/formulas';
import { CRAFT_REJECT_REASONS } from '../../../src/game/crafting/events';
import { CraftingSystem } from '../../../src/game/crafting/system';
import { CREATURE_REJECT_REASONS } from '../../../src/game/creatures/events';
import type { PlayerPace } from '../../../src/game/player/system';
import type { SimEventMap } from '../../../src/game/sim';
import { createI18n, isI18nKey } from '../../../src/i18n';
import { eventsOf } from './kampf-testwelt';
import { field, gatherWorld, type GatherWorld } from './interaktion-testwelt';
import { kreaturWelt, meadow, tileOf } from './kreatur-testwelt';
import { lifeWorld, type LifeWorld } from './leben-testwelt';

const H = BALANCE.harvest;
const TICK_HZ = BALANCE.time.tickHz;
const HIT_TICKS = Math.round(H.toolHitSeconds * TICK_HZ);
const SWING_TICKS = Math.round(H.toolSwingSeconds * TICK_HZ);
const HAND_TICKS = Math.round(H.handPickSeconds * TICK_HZ);
const INV0 = { bereich: 'inventar', index: 0 } as const;
const HOTBAR = { bereich: 'schnellleiste', index: 0 } as const;
type Rejected = SimEventMap['commandRejected'];

/** A pace the test sets: the gathering world has no condition system, so it binds this one (as `usePace` binds the conditions). */
class TestPace implements PlayerPace {
  speed = 1;
  stun = false;
  stunned(): boolean {
    return this.stun;
  }
  actionSpeed(): number {
    return this.stun ? 0 : this.speed;
  }
  workStep(tick: number): number {
    return this.stun ? 0 : workStepOf(tick, this.speed);
  }
  precision(): number {
    return 1;
  }
}

function rejected(ev: Map<string, unknown[]>, type: string): string[] {
  return eventsOf<Rejected>(ev, 'commandRejected')
    .filter((r) => r.type === type)
    .map((r) => r.reason);
}

describe('Arbeitsticks auf der Weltuhr (workStepOf)', () => {
  it('Tempo 1 arbeitet jeden Tick, 0 keinen, 0,75 drei von vier, 0,85 genau 85 %, über 1 manchmal zwei', () => {
    const sum = (pace: number, from: number, n: number): number => {
      let s = 0;
      for (let t = from; t < from + n; t++) s += workStepOf(t, pace);
      return s;
    };
    expect(sum(1, 1000, 600)).toBe(600);
    expect(sum(0, 1000, 600)).toBe(0);
    expect(sum(0.75, 1000, 600)).toBe(450);
    expect(sum(0.85, 1000, 600)).toBe(510);
    expect(sum(0.9 * 0.75, 7, 4000)).toBeGreaterThanOrEqual(2699);
    expect(sum(0.9 * 0.75, 7, 4000)).toBeLessThanOrEqual(2701);
    expect(sum(1.5, 1, 600)).toBe(900);
    for (let t = 0; t < 200; t++) expect([0, 1]).toContain(workStepOf(t, 0.6375));
  });

  it('die echten Zustände: Verlangsamt 0,85, Erschöpft 0,75, Frierend 0,9, Betäubt 0 – ohne Zustand genau 1', () => {
    const w = lifeWorld(meadow(10, 8));
    w.spawn(3, 3);
    const c = w.life.conditions;
    const span = (n: number): number => {
      let s = 0;
      for (let t = 2000; t < 2000 + n; t++) s += c.workStep(t);
      return s;
    };
    expect(span(600)).toBe(600);
    c.apply(w.sim, 'verlangsamt', 60);
    expect(span(600)).toBe(510);
    c.cure(w.sim, 'verlangsamt');
    w.vit().exhaustion = 95;
    w.run(1);
    expect(w.vit().exhaustionStage).toBe('erschoepft');
    expect(span(600)).toBe(450);
    w.vit().exhaustion = 10;
    w.run(1);
    expect(span(600)).toBe(600);
    c.apply(w.sim, 'betaeubt');
    expect(c.stunned()).toBe(true);
    expect(span(600)).toBe(0);
  });
});

describe('Sammeln und Werkzeugschwung (src/game/interaction)', () => {
  /** A meadow with an oak (2 tiles wide) at map (5, 5); the player below it, the bronze axe (3 hits) in the hand. */
  function oak(): { w: GatherWorld; pace: TestPace } {
    const w = gatherWorld(field(14, 12, ['', '', '', '', '', '.....E']));
    const pace = new TestPace();
    w.player.usePace(pace);
    w.spawn(5, 7);
    w.hold('probe_bronzeaxt');
    return { w, pace };
  }

  /** The ticks (from the press) of every hit until the oak falls. */
  function hitTicks(w: GatherWorld): number[] {
    const out: number[] = [];
    const start = w.sim.tick;
    w.run(1, [{ type: 'player.interact', on: true }]);
    for (let t = 0; t < 1200 && w.interaction.working; t++) {
      const ev = w.run(1);
      for (const _ of ev.get('harvestHit') ?? []) out.push(w.sim.tick - start);
    }
    w.run(1, [{ type: 'player.interact', on: false }]);
    return out;
  }

  it('volles Tempo: erster Schlag nach ⅓ s, dann alle 0,5 s; der Schwung-Takt (`workTicks`) läuft mit', () => {
    const { w } = oak();
    const hits = hitTicks(w);
    expect(hits).toHaveLength(3);
    expect(hits[1]! - hits[0]!).toBe(SWING_TICKS);
    expect(hits[2]! - hits[1]!).toBe(SWING_TICKS);
  });

  it('Erschöpft (0,75): jeder Schwung dauert ein Drittel länger – auch der Schwung-Takt des Figurenclips', () => {
    const { w, pace } = oak();
    pace.speed = 0.75;
    w.run(1, [{ type: 'player.interact', on: true }]);
    let first = -1;
    let ticks = 1;
    for (; ticks < 400 && first < 0; ticks++) if ((w.run(1).get('harvestHit') ?? []).length > 0) first = ticks;
    // The swing clock reads the work ticks: at the first hit exactly the hit point of the clip.
    expect(w.interaction.workTicks).toBe(HIT_TICKS + 0);
    expect(first).toBeGreaterThanOrEqual(Math.floor(HIT_TICKS / 0.75));
    expect(first).toBeLessThanOrEqual(Math.ceil(HIT_TICKS / 0.75) + 1);
    w.run(1, [{ type: 'player.interact', on: false }]);
    const w2 = oak();
    w2.pace.speed = 0.75;
    const hits = hitTicks(w2.w);
    expect(hits).toHaveLength(3);
    for (const gap of [hits[1]! - hits[0]!, hits[2]! - hits[1]!]) {
      expect(gap).toBeGreaterThanOrEqual(Math.floor(SWING_TICKS / 0.75));
      expect(gap).toBeLessThanOrEqual(Math.ceil(SWING_TICKS / 0.75));
    }
  });

  it('von Hand gepflückt dauert bei halbem Tempo doppelt so lang', () => {
    const run = (speed: number): number => {
      const w = gatherWorld(field(12, 10, ['', '', '', '', '', '.....F']));
      const pace = new TestPace();
      pace.speed = speed;
      w.player.usePace(pace);
      w.spawn(5, 6);
      const start = w.sim.tick;
      let done = -1;
      w.run(1, [{ type: 'player.interact', on: true }]);
      for (let t = 0; t < 400 && done < 0; t++) if ((w.run(1).get('harvested') ?? []).length > 0) done = w.sim.tick - start;
      return done;
    };
    const full = run(1);
    expect(full).toBe(HAND_TICKS + 1);
    const half = run(0.5);
    expect(half).toBeGreaterThanOrEqual(2 * HAND_TICKS);
    expect(half).toBeLessThanOrEqual(2 * HAND_TICKS + 2);
  });

  it('betäubt: der Schwung endet, kein Schlag; ein Druck wird abgelehnt (`stunned`); E gehalten geht es danach weiter', () => {
    const { w, pace } = oak();
    w.run(HIT_TICKS + 2, [{ type: 'player.interact', on: true }]);
    expect(w.interaction.working).toBe(true);
    pace.stun = true;
    const during = w.run(SWING_TICKS * 3);
    expect(during.get('actionStopped')).toEqual([expect.objectContaining({ reason: 'blocked' })]);
    expect(during.get('harvestHit') ?? []).toEqual([]);
    expect(w.interaction.working).toBe(false);
    // A fresh press while stunned: refused once.
    w.run(1, [{ type: 'player.interact', on: false }]);
    expect(rejected(w.run(1, [{ type: 'player.interact', on: true }]), 'player.interact')).toEqual(['stunned']);
    expect(w.interaction.working).toBe(false);
    pace.stun = false;
    const after = w.run(SWING_TICKS * 3);
    expect(w.interaction.working || (after.get('treeFelled') ?? []).length > 0).toBe(true);
    expect((after.get('harvestHit') ?? []).length).toBeGreaterThan(0);
  });
});

describe('Handwerk in der Hand und an Stationen (src/game/crafting)', () => {
  function craftWorld(): { w: LifeWorld; crafting: CraftingSystem } {
    const w = lifeWorld(meadow(12, 8));
    const crafting = w.sim.addSystem(new CraftingSystem({ player: w.player, inventory: w.inventory, collision: w.collision, spill: () => undefined }));
    crafting.useSkills(w.life.skills);
    w.spawn(2, 2);
    w.inventory.give(w.sim, 'fasern', 30);
    return { w, crafting };
  }

  /** Ticks from the order to the finished piece of `faserseil`. */
  function pieceTicks(w: LifeWorld): number {
    const start = w.sim.tick;
    w.run(1, [{ type: 'craft.start', recipe: 'rezept_faserseil', count: 1 }]);
    for (let t = 0; t < 4000; t++) if ((w.run(1).get('craftCompleted') ?? []).length > 0) return w.sim.tick - start;
    return -1;
  }

  it('Verlangsamt dauert ein Stück 1/0,85 so lang, Erschöpft 1/0,75 so lang', () => {
    const a = craftWorld();
    const full = pieceTicks(a.w);
    expect(full).toBeGreaterThan(30);
    const b = craftWorld();
    b.w.life.conditions.apply(b.w.sim, 'verlangsamt', 600);
    const slow = pieceTicks(b.w);
    expect(slow).toBeGreaterThanOrEqual(Math.floor((full - 1) / 0.85));
    expect(slow).toBeLessThanOrEqual(Math.ceil((full - 1) / 0.85) + 2);
    const c = craftWorld();
    c.w.vit().exhaustion = 95;
    const tired = pieceTicks(c.w);
    expect(tired).toBeGreaterThanOrEqual(Math.floor((full - 1) / 0.75));
    expect(tired).toBeLessThanOrEqual(Math.ceil((full - 1) / 0.75) + 2);
  });

  it('betäubt wartet die Arbeit (blocked `stunned`, kein Fortschritt) und geht danach weiter', () => {
    const { w, crafting } = craftWorld();
    w.run(1, [{ type: 'craft.start', recipe: 'rezept_faserseil', count: 1 }]);
    w.run(5);
    const before = crafting.orders[0]?.fortschritt ?? -1;
    expect(before).toBeGreaterThan(0);
    w.life.conditions.apply(w.sim, 'betaeubt');
    w.run(30);
    expect(crafting.blocked).toBe('stunned');
    expect(crafting.orders[0]?.fortschritt).toBe(before);
    w.run(Math.round(1.5 * TICK_HZ));
    expect(crafting.blocked).toBe(null);
    expect(crafting.orders[0]?.fortschritt ?? 0).toBeGreaterThan(before);
    expect(CRAFT_REJECT_REASONS).toContain('stunned');
  });
});

describe('Essen und Trinken (src/game/actions)', () => {
  it('Erschöpft isst ein Apfel ein Drittel länger (90 → 120 Ticks)', () => {
    const w = lifeWorld(meadow(10, 8));
    w.spawn(3, 3);
    w.vit().exhaustion = 95;
    w.run(1, [{ type: 'inventory.give', item: 'apfel', count: 1 }]);
    const start = w.sim.tick;
    w.run(1, [{ type: 'action.eat', from: INV0 }]);
    let done = -1;
    for (let t = 0; t < 400 && done < 0; t++) if ((w.run(1).get('itemEaten') ?? []).length > 0) done = w.sim.tick - start;
    expect(done).toBeGreaterThanOrEqual(119);
    expect(done).toBeLessThanOrEqual(122);
  });

  it('eine Betäubung bricht das Essen ab (`betaeubt`), betäubt beginnt nichts (`stunned`)', () => {
    const w = lifeWorld(meadow(10, 8));
    w.spawn(3, 3);
    w.run(1, [{ type: 'inventory.give', item: 'apfel', count: 2 }]);
    w.run(10, [{ type: 'action.eat', from: INV0 }]);
    w.life.conditions.apply(w.sim, 'betaeubt');
    const ev = w.run(1);
    expect(ev.get('activityInterrupted')).toEqual([expect.objectContaining({ action: 'essen', item: 'apfel', reason: 'betaeubt' })]);
    expect(w.inventory.count('apfel')).toBe(2);
    expect(rejected(w.run(1, [{ type: 'action.eat', from: INV0 }]), 'action.eat')).toEqual(['stunned']);
    w.run(Math.round(1.5 * TICK_HZ));
    expect(rejected(w.run(1, [{ type: 'action.eat', from: INV0 }]), 'action.eat')).toEqual([]);
  });
});

describe('Zerlegen und Fallen (src/game/creatures)', () => {
  it('betäubt: Zerlegen, Falle stellen und Falle nehmen abgelehnt (`stunned`), danach wie gewohnt', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.creature('hase', 21, 15);
    const died = eventsOf<SimEventMap['creatureDied']>(w.run(1, [{ type: 'creature.kill', radius: 3 }]), 'creatureDied')[0];
    const carcass = died?.carcass as number;
    expect(carcass).not.toBe(NULL_ENTITY);
    w.hold('steinmesser');
    w.life.conditions.apply(w.sim, 'betaeubt');
    expect(rejected(w.run(1, [{ type: 'carcass.carve', carcass }]), 'carcass.carve')).toEqual(['stunned']);
    expect(w.creatures.carcasses.has(carcass)).toBe(true);
    w.hold('schlinge');
    const { tx, ty } = tileOf(w.pos());
    expect(rejected(w.run(1, [{ type: 'trap.place', from: HOTBAR, tx, ty: ty + 1 }]), 'trap.place')).toEqual(['stunned']);
    expect(w.traps.traps).toEqual([]);
    w.run(Math.round(1.5 * TICK_HZ));
    expect(rejected(w.run(1, [{ type: 'trap.place', from: HOTBAR, tx, ty: ty + 1 }]), 'trap.place')).toEqual([]);
    const trap = w.traps.traps[0];
    expect(trap).toBeDefined();
    w.life.conditions.apply(w.sim, 'betaeubt');
    expect(rejected(w.run(1, [{ type: 'trap.take', trap: trap?.id ?? 0 }]), 'trap.take')).toEqual(['stunned']);
    w.run(Math.round(1.5 * TICK_HZ));
    expect(rejected(w.run(1, [{ type: 'trap.take', trap: trap?.id ?? 0 }]), 'trap.take')).toEqual([]);
    w.hold('steinmesser');
    expect(eventsOf(w.run(1, [{ type: 'carcass.carve', carcass }]), 'carcassCarved')).toHaveLength(1);
  });

  it('jeder neue Grund `stunned` hat seinen Text DE und EN', () => {
    expect(CREATURE_REJECT_REASONS).toContain('stunned');
    for (const lang of ['de', 'en'] as const) {
      const i18n = createI18n(lang, { strict: true });
      for (const key of ['ui.interaction.block.stunned', 'ui.action.reject.stunned', 'ui.craft.reject.stunned', 'ui.creatures.reject.stunned']) {
        expect(isI18nKey(key), key).toBe(true);
        if (isI18nKey(key)) expect(i18n.t(key).length, `${lang} ${key}`).toBeGreaterThan(0);
      }
    }
  });
});
