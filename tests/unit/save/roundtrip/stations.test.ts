/**
 * Save roundtrip of the participant `stations` (M4-03 … M4-06): placed stations – station, position, the id
 * counter – and the processing stations' slots, glowing fuel, batch in progress and timestamp survive save →
 * load; a loaded world produces the same batches on the same ticks as the uninterrupted one, and a frozen
 * station catches up to the same state after loading.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { CHUNK_SHIFT } from '../../../../src/world/model/coords';
import { stationWorld, type StationWorld } from '../../game/stationen-testwelt';

/** A small camp: a workbench, a clay oven firing bricks (fuel glowing, batch half done), a drying rack with straw ready. */
function camp(w: StationWorld): void {
  w.place('werkbank', 6, 1);
  const oven = w.place('lehmofen', 6, 4);
  const rack = w.place('trockengestell', 2, 7);
  w.give('ziegel_roh', 6);
  w.give('holz', 3);
  w.give('fasern', 6);
  w.run(1, [{ type: 'station.put', station: oven, from: w.slotOf('ziegel_roh'), bereich: 'eingang' }]);
  w.run(1, [{ type: 'station.put', station: oven, from: w.slotOf('holz'), bereich: 'brennstoff' }]);
  w.run(1, [{ type: 'station.put', station: rack, from: w.slotOf('fasern'), bereich: 'eingang' }]);
  w.run(90 * 60);
}

describe('save roundtrip: stations', () => {
  it('restores placed stations, their slots, fuel, batches and timestamps', () => {
    const report = expectRoundtrip(stationWorld, camp, (w) => w.stations.save);
    expect(report.id).toBe('stations');
    const data = JSON.parse(report.canonical) as {
      placed: { id: number; station: string; proc: { ausgang: unknown[]; rezept: string | null; glut: number } | null; bis: number }[];
      nextId: number;
    };
    expect(data.placed.map((p) => p.station)).toEqual(['werkbank', 'lehmofen', 'trockengestell']);
    expect(data.nextId).toBe(4);
    expect(data.placed[0]?.proc).toBeNull();
    expect(data.placed[1]?.proc).toMatchObject({ rezept: 'rezept_ziegel', ausgang: [{ item: 'ziegel', count: 2 }, null] });
    expect(data.placed[1]?.proc?.glut).toBeGreaterThan(0);
    expect(data.placed[2]?.proc?.rezept).toBe('rezept_strohbuendel');
  });

  it('the game simulation has the participant (no stations)', () => {
    expect(createSimulation({ seed: 3 }).participant('stations').serialize()).toEqual({ placed: [], nextId: 1 });
  });

  it('save → load → continue produces the same batches on the same ticks; frozen stations catch up alike', () => {
    const a = stationWorld();
    camp(a);
    const b = stationWorld();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    const ea = a.run(120 * 60);
    const eb = b.run(120 * 60);
    expect(eb.get('stationProduced')).toEqual(ea.get('stationProduced'));
    expect(ea.get('stationProduced')?.length).toBeGreaterThan(0);
    expect(b.stations.save.serialize()).toEqual(a.stations.save.serialize());
    // Frozen after loading: catching up gives the ticking state.
    const c = stationWorld();
    for (const p of a.sim.participants()) c.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    const d = stationWorld();
    for (const p of a.sim.participants()) d.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    d.active = false;
    c.run(3000);
    d.sim.skipTicks(3000);
    const from = d.sim.tick - 3000;
    for (const st of d.stations.placed) d.stations.catchUp({ layer: 0, cx: st.tx >> CHUNK_SHIFT, cy: st.ty >> CHUNK_SHIFT }, from, d.sim.tick);
    expect(d.stations.save.serialize()).toEqual(c.stations.save.serialize());
  });

  it('rejects malformed snapshots, unknown stations and items, slots that do not fit the station', () => {
    const w = stationWorld();
    camp(w);
    const good = w.stations.save.serialize() as { placed: Record<string, unknown>[]; nextId: number };
    const oven = good.placed[1] as Record<string, unknown> & { proc: Record<string, unknown> };
    const bad: unknown[] = [
      null,
      { ...good, nextId: 2 },
      { ...good, placed: [...good.placed, good.placed[0]] },
      { ...good, placed: [{ ...good.placed[0], station: 'mondofen' }] },
      { ...good, placed: [{ ...good.placed[0], proc: oven.proc }] },
      { ...good, placed: [{ ...oven, proc: null }] },
      { ...good, placed: [{ ...oven, proc: { ...oven.proc, eingang: [null] } }] },
      { ...good, placed: [{ ...oven, proc: { ...oven.proc, ausgang: [{ item: 'mondstaub', count: 1 }, null] } }] },
      { ...good, placed: [{ ...oven, proc: { ...oven.proc, rezept: 'rezept_strohbuendel' } }] },
      { ...good, placed: [{ ...oven, proc: { ...oven.proc, glut: 999999 } }] },
    ];
    for (const data of bad) expect(() => stationWorld().stations.save.deserialize(data), JSON.stringify(data).slice(0, 120)).toThrow(TypeError);
  });
});
