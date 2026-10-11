/**
 * Save roundtrip of the participant `achievements` (M7-47, docs/SPIEL.md §27 "Erfolge"): the unlocked achievements with their
 * tick and play time in order and the counters of the open ones survive save → load; saves before M7 load with every achievement open.
 */
import { describe, expect, it } from 'vitest';
import { AchievementsSystem } from '../../../../src/game/achievements/system';
import { createSimulation } from '../../../../src/game/setup';
import type { Simulation } from '../../../../src/game/sim';
import { StatsSystem } from '../../../../src/game/stats/system';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { chronikWelt, steps, type Feeder } from '../../game/chronik-testwelt';

function world(): { sim: Simulation; feeder: Feeder; ach: AchievementsSystem } {
  const w = chronikWelt();
  w.sim.addSystem(new StatsSystem({ world: w.world }));
  return { sim: w.sim, feeder: w.feeder, ach: w.sim.addSystem(new AchievementsSystem({ world: w.world })) };
}

describe('save roundtrip: achievements', () => {
  it('restores the unlocked ones with tick and play time and the open ones counters', () => {
    const report = expectRoundtrip(
      world,
      (w) => {
        w.feeder.push(['bossDefeated', { boss: 'borkenvater', dauerTicks: 1, x: 0, y: 0 }], ['lightIgnited', { light: 1, kind: 'lagerfeuer', layer: 0, x: 0, y: 0 }]);
        steps(w.sim, 2);
      },
      (w) => w.ach.save,
    );
    const data = JSON.parse(report.canonical) as { erreicht: { id: string; tick: number; spielzeit: number }[]; wartend: Record<string, number[]> };
    expect(data.erreicht.map((a) => a.id)).toEqual(['borkenvater_besiegt']);
    // The unlock's tick and the play time then (no sleep: every tick of the world counts, its own included).
    expect(data.erreicht[0]?.spielzeit).toBe((data.erreicht[0]?.tick ?? -1) + 1);
    expect(data.wartend.feuermacher).toEqual([1]);
    // The restored counters go on counting.
    const w = world();
    w.ach.save.deserialize(JSON.parse(report.canonical));
    for (let i = 0; i < 4; i++) w.feeder.push(['lightIgnited', { light: 2 + i, kind: 'lagerfeuer', layer: 0, x: 0, y: 0 }]);
    steps(w.sim, 1);
    expect(w.ach.has('feuermacher')).toBe(true);
  });

  it('the game simulation has the participant; saves before M7 migrate; bad data is refused', () => {
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('achievements').migrations?.find((m) => m.from === 0)?.migrate(undefined)).toEqual({ erreicht: [], wartend: {} });
    const w = world();
    expect(() => w.ach.save.deserialize({ erreicht: [{ id: 'erfunden', tick: 1, spielzeit: 1 }], wartend: {} })).toThrow(/unknown achievement/);
    expect(() =>
      w.ach.save.deserialize({ erreicht: [{ id: 'koch', tick: 1, spielzeit: 1 }, { id: 'koch', tick: 2, spielzeit: 2 }], wartend: {} }),
    ).toThrow(/achievements snapshot invalid/);
    // An unlock without its play time is refused, not guessed.
    expect(() => w.ach.save.deserialize({ erreicht: [{ id: 'koch', tick: 1 }], wartend: {} })).toThrow(/achievements snapshot invalid/);
  });
});
