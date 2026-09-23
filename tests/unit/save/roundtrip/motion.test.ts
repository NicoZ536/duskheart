import { describe, expect, it } from 'vitest';
import { makeEntity } from '../../../../src/engine/ecs';
import { createSimulation } from '../../../../src/game/setup';
import type { MotionSystem } from '../../../../src/game/systems/motion';
import { expectRoundtrip } from '../../../../src/save/roundtrip';

describe('save roundtrip: motion', () => {
  it('restores the controlled entity', () => {
    const report = expectRoundtrip(
      () => createSimulation({ seed: 4 }),
      (sim) => {
        sim.step([{ type: 'spawnDebugMover', x: 1, y: 1 }]);
        sim.step([{ type: 'spawnDebugMover', x: 5, y: 5, controlled: true }]);
      },
      (sim) => sim.participant('motion'),
    );
    expect(report.id).toBe('motion');
    expect(JSON.parse(report.canonical)).toEqual({ controlled: makeEntity(1, 0) });
  });

  it('a restored controlled entity can be steered after a full load', () => {
    const a = createSimulation({ seed: 4 });
    a.step([{ type: 'spawnDebugMover', x: 5, y: 5, controlled: true }]);
    const b = createSimulation({ seed: 4 });
    for (const p of a.participants()) b.participant(p.id).deserialize(structuredClone(p.serialize()));
    const motion = b.system('motion') as MotionSystem;
    expect(motion.controlled).toBe(makeEntity(0, 0));
    b.step([{ type: 'move', dx: 1, dy: 0 }]);
    expect(motion.velocity.get(makeEntity(0, 0), 'vx')).toBeGreaterThan(0);
  });
});
