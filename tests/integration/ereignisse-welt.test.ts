/**
 * The Lumen rain's meteorite over ten worlds (M7-39; MASTERPROMPT §10 "selten ein Meteorit mit Sternenerz"; docs/SPIEL.md §18):
 * in every run the plan gives a meteorite exactly one comes down with its star ore, in every other none – and over ten seeds
 * some rains have one and some do not (the sweep of tests/unit/game/ereignisse-lumenregen.test.ts, ADR-0192).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import { planDraw } from '../../src/game/worldevents/formulas';
import { ereignisWelt } from '../unit/game/ereignisse-testwelt';

const W = BALANCE.worldEvents;
const MEADOW = Array.from({ length: 64 }, () => '.'.repeat(64));
const SEEDS = 10;

describe('Lumen rain over ten worlds', () => {
  it('brings its meteorite once in the runs its plan gives one – star ore at the impact', () => {
    let seen = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const w = ereignisWelt(MEADOW, { x: 32, y: 32 }, { seed });
      w.sim.skipTicks(w.sim.clock.ticksPerDay);
      w.jumpTo(23);
      w.run(1, [{ type: 'worldEvent.start', event: 'lumenregen' }]);
      const day = w.sim.clock.day;
      w.seconds(62);
      const ore = w.fallen.filter((f) => f.stack.item === 'sternenerz');
      const planned = planDraw(seed, 'lumenregen', day, 3) < W.meteorChance;
      expect(ore.length, `seed ${seed}`).toBe(planned ? 1 : 0);
      if (ore.length === 1) {
        seen++;
        expect(ore[0]?.stack.count).toBeGreaterThanOrEqual(W.meteorOre[0] as number);
        expect(ore[0]?.stack.count).toBeLessThanOrEqual(W.meteorOre[1] as number);
      }
    }
    // A quarter of the rains: some of ten.
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThan(SEEDS);
  });
});
