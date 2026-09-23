import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';

describe('save roundtrip: rng', () => {
  it('restores every named stream state', () => {
    const report = expectRoundtrip(
      () => createSimulation({ seed: 77 }),
      (sim) => {
        for (let i = 0; i < 5; i++) sim.rng.stream('motion').nextU32();
        sim.rng.stream('weather').float(0, 1);
      },
      (sim) => sim.participant('rng'),
    );
    expect(report.id).toBe('rng');
  });

  it('restored streams continue with the same numbers', () => {
    const a = createSimulation({ seed: 5 });
    a.rng.stream('motion').nextU32();
    const b = createSimulation({ seed: 5 });
    b.participant('rng').deserialize(structuredClone(a.participant('rng').serialize()));
    for (let i = 0; i < 10; i++) expect(b.rng.stream('motion').nextU32()).toBe(a.rng.stream('motion').nextU32());
  });
});
