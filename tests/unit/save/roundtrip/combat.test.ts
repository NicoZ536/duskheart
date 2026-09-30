/**
 * Save roundtrip of the participant `combat` (M6, docs/SPIEL.md §15 "combat (Kampfzustand des Spielers, Projektile im
 * Flug)"): the attack in progress (phase, clock, held button, combo), the block and its parry window, hitstop, stagger,
 * knockback, broken armour, a loaded crossbow bolt, parry marks, projectiles in flight – with the piece they carry – and the
 * glowing arrows' lights survive save → load, and a loaded world fights on exactly like the one that was never saved.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { kampfWelt, type KampfWelt } from '../../game/kampf-testwelt';

/**
 * A fight in full swing: a glowing arrow stuck in the ground, a parry mark on a foe, broken armour, a throwing knife and an
 * arrow in flight, a loaded crossbow bolt, the bow recovering from its shot with the block (aim) raised.
 */
function brawl(k: KampfWelt): void {
  k.aimBy(0, 200);
  k.hold('probe_bogen');
  k.pack('probe_pfeil_leucht', 1);
  k.run(48, [{ type: 'combat.attack', on: true }]);
  k.run(1, [{ type: 'combat.attack', on: false }]);
  for (let i = 0; i < 120 && k.combat.projectiles.size > 0; i++) k.run(1);
  k.run(40);
  // A parry (with the club: a bow only aims) marks a foe; another blow breaks the player's armour.
  k.hold('probe_keule');
  const foe = k.dummy(12, 0, { health: 500, maxHealth: 500 });
  k.aimBy(30, 0);
  k.run(1, [{ type: 'combat.block', on: true }]);
  k.strikePlayer(foe);
  k.run(1, [{ type: 'combat.block', on: false }]);
  k.strikePlayer(foe, { armorBreak: 6, armorBreakSeconds: 30, critChance: 0, damage: 1 });
  k.run(5);
  // A throwing knife flung at once (slow, it flies a while), then an arrow let go half drawn once the arm recovered.
  k.aimBy(-200, 0);
  k.hold('probe_wurfmesser', 2);
  k.run(1, [{ type: 'combat.attack', on: true }]);
  k.run(1, [{ type: 'combat.attack', on: false }]);
  for (let i = 0; i < 60 && k.combat.state.player.phase !== 'bereit'; i++) k.run(1);
  k.hold('probe_bogen');
  k.pack('probe_pfeil', 3);
  k.run(1, [{ type: 'combat.attack', on: true }, { type: 'combat.block', on: true }]);
  k.run(1, [{ type: 'combat.attack', on: false }]);
  k.combat.state.player.loaded = 'probe_bolzen';
  k.run(1);
}

describe('save roundtrip: combat', () => {
  it('restores the fight in progress and the projectiles in flight', () => {
    const report = expectRoundtrip(
      () => kampfWelt(),
      brawl,
      (k) => k.combat.save,
    );
    expect(report.id).toBe('combat');
    const data = JSON.parse(report.canonical) as {
      player: { phase: string; blockHeld: boolean; loaded: string; armorBreak: number };
      marks: unknown[];
      glows: unknown[];
      projectiles: { item: string; carried: { item: string } | null }[];
    };
    expect(data.player).toMatchObject({ phase: 'erholung', loaded: 'probe_bolzen', armorBreak: 6, blockHeld: true });
    expect(data.marks).toHaveLength(1);
    expect(data.glows).toHaveLength(1);
    expect(data.projectiles.map((p) => [p.item, p.carried?.item ?? null])).toEqual([
      ['probe_wurfmesser', 'probe_wurfmesser'],
      ['probe_pfeil', null],
    ]);
  });

  it('the game simulation has the participant; a fresh world has no fight, and a save from before M6 migrates to it', () => {
    const sim = createSimulation({ seed: 3 });
    const p = sim.participant('combat');
    const fresh = p.serialize();
    expect(fresh).toMatchObject({ player: { phase: 'bereit' }, projectiles: [], glows: [], marks: [] });
    expect(p.migrations?.find((m) => m.from === 0)?.migrate(undefined)).toEqual(fresh);
  });

  it('save → load → continue fights on like an uninterrupted run', () => {
    const a = kampfWelt();
    brawl(a);
    const b = kampfWelt();
    b.dummies.list.push(...a.dummies.list.map((d) => ({ ...d, hits: [...d.hits] })));
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    b.aim = a.aim === null ? null : { ...a.aim };
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    a.run(90, [{ type: 'combat.attack', on: false }]);
    b.run(90, [{ type: 'combat.attack', on: false }]);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    expect(b.dummies.list.map((d) => d.health)).toEqual(a.dummies.list.map((d) => d.health));
    expect(b.combat.projectiles.size).toBe(a.combat.projectiles.size);
  });

  it('rejects malformed snapshots and unknown items', () => {
    const k = kampfWelt();
    brawl(k);
    const good = k.combat.save.serialize() as { player: Record<string, unknown>; projectiles: Record<string, unknown>[] };
    const first = good.projectiles[0] as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      { ...good, player: { ...good.player, phase: 'tanzen' } },
      { ...good, player: { ...good.player, loaded: 'gibtsnicht' } },
      { ...good, projectiles: [{ ...first, item: 'gibtsnicht' }] },
      { ...good, projectiles: [{ ...first, art: 99 }] },
      { ...good, projectiles: [{ ...first, entity: -5 }] },
      { ...good, extra: true },
    ];
    for (const data of bad) expect(() => k.combat.save.deserialize(data), JSON.stringify(data).slice(0, 80)).toThrow(TypeError);
    expect(k.combat.save.serialize()).toEqual(good);
  });
});
