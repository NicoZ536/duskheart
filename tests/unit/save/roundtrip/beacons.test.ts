/**
 * Save roundtrip of the participant `beacons` (M7-35, docs/SPIEL.md §22, §27): a lit beacon (its lit tick for the healing wave,
 * the vision not yet seen) and one in its ignition sequence survive save → load; the loaded world lights on like the one
 * never saved; saves before M7 load with every beacon dark.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { leuchtfeuerWelt, SITE, type LeuchtfeuerWelt } from '../../game/leuchtfeuer-testwelt';

function world(): LeuchtfeuerWelt {
  return leuchtfeuerWelt();
}

/** The guardian falls, the ignition runs halfway. */
function igniting(w: LeuchtfeuerWelt): void {
  w.run(1, [{ type: 'boss.debug', boss: 'borkenvater', aktion: 'besiegen' }]);
  w.run(1);
  w.goTo(SITE.x, SITE.y + 2);
  w.run(3 * 60, [{ type: 'beacon.ignite', beacon: 1 }]);
}

describe('save roundtrip: beacons', () => {
  it('restores a beacon in its ignition and a lit one', () => {
    const report = expectRoundtrip(world, igniting, (w) => w.beacons.save);
    expect(report.id).toBe('beacons');
    const data = JSON.parse(report.canonical) as { beacons: { nummer: number; state: string }[] };
    expect(data.beacons.map((b) => b.state)).toEqual(['entzuendung', 'erloschen', 'erloschen', 'erloschen', 'erloschen', 'erloschen']);
    const lit = expectRoundtrip(world, (w) => w.run(1, [{ type: 'beacon.debug', beacon: 1, aktion: 'entzuenden' }]), (w) => w.beacons.save);
    expect((JSON.parse(lit.canonical) as { beacons: { state: string; visionShown: boolean }[] }).beacons[0]).toMatchObject({ state: 'entzuendet', visionShown: false });
  });

  it('save → load → continue: the flame stands at the same tick, the unlocks follow', () => {
    const a = world();
    igniting(a);
    const b = world();
    b.run(1);
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    a.run(4 * 60);
    b.run(4 * 60);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    expect(b.beacons.state(1).state).toBe('entzuendet');
    expect(b.unlocks.has('lf1_lumen_werkbank')).toBe(true);
  });

  it('the game simulation has the participant (all dark); saves before M7 migrate; malformed snapshots are refused', () => {
    const sim = createSimulation({ seed: 3 });
    const data = sim.participant('beacons').serialize() as { beacons: { state: string }[] };
    expect(data.beacons.map((b) => b.state)).toEqual(Array(6).fill('erloschen'));
    expect(sim.participant('beacons').migrations?.find((m) => m.from === 0)?.migrate(undefined)).toEqual(data);
    const w = world();
    expect(() => w.beacons.save.deserialize({ beacons: [] })).toThrow(/beacons snapshot invalid/);
    expect(() => w.beacons.save.deserialize({ beacons: 3 })).toThrow(/beacons snapshot invalid/);
  });
});
