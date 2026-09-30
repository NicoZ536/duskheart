/**
 * Save roundtrip of the participant `traps` (M6-30, docs/SPIEL.md §15): an armed trap with its next frozen attempt and a
 * trap holding its catch survive save → load, and a loaded world catches exactly like the one that was never saved.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import type { ChunkData } from '../../../../src/world/model/chunk';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { kreaturWelt, meadow, tileOf, type KreaturWelt } from '../../game/kreatur-testwelt';

const HOTBAR = { bereich: 'schnellleiste', index: 0 } as const;

function world(): KreaturWelt {
  return kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
}

/** A box trap with a hare in it, a snare armed in a chunk that froze (its next attempt drawn). */
function set(w: KreaturWelt): void {
  const { tx, ty } = tileOf(w.pos());
  w.hold('kastenfalle');
  w.run(1, [{ type: 'trap.place', from: HOTBAR, tx: tx + 1, ty }]);
  w.hold('schlinge');
  w.run(1, [{ type: 'trap.place', from: HOTBAR, tx, ty: ty + 1 }]);
  const box = w.traps.traps[0];
  w.traps.spring(w.sim, box?.id ?? 0, 'hase', w.sim.tick);
  w.creatures.zoneListener.onDeactivate(w.chunks.get(0, tx >> 5, (ty + 1) >> 5) as ChunkData, w.sim.tick);
  w.run(2);
}

describe('save roundtrip: traps', () => {
  it('restores armed and full traps with their frozen attempts', () => {
    const report = expectRoundtrip(world, set, (w) => w.traps.save);
    expect(report.id).toBe('traps');
    const data = JSON.parse(report.canonical) as { traps: { item: string; caught: string | null; catchTick: number }[] };
    expect(data.traps.map((t) => [t.item, t.caught])).toEqual([
      ['kastenfalle', 'hase'],
      ['schlinge', null],
    ]);
    expect(data.traps[1]?.catchTick).toBeGreaterThan(0);
  });

  it('save → load → continue: E takes the full trap and leaves the same carcass', () => {
    const a = world();
    set(a);
    const b = world();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    const take = [{ type: 'trap.take' as const, trap: a.traps.traps[0]?.id ?? 0 }];
    a.run(30, take);
    b.run(30, take);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    expect(a.creatures.carcasses.size).toBe(1);
  });

  it('the game simulation has the participant (empty at the start)', () => {
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('traps').serialize()).toEqual({ nextId: 1, traps: [] });
  });

  it('rejects malformed snapshots, unknown traps and creatures, two traps on a tile', () => {
    const w = world();
    set(w);
    const good = w.traps.save.serialize() as { nextId: number; traps: Record<string, unknown>[] };
    const first = good.traps[0] as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      { nextId: 0, traps: [] },
      { ...good, traps: [{ ...first, item: 'probe_schwert' }] },
      { ...good, traps: [{ ...first, caught: 'gibtsnicht' }] },
      { ...good, traps: [first, { ...first, id: 2 }] },
      { ...good, traps: [{ ...first, id: good.nextId }] },
      { ...good, traps: [{ ...first, extra: 1 }] },
    ];
    for (const data of bad) expect(() => w.traps.save.deserialize(data), JSON.stringify(data)).toThrow(TypeError);
    expect(w.traps.save.serialize()).toEqual(good);
  });
});
