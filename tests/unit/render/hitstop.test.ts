/**
 * M6-05 "Hitstop 2–6 Frames je Wucht" (MASTERPROMPT §6.2, §19.1; docs/SPIEL.md §10 "Hitstop in der Simulation"): the
 * simulation freezes both bodies for `hitstopTicks(wucht)` ticks (2 … 6 by impact 1 … 5); the presentation freezes their
 * animation clocks for exactly those ticks – the creature's hit clip and its attack clip (whose wind-up the simulation
 * stretches by the same ticks) stand still over the frozen ticks and run on after them; the player's figure keeps the
 * frame it showed. Checked against a real hit of the combat system for every impact class.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { hitstopTicks } from '../../../src/game/combat/formulas';
import { createCombatAttack, type CombatSystem } from '../../../src/game/combat/system';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { createSimulation } from '../../../src/game/setup';
import { attackClipSeconds, hitstopOverlap } from '../../../src/render/game/creatures';

const TICK_HZ = BALANCE.time.tickHz;

/**
 * The clock of a creature's hit clip at simulation time `now` (as `CreatureSprites` runs it): ticks since the hit minus
 * the frozen ones.
 */
function hitClock(hurtTick: number, from: number, n: number, now: number): number {
  return (now - hurtTick - hitstopOverlap(from, n, hurtTick, now)) / TICK_HZ;
}

describe('Hitstop: Dauer nach Wucht', () => {
  it('Wucht 1 … 5 hält 2 … 6 Ticks (docs/SPIEL.md §10, BALANCE.combat.impact)', () => {
    expect([1, 2, 3, 4, 5].map((w) => hitstopTicks(w))).toEqual([2, 3, 4, 5, 6]);
    expect(hitstopTicks(0)).toBe(2);
    expect(hitstopTicks(9)).toBe(6);
  });

  it('die Uhr des Trefferclips steht genau die Hitstop-Ticks still, dann läuft sie weiter', () => {
    for (let w = 1; w <= 5; w++) {
      const n = hitstopTicks(w);
      const hit = 1000;
      // Frozen are the ticks hit+1 … hit+n: the clock stays at 0 from the hit through them.
      const clocks: number[] = [];
      for (let k = 0; k <= n + 3; k++) clocks.push(hitClock(hit, hit, n, hit + k));
      const still = clocks.filter((c) => c === 0).length - 1;
      expect(still, `Wucht ${w}`).toBe(n);
      expect(clocks[n + 1]).toBeCloseTo(1 / TICK_HZ, 12);
      expect(clocks[n + 3]).toBeCloseTo(3 / TICK_HZ, 12);
      // Between ticks (the frame's alpha) the frozen clock does not creep either.
      expect(hitClock(hit, hit, n, hit + n - 0.5)).toBe(0);
    }
  });

  it('eine Ausholphase, die der Hitstop streckt, trifft ihr Schlag-Bild trotzdem auf dem Schlag-Tick', () => {
    const strike = 0.4;
    const start = 500;
    const windup = 24;
    const n = hitstopTicks(4);
    const from = start + 10;
    // The simulation moves the blow n ticks later.
    const end = start + windup + n;
    const eff = end - start - hitstopOverlap(from, n, start, end);
    expect(eff).toBe(windup);
    const at = (now: number): number => attackClipSeconds('ausholen', now - start - hitstopOverlap(from, n, start, now), eff, strike, TICK_HZ);
    expect(at(from)).toBeCloseTo(at(from + n), 12);
    expect(at(from + n + 1)).toBeGreaterThan(at(from + n));
    expect(at(end)).toBeCloseTo(strike, 12);
    expect(hitstopOverlap(-1, 0, 0, 100)).toBe(0);
    expect(hitstopOverlap(10, 4, 0, 12)).toBe(2);
    expect(hitstopOverlap(10, 4, 12, 100)).toBe(2);
  });

  it('ein echter Treffer jeder Wucht friert die Kreatur so lange ein, wie der Hitstop der Simulation dauert', () => {
    const sim = createSimulation({ seed: 20260930, worldSize: 'small' });
    sim.step([{ type: 'player.spawn' } as never]);
    const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
    const x = pos.get(sim.player, 'x') + 16;
    const y = pos.get(sim.player, 'y');
    const combat = sim.system('combat') as CombatSystem;
    const creatures = sim.system('creatures') as CreatureSystem;
    for (let w = 1; w <= 5; w++) {
      sim.step([{ type: 'creature.spawn', creature: 'reh', count: 1, x, y, layer: 0 } as never]);
      const e = creatures.store.entityAt(creatures.store.size - 1);
      const attack = createCombatAttack();
      attack.team = 'spieler';
      attack.damage = 1;
      attack.type = 'wucht';
      attack.wucht = w;
      attack.fromX = x - 16;
      attack.fromY = y;
      const tick = sim.tick;
      const hit = combat.resolve(sim, sim.player, e, attack);
      expect(hit?.hitstopTicks, `Wucht ${w}`).toBe(hitstopTicks(w));
      const s = creatures.store.get(e);
      expect(s?.hitstopTicks).toBe(hitstopTicks(w));
      // The presentation's freeze from the state the simulation keeps.
      const frozen = [...Array(10).keys()].filter((k) => hitstopOverlap(s?.hitstopFromTick ?? -1, s?.hitstopTicks ?? 0, tick + k, tick + k + 1) > 0).length;
      expect(frozen, `Wucht ${w}`).toBe(hitstopTicks(w));
      sim.step([{ type: 'creature.kill', radius: 4 } as never]);
    }
  });
});
