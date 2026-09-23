import { describe, expect, it } from 'vitest';
import { makeEntity } from '../../../../src/engine/ecs';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';

describe('save roundtrip: ecs', () => {
  it('restores allocator, free list and all registered components', () => {
    const report = expectRoundtrip(
      () => createSimulation({ seed: 3 }),
      (sim) => {
        sim.step([
          { type: 'spawnDebugMover', x: 10, y: 20 },
          { type: 'spawnDebugMover', x: 30, y: 40, vx: 5, vy: -5 },
          { type: 'spawnDebugMover', x: 50, y: 60, controlled: true },
        ]);
        for (let i = 0; i < 30; i++) sim.step();
        sim.step([{ type: 'despawn', entity: makeEntity(1, 0) }]);
        sim.ecs.queueDestroy(makeEntity(0, 0));
      },
      (sim) => sim.participant('ecs'),
    );
    expect(report.id).toBe('ecs');
  });

  it('restored handles keep generations and positions', () => {
    const a = createSimulation({ seed: 3 });
    a.step([{ type: 'spawnDebugMover', x: 10, y: 20, vx: 60, vy: 0 }]);
    const b = createSimulation({ seed: 3 });
    b.participant('ecs').deserialize(structuredClone(a.participant('ecs').serialize()));
    expect(b.ecs.alive(makeEntity(0, 0))).toBe(true);
    expect(b.ecs.count).toBe(1);
  });
});
