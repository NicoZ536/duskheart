/**
 * Save roundtrip of the participant `fire` (M4-28): burning tiles – where, since when, how far they burned, their
 * spread plans and the trees on them – and the recorded climate survive save → load; a loaded world burns on like the
 * uninterrupted one, a frozen fire catches up alike after loading.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { CHUNK_SHIFT } from '../../../../src/world/model/coords';
import { lagerWelt, type LagerWelt } from '../../game/lager-testwelt';
import { OFFSET, meadow } from '../../game/spieler-testwelt';

function world(): LagerWelt {
  const rows = meadow(24, 16);
  rows[10] = '..........T' + rows[10]?.slice(11);
  return lagerWelt(rows, { x: 4, y: 12 });
}

/** A row of wooden walls beside a birch, set alight in a breeze. */
function burn(w: LagerWelt): void {
  for (let x = 6; x <= 9; x++) w.build('wand_holz', x, 10);
  w.climate.wind = 0.6;
  w.climate.dir = 2;
  w.act({ type: 'fire.ignite', tx: OFFSET + 6, ty: OFFSET + 10 });
  w.run(20 * 60 + 13);
}

describe('save roundtrip: fire', () => {
  it('restores the burning tiles, their plans and the climate runs', () => {
    const report = expectRoundtrip(world, burn, (w) => w.feuer.save);
    expect(report.id).toBe('fire');
    const data = JSON.parse(report.canonical) as { cells: Array<{ tx: number; plan: number[] | null }>; klima: Array<[number, number[]]> };
    expect(data.cells.map((c) => c.tx - OFFSET)).toEqual([6, 7, 8, 9]);
    expect(data.cells.every((c) => c.plan !== null)).toBe(true);
    expect(data.klima).toHaveLength(1);
  });

  it('the game simulation has the participant (nothing burns), with the migration from saves without fire', () => {
    const p = createSimulation({ seed: 3 }).participant('fire');
    expect(p.serialize()).toEqual({ cells: [], klima: [] });
    expect(p.migrations?.[0]?.migrate(undefined)).toEqual({ cells: [], klima: [] });
  });

  it('save → load → continue burns alike; frozen after loading it catches up alike', () => {
    const a = world();
    burn(a);
    const b = world();
    b.climate.wind = a.climate.wind;
    b.climate.dir = a.climate.dir;
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    const ea = a.run(40 * 60);
    const eb = b.run(40 * 60);
    expect(eb.get('fireStarted')).toEqual(ea.get('fireStarted'));
    expect(b.feuer.save.serialize()).toEqual(a.feuer.save.serialize());
    expect(b.building.save.serialize()).toEqual(a.building.save.serialize());
    const c = world();
    c.climate.wind = a.climate.wind;
    c.climate.dir = a.climate.dir;
    for (const p of a.sim.participants()) c.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    c.active = false;
    const from = c.sim.tick;
    c.run(30 * 60);
    a.run(30 * 60);
    c.feuer.catchUp({ layer: 0, cx: (OFFSET + 6) >> CHUNK_SHIFT, cy: (OFFSET + 10) >> CHUNK_SHIFT }, from, c.sim.tick);
    expect(c.feuer.save.serialize()).toEqual(a.feuer.save.serialize());
    expect(c.building.save.serialize()).toEqual(a.building.save.serialize());
  });

  it('rejects malformed snapshots, tiles burning twice, spreading before catching fire, unordered climate', () => {
    const w = world();
    burn(w);
    const good = w.feuer.save.serialize() as { cells: Array<Record<string, unknown>>; klima: Array<[number, number[]]> };
    const cell = good.cells[0] as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      { ...good, cells: [cell, cell] },
      { ...good, cells: [{ ...cell, bis: 0, seit: 5 }] },
      { ...good, cells: [{ ...cell, plan: [0, -1, -1, -1, -1, -1, -1, -1] }] },
      { ...good, klima: [[0, [5, 1, 3, 2]]] },
      { ...good, klima: [[0, [5, 1, 7]]] },
    ];
    for (const data of bad) expect(() => w.feuer.save.deserialize(data), JSON.stringify(data).slice(0, 80)).toThrow(TypeError);
  });
});
