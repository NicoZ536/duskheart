/**
 * Save roundtrip of the participant `actions` (M3-25): eating in progress (item, slot, time left), the
 * seat and thrown pieces in the air survive save → load.
 */
import { describe, expect, it } from 'vitest';
import { NULL_ENTITY } from '../../../../src/engine/ecs';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { lifeWorld } from '../../game/leben-testwelt';
import { T, meadow } from '../../game/spieler-testwelt';

describe('save roundtrip: actions', () => {
  it('restores eating in progress, sitting and a throw in flight', () => {
    const report = expectRoundtrip(
      () => lifeWorld(meadow(20, 20)),
      (w) => {
        w.spawn(10, 10);
        w.seat(11, 10);
        w.run(1, [{ type: 'inventory.give', item: 'apfel', count: 2 }]);
        w.run(1, [{ type: 'inventory.give', item: 'stein', count: 2 }]);
        const p = w.pos();
        w.run(1, [{ type: 'action.throw', from: { bereich: 'inventar', index: 1 }, x: p.x + 6 * T, y: p.y }]);
        w.run(1, [{ type: 'action.sit', ...w.tile(11, 10) }]);
        w.run(1, [{ type: 'action.eat', from: { bereich: 'inventar', index: 0 } }]);
        w.run(10);
      },
      (w) => w.sim.participant('actions'),
    );
    expect(report.id).toBe('actions');
    const data = JSON.parse(report.canonical) as { actions: { consumption: { kind: string; item: string; ticksLeft: number }; seat: unknown; throws: Array<{ stack: { item: string } }> } };
    expect(data.actions.consumption).toMatchObject({ kind: 'essen', item: 'apfel' });
    expect(data.actions.seat).not.toBeNull();
    expect(data.actions.throws.map((t) => t.stack.item)).toEqual(['stein']);
  });

  it('malformed snapshots are refused', () => {
    const p = lifeWorld(meadow(4, 4)).sim.participant('actions');
    expect(p.serialize()).toEqual({ entity: NULL_ENTITY, actions: { consumption: null, seat: null, throws: [] } });
    const eating = { kind: 'essen', item: null, from: null, water: 'fluss', biome: null, ticksLeft: 5, totalTicks: 90 };
    expect(() => p.deserialize({ entity: 0, actions: { consumption: eating, seat: null, throws: [] } })).toThrow(TypeError);
    expect(() => p.deserialize({ entity: NULL_ENTITY, actions: { consumption: null, seat: { x: 1, y: 1, layer: 0 }, throws: [] } })).toThrow(TypeError);
  });
});
