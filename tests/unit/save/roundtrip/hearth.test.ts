/**
 * Save roundtrip of the participant `hearth` (M4-20): hearths – anchor, footprint, lit, the piece burning now and its
 * size, the fuel store, the ember cores, the timestamp – survive save → load; a loaded world burns on like the
 * uninterrupted one, and a frozen hearth catches up alike after loading.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { CHUNK_SHIFT } from '../../../../src/world/model/coords';
import { lagerWelt, type LagerWelt } from '../../game/lager-testwelt';
import { meadow } from '../../game/spieler-testwelt';

function world(): LagerWelt {
  return lagerWelt(meadow(24, 16), { x: 10, y: 10 });
}

/** A hearth with logs and charcoal in store, a core in its first niche, lit for a while. */
function light(w: LagerWelt): void {
  w.build('herdfeuer', 12, 9);
  const id = w.hearth.hearths[0]?.id ?? 0;
  for (const [item, n] of [['holz', 3], ['holzkohle', 2], ['glutkern_1', 1]] as const) w.give(item, n);
  w.act({ type: 'hearth.fuel', hearth: id, from: w.slotOf('holz') });
  w.act({ type: 'hearth.fuel', hearth: id, from: w.slotOf('holzkohle') });
  w.act({ type: 'hearth.core', hearth: id, from: w.slotOf('glutkern_1') });
  w.act({ type: 'hearth.ignite', hearth: id });
  w.run(1234);
}

describe('save roundtrip: hearth', () => {
  it('restores hearths, fuel, cores and the fire burning now', () => {
    const report = expectRoundtrip(world, light, (w) => w.hearth.save);
    expect(report.id).toBe('hearth');
    const data = JSON.parse(report.canonical) as { hearths: Array<{ lit: boolean; rest: number; voll: number; vorrat: Array<{ item: string; count: number }>; kerne: Array<string | null> }>; nextId: number };
    expect(data.hearths).toHaveLength(1);
    expect(data.hearths[0]).toMatchObject({ lit: true, vorrat: [{ item: 'holz', count: 2 }, { item: 'holzkohle', count: 2 }], kerne: ['glutkern_1', null, null, null, null, null] });
    expect(data.hearths[0]?.rest).toBeGreaterThan(0);
    expect(data.nextId).toBe(2);
  });

  it('the game simulation has the participant (no hearths), with the migration from saves without hearths', () => {
    const p = createSimulation({ seed: 3 }).participant('hearth');
    expect(p.serialize()).toEqual({ hearths: [], nextId: 1 });
    expect(p.migrations?.[0]?.migrate(undefined)).toEqual({ hearths: [], nextId: 1 });
  });

  it('save → load → continue burns alike; a frozen hearth catches up alike after loading', () => {
    const a = world();
    light(a);
    const b = world();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    const hour = a.sim.clock.ticksPerGameHour;
    const ea = a.run(2 * hour);
    const eb = b.run(2 * hour);
    expect(b.hearth.save.serialize()).toEqual(a.hearth.save.serialize());
    expect(eb.get('hearthOut')).toEqual(ea.get('hearthOut'));
    const c = world();
    for (const p of a.sim.participants()) c.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    c.active = false;
    const from = c.sim.tick;
    c.run(3 * hour);
    a.run(3 * hour);
    const h = c.hearth.hearths[0];
    if (h === undefined) throw new Error('no hearth');
    c.hearth.catchUp({ layer: 0, cx: h.tx >> CHUNK_SHIFT, cy: h.ty >> CHUNK_SHIFT }, from, c.sim.tick);
    expect(c.hearth.save.serialize()).toEqual(a.hearth.save.serialize());
  });

  it('rejects malformed snapshots, foreign fuel, cores in the wrong niche and more than three hearths', () => {
    const w = world();
    light(w);
    const good = w.hearth.save.serialize() as { hearths: Array<Record<string, unknown>>; nextId: number };
    const h = good.hearths[0] as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      { ...good, nextId: 1 },
      { ...good, hearths: [{ ...h, vorrat: [{ item: 'stein', count: 3 }] }] },
      { ...good, hearths: [{ ...h, vorrat: [{ item: 'holz', count: 41 }] }] },
      { ...good, hearths: [{ ...h, kerne: [null, 'glutkern_1', null, null, null, null] }] },
      { ...good, hearths: [{ ...h, rest: 999_999 }] },
      { ...good, hearths: [1, 2, 3, 4].map((id) => ({ ...h, id })), nextId: 5 },
    ];
    for (const data of bad) expect(() => w.hearth.save.deserialize(data), JSON.stringify(data).slice(0, 80)).toThrow(TypeError);
  });
});
