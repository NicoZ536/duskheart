/**
 * Save roundtrip of the participant `combat` (M6, docs/SPIEL.md §15 "combat (Kampfzustand des Spielers, Projektile im
 * Flug)"): the attack in progress (phase, clock, held button, combo), the block and its parry window, hitstop, stagger,
 * knockback, broken armour, a loaded crossbow bolt, parry marks, projectiles in flight – with the piece they carry – and the
 * glowing arrows' lights survive save → load, and a loaded world fights on exactly like the one that was never saved.
 *
 * M6-36: a creature's shot in flight (the Speier's glob, M6-15b – no item but a shot registered by the creatures) is saved
 * by its id like ammunition; loaded, it flies on and hits the player at the same tick with the same poison; a world that
 * does not know the shot rejects it. A shot a roll already went through (`dodged`, M6-40) keeps the mark: loaded, the same
 * roll grants no second dodge; a save from before M6-40 reads the mark as unset.
 */
import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../../src/engine/ecs';
import { createSimulation } from '../../../../src/game/setup';
import { COMBAT_XP } from '../../../../src/game/combat/system';
import { combatSnapshotSchema } from '../../../../src/game/combat/state';
import type { SimEventMap } from '../../../../src/game/sim';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { eventsOf, kampfWelt, type KampfWelt } from '../../game/kampf-testwelt';
import { kreaturWelt, meadow, type KreaturWelt } from '../../game/kreatur-testwelt';

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

/** A dark night: the shadow brood is awake and the Speier does not shy the player's surroundings. */
function night(): KreaturWelt {
  const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
  w.cenv.phase = 'nacht';
  w.light.ambient = 0.05;
  return w;
}

/** A Speier five tiles north of the player (a new creature faces south: it sees the player), until its glob flies. */
function spit(w: KreaturWelt): Entity {
  const e = w.creature('speier', 20, 10);
  for (let i = 0; i < 20 * 60; i++) {
    const fired = eventsOf<SimEventMap['projectileFired']>(w.run(1), 'projectileFired').find((f) => f.owner === e);
    if (fired !== undefined) return e;
  }
  throw new Error('the Speier never spat');
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
  it('M6-36: restores a creature shot in flight by its id; loaded, it hits at the same tick with the same poison', () => {
    const report = expectRoundtrip(night, (w) => void spit(w), (w) => w.combat.save);
    const data = JSON.parse(report.canonical) as { projectiles: { item: string; carried: unknown; team: number }[] };
    expect(data.projectiles.map((p) => [p.item, p.carried])).toEqual([['geschoss_spucken', null]]);
    const a = night();
    spit(a);
    const b = night();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    const hitsOf = (w: KreaturWelt): SimEventMap['projectileHit'][] => {
      const out: SimEventMap['projectileHit'][] = [];
      for (let i = 0; i < 60; i++) out.push(...eventsOf<SimEventMap['projectileHit']>(w.run(1), 'projectileHit'));
      return out;
    };
    const ha = hitsOf(a);
    const hb = hitsOf(b);
    expect(ha.filter((h) => h.item === 'geschoss_spucken' && h.target === a.sim.player)).toHaveLength(1);
    expect(hb).toEqual(ha);
    expect(b.vit().health).toBe(a.vit().health);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
  });

  it('M6-36: a world that does not know the creature shot rejects it', () => {
    const w = night();
    spit(w);
    const data = w.combat.save.serialize();
    // The combat world without the creatures registered no shots.
    expect(() => kampfWelt().combat.save.deserialize(structuredClone(data))).toThrow(/unknown projectile item "geschoss_spucken"/);
  });

  it('M6-36: a shot a roll went through keeps its mark (M6-40) – loaded, the roll grants no second dodge', () => {
    const report = expectRoundtrip(shotWorld, dodge, (k) => k.combat.save);
    const data = JSON.parse(report.canonical) as { projectiles: { item: string; dodged?: boolean }[] };
    expect(data.projectiles.map((p) => [p.item, p.dodged])).toEqual([['geschoss_spucken', true]]);
    // Loaded into another world, it flies on marked: rolling on through it gives nothing more.
    const a = shotWorld();
    dodge(a);
    const b = shotWorld();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    const xp = (k: KampfWelt): number => {
      let n = 0;
      for (let i = 0; i < 20; i++) n += eventsOf<{ source: string }>(k.run(1), 'xpGained').filter((x) => x.source === COMBAT_XP.dodge).length;
      return n;
    };
    expect(xp(b)).toBe(0);
    expect(xp(a)).toBe(0);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    // A save from before M6-40 has no mark: it reads as not dodged.
    const old = { ...data, projectiles: data.projectiles.map(({ dodged: _d, ...rest }) => rest) };
    expect(combatSnapshotSchema.parse(old).projectiles.every((p) => !p.dodged)).toBe(true);
  });
});

/** The combat world with the Speier's glob registered as a shot (as the creatures register theirs in the game). */
function shotWorld(): KampfWelt {
  const k = kampfWelt(meadow(40, 20), { x: 20, y: 10 });
  k.combat.addShot('geschoss_spucken', null);
  return k;
}

/**
 * A slow glob shot at the player from five tiles east; the player rolls into it (as in tests/unit/game/fernkampf.test.ts):
 * the roll carries it through the shot – one dodge, its experience – and the shot flies on, marked.
 */
function dodge(k: KampfWelt): void {
  const foe = k.dummy(80, 0, { team: 'feind' });
  k.combat.fireShot(k.sim, { owner: foe.entity, team: 'feind', klasse: 'wurf', item: 'geschoss_spucken', layer: 0, level: 0, x: foe.x, y: foe.y, dirX: -1, dirY: 0, tension: 1, speed: 150, range: 160, damage: 10, art: 'gift', wucht: 1, staggerSeconds: 0, arc: false, aiming: false, carried: null }, k.sim.tick);
  let xp = 0;
  for (let i = 0; i < 40 && xp === 0; i++) xp += eventsOf<{ source: string }>(k.run(1, i === 16 ? [{ type: 'player.roll', dx: 1, dy: 0 }] : undefined), 'xpGained').filter((x) => x.source === COMBAT_XP.dodge).length;
  if (xp !== 1 || k.combat.projectiles.size !== 1) throw new Error(`the roll did not go through the shot (${xp} dodges, ${k.combat.projectiles.size} shots)`);
}

