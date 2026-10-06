/**
 * Save roundtrip of the participant `unlocks` (M7-36, docs/SPIEL.md §22, §27): the granted ids with tick and source survive
 * save → load in their order; saves before M7 load with nothing granted.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { UnlocksSystem } from '../../../../src/game/unlocks/system';
import { Simulation } from '../../../../src/game/sim';
import { expectRoundtrip } from '../../../../src/save/roundtrip';

function world(): { sim: Simulation; unlocks: UnlocksSystem } {
  const sim = new Simulation({ seed: 1, worldSize: 'small' });
  const unlocks = sim.addSystem(new UnlocksSystem());
  return { sim, unlocks };
}

describe('save roundtrip: unlocks', () => {
  it('restores the grants with tick and source, in grant order', () => {
    const report = expectRoundtrip(
      world,
      (w) => {
        w.unlocks.grant(w.sim, 'lf1_wegsteine', 'leuchtfeuer:1');
        w.sim.step();
        w.unlocks.grant(w.sim, 'lf2_kanu', 'debug');
      },
      (w) => w.unlocks.save,
    );
    expect(report.id).toBe('unlocks');
    const data = JSON.parse(report.canonical) as { granted: { id: string; source: string }[] };
    expect(data.granted.map((g) => [g.id, g.source])).toEqual([
      ['lf1_wegsteine', 'leuchtfeuer:1'],
      ['lf2_kanu', 'debug'],
    ]);
  });

  it('a load tells the listeners silently; the game simulation has the participant; saves before M7 migrate; bad data is refused', () => {
    const w = world();
    const told: (object | null)[] = [];
    w.unlocks.onGrant((s) => told.push(s));
    w.unlocks.save.deserialize({ granted: [{ id: 'lf1_wegsteine', tick: 4, source: 'leuchtfeuer:1' }] });
    expect(told).toEqual([null]);
    expect(w.unlocks.has('lf1_wegsteine')).toBe(true);
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('unlocks').serialize()).toEqual({ granted: [] });
    expect(sim.participant('unlocks').migrations?.find((m) => m.from === 0)?.migrate(undefined)).toEqual({ granted: [] });
    expect(() => w.unlocks.save.deserialize({ granted: [{ id: 'lf1_wegsteine', tick: 4, source: 'zufall' }] })).toThrow(/unlocks snapshot invalid/);
    expect(() => w.unlocks.save.deserialize({ granted: [{ id: 'lf9_nichts', tick: 4, source: 'debug' }] })).toThrow(/unknown unlock/);
    const twice = { id: 'lf1_wegsteine', tick: 4, source: 'debug' };
    expect(() => w.unlocks.save.deserialize({ granted: [twice, twice] })).toThrow(/unlocks snapshot invalid/);
  });
});
