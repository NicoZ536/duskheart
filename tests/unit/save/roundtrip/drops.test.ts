/**
 * Save roundtrip of the participant `drops` (M3-10): dropped stacks in flight and on the ground – with
 * their flight, settle time, lifetime and magnet state – survive save → load, and a loaded world keeps
 * flying, pulling and collecting them exactly like the one that was never saved.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { newStack } from '../../../../src/game/items/stack';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { centre, field, gatherCatalog, gatherWorld, type GatherWorld } from '../../game/interaktion-testwelt';

const catalog = gatherCatalog();

/** A world with a flying drop, a landed one in the magnet and a spear out of reach of the magnet. */
function scatter(w: GatherWorld): void {
  w.place(5, 5);
  const c = centre(5, 5);
  const flint = w.drops.spawn(w.sim, newStack(catalog.get('feuerstein'), 3), 0, c.x + 22, c.y, c.x + 22, c.y);
  w.drops.spawn(w.sim, newStack(catalog.get('probe_speer'), 1), 0, c.x - 40, c.y, c.x - 40, c.y);
  // The flint lands, settles and the magnet starts to pull it.
  w.runUntil(() => w.drops.get(flint)?.pulled === true, 120);
  w.drops.spawn(w.sim, newStack(catalog.get('himbeeren'), 2, { frische: 70 }), 0, c.x, c.y - 30);
  w.run(1);
}

describe('save roundtrip: drops', () => {
  it('restores flying and resting drops with their state', () => {
    const report = expectRoundtrip(
      () => gatherWorld(field(12, 12)),
      scatter,
      (w) => w.drops.save,
    );
    expect(report.id).toBe('drops');
    const data = JSON.parse(report.canonical) as { drops: { entity: number; drop: { stack: { item: string }; pulled: boolean; flightTicks: number; flightTotal: number } }[] };
    expect(data.drops.map((d) => d.drop.stack.item)).toEqual(['feuerstein', 'probe_speer', 'himbeeren']);
    expect(data.drops[0]?.drop.pulled).toBe(true);
    expect(data.drops[2]?.drop.flightTicks).toBeLessThan(data.drops[2]?.drop.flightTotal ?? 0);
  });

  it('the game simulation has the participant; an empty world saves no drops', () => {
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('drops').serialize()).toEqual({ drops: [] });
  });

  it('save → load → continue collects the same way as an uninterrupted run', () => {
    const a = gatherWorld(field(12, 12));
    scatter(a);
    const b = gatherWorld(field(12, 12));
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    a.run(90);
    b.run(90);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    expect(b.inventory.count('feuerstein')).toBe(3);
  });

  it('rejects malformed snapshots and unknown items', () => {
    const w = gatherWorld(field(8, 8));
    scatter(w);
    const good = w.drops.save.serialize() as { drops: { entity: number; drop: Record<string, unknown> }[] };
    const first = good.drops[0] as { entity: number; drop: Record<string, unknown> };
    const bad: unknown[] = [
      null,
      { drops: 1 },
      { drops: [{ entity: -5, drop: first.drop }] },
      { drops: [{ entity: first.entity, drop: { ...first.drop, stack: { item: 'gibtsnicht', count: 1 } } }] },
      { drops: [{ entity: first.entity, drop: { ...first.drop, flightTicks: 99, flightTotal: 3 } }] },
      { drops: [{ entity: first.entity, drop: { ...first.drop, extra: true } }] },
    ];
    for (const data of bad) expect(() => w.drops.save.deserialize(data), JSON.stringify(data)).toThrow(TypeError);
    expect(w.drops.save.serialize()).toEqual(good);
  });
});
