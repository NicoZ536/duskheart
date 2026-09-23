import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';

describe('save roundtrip: clock', () => {
  it('restores tick, day position and day length', () => {
    const report = expectRoundtrip(
      () => createSimulation({ seed: 1 }),
      (sim) => {
        sim.clock.setTick(sim.clock.ticksPerDay * 3 + 12345);
        sim.clock.setDayLength(36);
        for (let i = 0; i < 77; i++) sim.clock.advance();
      },
      (sim) => sim.participant('clock'),
    );
    expect(report.id).toBe('clock');
    expect(report.transports).toEqual(['structuredClone', 'json']);
  });
});
