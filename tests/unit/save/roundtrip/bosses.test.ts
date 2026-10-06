/**
 * Save roundtrip of the participant `bosses` (M7-32, docs/SPIEL.md §22, §27): an awake Borkenvater in phase 2 with its weak
 * points, a running attack and its cooldowns survives save → load and fights on exactly like the one never saved; a defeated
 * boss stays defeated; saves before M7 load with every boss asleep.
 */
import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../../src/engine/ecs';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { ARENA, leuchtfeuerWelt, type LeuchtfeuerWelt } from '../../game/leuchtfeuer-testwelt';

function world(): LeuchtfeuerWelt {
  return leuchtfeuerWelt();
}

/** Awake, in its second phase, the title card over, an attack telegraphed. */
function fight(w: LeuchtfeuerWelt): void {
  w.goTo(ARENA.x, ARENA.y + 4);
  w.run(1, [{ type: 'boss.debug', boss: 'borkenvater', aktion: 'phase', phase: 1 }]);
  w.run(6 * 60);
}

describe('save roundtrip: bosses', () => {
  it('restores an awake boss mid-fight (phase, health, attack, cooldowns, storm, weak points)', () => {
    const report = expectRoundtrip(world, fight, (w) => w.bosses.save);
    expect(report.id).toBe('bosses');
    const data = JSON.parse(report.canonical) as { bosses: { boss: string; state: string; phase: number; weakPoints: Entity[] }[] };
    expect(data.bosses[0]).toMatchObject({ boss: 'borkenvater', state: 'erwacht', phase: 1 });
    expect(data.bosses[0]?.weakPoints).toHaveLength(3);
  });

  it('save → load → continue: the same fight, tick for tick', () => {
    const a = world();
    fight(a);
    const b = world();
    b.run(1);
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    a.run(4 * 60);
    b.run(4 * 60);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    expect(b.bosses.state('borkenvater').health).toBe(a.bosses.state('borkenvater').health);
  });

  it('a defeated boss stays defeated; the game simulation has the participant (every boss asleep at the start); saves before M7 migrate', () => {
    expectRoundtrip(world, (w) => w.run(1, [{ type: 'boss.debug', boss: 'borkenvater', aktion: 'besiegen' }]), (w) => w.bosses.save);
    const sim = createSimulation({ seed: 3 });
    const data = sim.participant('bosses').serialize() as { bosses: { boss: string; state: string; health: number }[] };
    expect(data.bosses.map((b) => [b.boss, b.state, b.health])).toEqual([['borkenvater', 'schlafend', 1600]]);
    const migrate = sim.participant('bosses').migrations?.find((m) => m.from === 0);
    expect(migrate?.migrate(undefined)).toEqual(data);
  });

  it('rejects malformed snapshots and unknown bosses', () => {
    const w = world();
    expect(() => w.bosses.save.deserialize({ bosses: 'x' })).toThrow(/bosses snapshot invalid/);
    const good = w.bosses.save.serialize() as { bosses: Record<string, unknown>[] };
    expect(() => w.bosses.save.deserialize({ bosses: [{ ...good.bosses[0], boss: 'riese' }] })).toThrow(/unknown boss/);
    expect(() => w.bosses.save.deserialize({ bosses: [{ ...good.bosses[0], phase: 7 }] })).toThrow(/phase 7/);
  });
});
