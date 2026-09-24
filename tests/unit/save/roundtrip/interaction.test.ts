/**
 * Save roundtrip of the participant `interaction` (M3-10): the aimed point, the held E, the tile a
 * touch tap gave and the running action (target, ticks into it, damage dealt to a tile) survive save →
 * load; a loaded world finishes the action on the same tick as an uninterrupted one.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { centre, field, gatherWorld, type GatherWorld } from '../../game/interaktion-testwelt';

/** Digs half a path: E held, one shovel stroke done. */
function digging(w: GatherWorld): void {
  w.place(4, 4);
  w.body().facing = 'up';
  w.hold('probe_schaufel');
  const aim = centre(4, 3);
  w.run(1, [{ type: 'player.aim', x: aim.x, y: aim.y }]);
  w.run(25, [{ type: 'player.interact', on: true }]);
}

describe('save roundtrip: interaction', () => {
  it('restores aim, held E and the running action with its tile damage', () => {
    const report = expectRoundtrip(
      () => gatherWorld(field(10, 10)),
      digging,
      (w) => w.interaction.save,
    );
    expect(report.id).toBe('interaction');
    const data = JSON.parse(report.canonical) as { held: boolean; aim: unknown; action: { kind: string; target: string; name: string; ticks: number; damage: number } };
    expect(data.held).toBe(true);
    expect(data.aim).not.toBeNull();
    expect(data.action).toMatchObject({ kind: 'tile', target: 'gras', name: 'graben', byHand: false, ticks: 24, damage: 1 });
  });

  it('the game simulation has the participant (idle)', () => {
    expect(createSimulation({ seed: 3 }).participant('interaction').serialize()).toEqual({ aim: null, held: false, explicit: null, attempted: false, done: null, action: null });
  });

  it('save → load → continue finishes the path on the same tick', () => {
    const a = gatherWorld(field(10, 10));
    digging(a);
    const b = gatherWorld(field(10, 10));
    for (const [key, chunk] of a.chunks.map) b.chunks.map.set(key, chunk.clone());
    b.active = [...b.chunks.map.values()];
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    const ea = a.run(60);
    const eb = b.run(60);
    expect(eb.get('tileDug')).toEqual(ea.get('tileDug'));
    expect(ea.get('tileDug')).toHaveLength(1);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
  });

  it('rejects malformed snapshots and unknown targets', () => {
    const w = gatherWorld(field(10, 10));
    digging(w);
    const good = w.interaction.save.serialize() as Record<string, unknown> & { action: Record<string, unknown> };
    const bad: unknown[] = [
      null,
      { ...good, held: 'ja' },
      { ...good, action: { ...good.action, target: 'gibtsnicht' } },
      { ...good, action: { ...good.action, name: 'zaubern' } },
      { ...good, action: { ...good.action, layer: 3 } },
      { ...good, extra: 1 },
    ];
    for (const data of bad) expect(() => w.interaction.save.deserialize(data), JSON.stringify(data)).toThrow(TypeError);
    expect(w.interaction.save.serialize()).toEqual(good);
  });
});
