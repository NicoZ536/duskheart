/**
 * Save roundtrip of the participant `storage` (M4-21): placed chests – item, anchor, footprint, slots with their stacks
 * (durability, quality, freshness), name and icon label, the id counter – survive save → load; a loaded world goes on
 * like the uninterrupted one; malformed snapshots, unknown containers and items that a shelf does not take are refused.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { lagerWelt, type LagerWelt } from '../../game/lager-testwelt';
import { OFFSET, meadow } from '../../game/spieler-testwelt';

function world(): LagerWelt {
  return lagerWelt(meadow(24, 16), { x: 10, y: 8 });
}

/** Two chests: a crate with stone, an axe and apples, renamed and labelled; a shelf with logs. */
function fill(w: LagerWelt): void {
  w.build('kiste_holz', 12, 8);
  w.build('lagerregal', 11, 10, 1);
  const [crate, shelf] = w.storage.chests.map((c) => c.id) as [number, number];
  for (const [item, n] of [['stein', 17], ['steinaxt', 1], ['apfel', 3]] as const) {
    w.give(item, n);
    w.act({ type: 'storage.put', chest: crate, from: w.slotOf(item) });
  }
  w.give('holz', 60);
  w.act({ type: 'storage.put', chest: shelf, from: w.slotOf('holz') });
  w.act({ type: 'storage.rename', chest: crate, name: 'Vorrat' });
  w.act({ type: 'storage.label', chest: crate, item: 'apfel' });
}

describe('save roundtrip: storage', () => {
  it('restores chests, their slots, names and labels', () => {
    const report = expectRoundtrip(world, fill, (w) => w.storage.save);
    expect(report.id).toBe('storage');
    const data = JSON.parse(report.canonical) as { chests: Array<{ item: string; w: number; h: number; name: string; label: string | null; slots: Array<{ item: string } | null> }>; nextId: number };
    expect(data.chests.map((c) => [c.item, c.w, c.h, c.name, c.label])).toEqual([
      ['kiste_holz', 1, 1, 'Vorrat', 'apfel'],
      ['lagerregal', 1, 2, '', null],
    ]);
    expect(data.chests[0]?.slots.filter((s) => s !== null).map((s) => s?.item)).toEqual(['stein', 'steinaxt', 'apfel']);
    expect(data.nextId).toBe(3);
  });

  it('the game simulation has the participant (no chests), with the migration from saves without storage', () => {
    const p = createSimulation({ seed: 3 }).participant('storage');
    expect(p.serialize()).toEqual({ chests: [], nextId: 1 });
    expect(p.version).toBe(1);
    expect(p.migrations?.[0]?.migrate(undefined)).toEqual({ chests: [], nextId: 1 });
  });

  it('save → load → continue: the loaded world takes and crafts like the uninterrupted one', () => {
    const a = world();
    fill(a);
    const b = world();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    const crate = a.storage.chests[0]?.id ?? 0;
    for (const w of [a, b]) w.act({ type: 'storage.take', chest: crate, index: 0, count: 5 });
    expect(b.storage.save.serialize()).toEqual(a.storage.save.serialize());
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    expect(b.storage.chestAt(0, OFFSET + 11, OFFSET + 11)?.item).toBe('lagerregal');
  });

  it('rejects malformed snapshots, unknown containers and items, wrong slot counts and what a shelf does not take', () => {
    const w = world();
    fill(w);
    const good = w.storage.save.serialize() as { chests: Array<Record<string, unknown> & { slots: unknown[] }>; nextId: number };
    const crate = good.chests[0] as Record<string, unknown> & { slots: unknown[] };
    const shelf = good.chests[1] as Record<string, unknown> & { slots: unknown[] };
    const bad: unknown[] = [
      null,
      { ...good, nextId: 2 },
      { ...good, chests: [crate, crate] },
      { ...good, chests: [{ ...crate, item: 'goldkiste' }] },
      { ...good, chests: [{ ...crate, slots: crate.slots.slice(1) }] },
      { ...good, chests: [{ ...crate, slots: [{ item: 'mondstein', count: 1 }, ...crate.slots.slice(1)] }] },
      { ...good, chests: [{ ...crate, label: 'mondstein' }] },
      { ...good, chests: [{ ...shelf, slots: [{ item: 'apfel', count: 1, frische: 100 }, ...shelf.slots.slice(1)] }] },
      { ...good, chests: [{ ...crate, slots: [{ item: 'stein', count: 500 }, ...crate.slots.slice(1)] }] },
    ];
    for (const data of bad) expect(() => w.storage.save.deserialize(data), JSON.stringify(data).slice(0, 80)).toThrow(TypeError);
  });
});
