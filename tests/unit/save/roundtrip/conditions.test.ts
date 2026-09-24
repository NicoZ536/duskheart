/**
 * Save roundtrip of the participant `conditions` (M3-19): the active conditions with stacks, remaining
 * time, pulse timer and pending damage, in content order, survive save → load.
 */
import { describe, expect, it } from 'vitest';
import { NULL_ENTITY } from '../../../../src/engine/ecs';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { lifeWorld } from '../../game/leben-testwelt';
import { meadow } from '../../game/spieler-testwelt';

describe('save roundtrip: conditions', () => {
  it('restores stacks, timers and pending damage', () => {
    const report = expectRoundtrip(
      () => lifeWorld(meadow(12, 12)),
      (w) => {
        w.spawn(5, 5);
        w.run(1, [{ type: 'conditions.apply', id: 'blutung' }]);
        w.run(1, [{ type: 'conditions.apply', id: 'blutung' }]);
        w.run(1, [{ type: 'conditions.apply', id: 'lebensmittelvergiftung' }, { type: 'conditions.apply', id: 'knochenbruch' }]);
        w.run(17);
      },
      (w) => w.sim.participant('conditions'),
    );
    expect(report.id).toBe('conditions');
    const data = JSON.parse(report.canonical) as { entity: number; active: Array<{ id: string; stacks: number; remainingTicks: number; pendingDamage: number; pulseTicks: number }> };
    expect(data.active.map((c) => c.id)).toEqual(['blutung', 'lebensmittelvergiftung', 'knochenbruch', 'wohlgenaehrt']);
    expect(data.active[0]).toMatchObject({ stacks: 2 });
    expect(data.active[0]?.pendingDamage).toBeGreaterThan(0);
    expect(data.active[1]?.pulseTicks).toBeGreaterThan(0);
    expect(data.active[2]?.remainingTicks).toBe(-1);
  });

  it('rejects malformed snapshots: unknown ids, wrong order, a timer on a curable condition, conditions without a player', () => {
    const p = lifeWorld(meadow(4, 4)).sim.participant('conditions');
    const c = (id: string, remainingTicks = 60) => ({ id, stacks: 1, remainingTicks, pulseTicks: 0, pendingDamage: 0 });
    expect(() => p.deserialize({ entity: 0, active: [c('glitzern')] })).toThrow(TypeError);
    expect(() => p.deserialize({ entity: 0, active: [c('fieber'), c('blutung')] })).toThrow(TypeError);
    expect(() => p.deserialize({ entity: 0, active: [c('knochenbruch', 60)] })).toThrow(TypeError);
    expect(() => p.deserialize({ entity: NULL_ENTITY, active: [c('blutung')] })).toThrow(TypeError);
    expect(() => p.deserialize({ entity: 0 })).toThrow(TypeError);
  });
});
