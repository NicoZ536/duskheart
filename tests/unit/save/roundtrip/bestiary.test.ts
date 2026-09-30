/**
 * Save roundtrip of the participant `bestiary` (M6-32, docs/SPIEL.md §15 "Bestiarium-Fortschritt"): what the player saw and
 * defeated survives save → load, and a loaded world opens the next stage exactly when the uninterrupted one does.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { kreaturWelt, meadow, type KreaturWelt } from '../../game/kreatur-testwelt';

function world(): KreaturWelt {
  return kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
}

/** A deer watched for a while, two hares defeated. */
function watch(w: KreaturWelt): void {
  const deer = w.creature('reh', 24, 15);
  w.state(deer).stateUntilTick = w.sim.tick + 600;
  w.run(100);
  for (let i = 0; i < 2; i++) {
    w.creature('hase', 21, 13);
    w.run(1, [{ type: 'creature.kill', radius: 3 }]);
  }
}

describe('save roundtrip: bestiary', () => {
  it('restores sight time, sightings and defeats', () => {
    const report = expectRoundtrip(world, watch, (w) => w.bestiary.save);
    expect(report.id).toBe('bestiary');
    const data = JSON.parse(report.canonical) as { entries: { creature: string; seenTicks: number; kills: number }[] };
    expect(data.entries.find((e) => e.creature === 'hase')?.kills).toBe(2);
    expect(data.entries.find((e) => e.creature === 'reh')?.seenTicks).toBeGreaterThan(0);
  });

  it('save → load → continue opens the next stages like an uninterrupted run', () => {
    const a = world();
    watch(a);
    const b = world();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    a.run(200);
    b.run(200);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    expect(b.bestiary.stages('reh').gesichtet).toBe(true);
  });

  it('the game simulation has the participant (empty at the start)', () => {
    expect(createSimulation({ seed: 3 }).participant('bestiary').serialize()).toEqual({ entries: [] });
  });

  it('rejects malformed snapshots and unknown creatures', () => {
    const w = world();
    watch(w);
    const good = w.bestiary.save.serialize() as { entries: Record<string, unknown>[] };
    const bad: unknown[] = [null, { entries: [{ creature: 'gibtsnicht', seenTicks: 0, sighted: false, kills: 1 }] }, { entries: [{ ...(good.entries[0] as Record<string, unknown>), kills: -1 }] }, { entries: [good.entries[0], good.entries[0]] }];
    for (const data of bad) expect(() => w.bestiary.save.deserialize(data), JSON.stringify(data)).toThrow(TypeError);
    expect(w.bestiary.save.serialize()).toEqual(good);
  });
});
