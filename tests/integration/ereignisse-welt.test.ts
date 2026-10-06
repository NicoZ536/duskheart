/**
 * The Lumen rain's meteorite over ten worlds (M7-39; MASTERPROMPT §10 "selten ein Meteorit mit Sternenerz"; docs/SPIEL.md §18):
 * in every run the plan gives a meteorite exactly one comes down with its star ore, in every other none – and over ten seeds
 * some rains have one and some do not (the sweep of tests/unit/game/ereignisse-lumenregen.test.ts, ADR-0192). Lightning
 * (M7-40; docs/SPIEL.md §18 "Blitze"): two hours of a thunderstorm strike from `hash(seed, 'blitz', region, minute)` – the
 * same for the same world, others for another seed, none under a clear sky, every strike in the active zone and within
 * the strike range of the player (the sweep of tests/unit/game/blitze.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import { planDraw } from '../../src/game/worldevents/formulas';
import { TILE_PX } from '../../src/world/model/coords';
import { ereignisWelt, OFFSET } from '../unit/game/ereignisse-testwelt';

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

/** The drawn tiles (`x,y` from the test world's corner) of the struck points of a run's `lightningStruck` events. */
function struckTiles(map: Map<string, unknown[]>): string {
  return ((map.get('lightningStruck') ?? []) as { x: number; y: number }[]).map((s) => `${Math.floor(s.x / TILE_PX) - OFFSET},${Math.floor(s.y / TILE_PX) - OFFSET}`).join(' ');
}

describe('lightning: the storm', () => {
  const storm = (state: 'gewitter' | 'klar', seed = 1): string => {
    const rows = Array.from({ length: 30 }, () => '.'.repeat(40));
    const w = ereignisWelt(rows, { x: 20, y: 15 }, { seed });
    w.weather.state = state;
    // God mode: the storm's strikes near the player do not end the test early.
    w.cheats.god = true;
    return struckTiles(w.seconds(120));
  };

  it('strikes in a thunderstorm – the same for the same world, other strikes for another seed – and never under a clear sky', () => {
    const a = storm('gewitter');
    // 120 minutes at a chance of 0,25: dozens drawn, those in the drawn (active) area strike.
    expect(a.split(' ').length).toBeGreaterThan(5);
    expect(storm('gewitter')).toBe(a);
    expect(storm('gewitter', 2)).not.toBe(a);
    expect(storm('klar')).toBe('');
    // Every strike lies in the active zone (the drawn 40 × 30) and within the strike range of the player.
    for (const t of a.split(' ')) {
      const [x, y] = t.split(',').map(Number) as [number, number];
      expect(x >= 0 && x < 40 && y >= 0 && y < 30).toBe(true);
      expect(Math.hypot(x - 20, y - 15)).toBeLessThanOrEqual(W.strikeRangeTiles + 1);
    }
  });
});
