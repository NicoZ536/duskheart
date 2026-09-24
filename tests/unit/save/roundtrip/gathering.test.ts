/**
 * Save roundtrip of the participant `gathering` (M3-11 … M3-14): removed objects waiting to come back
 * (rocks, plants – the tile itself is empty) and trees on their way down (with the drops they will throw)
 * survive save → load; a loaded world lands the tree and regrows the rock exactly like an uninterrupted
 * one. Object states of stumps and bare bushes are chunk data (saved as chunk diffs).
 */
import { describe, expect, it } from 'vitest';
import { chunkHash } from '../../../../src/world/model/chunk';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { field, gatherWorld, type GatherWorld } from '../../game/interaktion-testwelt';

/** Mines a rock (remembered for regrowth), then fells a tree that is still falling. */
function harvest(w: GatherWorld): void {
  w.place(4, 4);
  w.body().facing = 'up';
  w.hold('probe_spitzhacke', 1);
  w.runUntil(() => !w.interaction.working, 400, [{ type: 'player.interact', on: true }]);
  w.run(1, [{ type: 'player.interact', on: false }]);
  w.place(8, 4);
  w.hold('probe_bronzeaxt', 0);
  w.runUntil(() => !w.interaction.working, 400, [{ type: 'player.interact', on: true }]);
  w.run(1, [{ type: 'player.interact', on: false }]);
}

const MAP = ['', '', '', '....R...E'];

describe('save roundtrip: gathering', () => {
  it('restores the regrowth memory and the falling tree', () => {
    const report = expectRoundtrip(
      () => gatherWorld(field(12, 10, MAP)),
      harvest,
      (w) => w.gathering.save,
    );
    expect(report.id).toBe('gathering');
    const data = JSON.parse(report.canonical) as { regrowing: { object: string }[]; falling: { object: string; direction: string; drops: unknown[] }[] };
    expect(data.regrowing.map((r) => r.object)).toEqual(['fels_klein_gruenhain']);
    expect(data.falling).toEqual([expect.objectContaining({ object: 'baum_eiche', direction: 'nord' })]);
    expect(data.falling[0]?.drops.length).toBeGreaterThan(0);
  });

  it('the game simulation has the participant', () => {
    expect(createSimulation({ seed: 3 }).participant('gathering').serialize()).toEqual({ regrowing: [], falling: [] });
  });

  it('save → load → continue lands the tree and regrows the rock as an uninterrupted run', () => {
    const a = gatherWorld(field(12, 10, MAP));
    harvest(a);
    const b = gatherWorld(field(12, 10, MAP));
    for (const [key, chunk] of a.chunks.map) b.chunks.map.set(key, chunk.clone());
    b.active = [...b.chunks.map.values()];
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    for (const w of [a, b]) {
      w.run(120);
      w.sim.skipTicks(8 * w.sim.clock.ticksPerDay);
      w.run(60);
    }
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    expect(b.objectAt(4, 3)).toBe('fels_klein_gruenhain');
    expect(chunkHash(b.at(4, 3).chunk)).toBe(chunkHash(a.at(4, 3).chunk));
  });

  it('rejects malformed snapshots, unknown objects and items', () => {
    const w = gatherWorld(field(12, 10, MAP));
    harvest(w);
    const good = w.gathering.save.serialize() as { regrowing: Record<string, unknown>[]; falling: Record<string, unknown>[] };
    const r = good.regrowing[0] as Record<string, unknown>;
    const f = good.falling[0] as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      { regrowing: [] },
      { regrowing: [{ ...r, object: 'gibtsnicht' }], falling: [] },
      { regrowing: [{ ...r, layer: 7 }], falling: [] },
      { regrowing: [{ ...r, i: 5000 }], falling: [] },
      { regrowing: [], falling: [{ ...f, direction: 'oben' }] },
      { regrowing: [], falling: [{ ...f, drops: [{ item: 'gibtsnicht', count: 1 }] }] },
    ];
    for (const data of bad) expect(() => w.gathering.save.deserialize(data), JSON.stringify(data)).toThrow(TypeError);
    expect(w.gathering.save.serialize()).toEqual(good);
  });
});
