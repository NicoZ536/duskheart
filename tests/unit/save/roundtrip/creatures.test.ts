/**
 * Save roundtrip of the participant `creatures` (M6, docs/SPIEL.md §15 "creatures (aktive Kreaturen samt KI-Zustand,
 * Chunk-Bestände, Kadaver, Nachwachs-Uhren)"): a wolf pack in the middle of its hunt – with pending path requests of the
 * path service –, a deer, a carcass, a frozen chunk's stock and the Nachtmahr survive save → load, in the order they
 * update in, and a loaded world goes on exactly like the one that was never saved.
 *
 * M6-36: the fields the creature waves added after the participant was opened survive as well – camouflage (`hidden`,
 * `tarnTick`: a Dornling waiting as a bush, one a hit woke), a grab in progress (the Kriecher's hold lives in its attack
 * ticks: after loading it still holds the player and lets go at the same tick), a creature's own conditions and the
 * armour an axe broke. (The lights a light eater's blow puts out are the `light` participant's: roundtrip/light.test.ts.)
 * The leash's give-up (`leashed`, M6-13b: a Dornling that let its prey go beyond the leash stays given up after loading and
 * does not hunt it again until it comes well within) and the stronger brood of a Finstermond night (`finster`, M6-27) are
 * written only when set; a save without them reads both as false.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../../src/content/index';
import { NULL_ENTITY, type Entity } from '../../../../src/engine/ecs';
import type { HitResult } from '../../../../src/game/combat/targets';
import { holdingPlayer } from '../../../../src/game/creatures/formulas';
import { createSimulation } from '../../../../src/game/setup';
import type { SimEventMap } from '../../../../src/game/sim';
import type { ChunkData } from '../../../../src/world/model/chunk';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { eventsOf } from '../../game/kampf-testwelt';
import { kreaturWelt, meadow, type KreaturWelt } from '../../game/kreatur-testwelt';
import { BALANCE } from '../../../../src/content/balance';
import { creaturesSnapshotSchema } from '../../../../src/game/creatures/state';
import { TILE_PX } from '../../../../src/world/model/coords';

const HZ = BALANCE.time.tickHz;

/** A world of the roundtrip: night, a dark meadow, the player in god mode. */
function world(): KreaturWelt {
  const w = kreaturWelt(meadow(60, 50), { x: 30, y: 25 });
  w.cheats.god = true;
  w.cenv.phase = 'nacht';
  w.light.ambient = 0.05;
  return w;
}

/** A hunt in full swing, a carcass, a frozen chunk's stock and the Nachtmahr. */
function hunt(w: KreaturWelt): void {
  w.run(1, [{ type: 'creature.spawn', creature: 'probe_wolf', count: 3, x: w.centre(30, 12).x, y: w.centre(30, 12).y, layer: 0 }]);
  w.creature('reh', 45, 40);
  // A hare far off: its chunk freezes and keeps it in its stock.
  const far = w.creature('hase', 90, 25);
  const s = w.state(far);
  w.creatures.zoneListener.onDeactivate(w.chunks.get(0, s.homeCx, s.homeCy) as ChunkData, w.sim.tick);
  // A hare killed next to the player: a carcass.
  w.creature('hase', 31, 26);
  w.run(1, [{ type: 'creature.kill', radius: 2 }]);
  w.run(1, [{ type: 'fear.set', value: 100 }]);
  w.run(95);
}

/** A hit of the player on creature `e` (damage, a condition, broken armour). */
function hitOn(w: KreaturWelt, e: Entity, amount: number, condition: string | null = null, armorBreak = 0): void {
  const hit: HitResult = {
    attacker: w.sim.player,
    attackerTeam: 'spieler',
    amount,
    type: 'hieb',
    crit: false,
    parried: false,
    blocked: false,
    blockStamina: 0,
    knockback: 0,
    dirX: 0,
    dirY: 0,
    hitstopTicks: 0,
    staggerTicks: 0,
    condition,
    conditionSeconds: condition === null ? 0 : 20,
    armorBreak,
    armorBreakSeconds: armorBreak > 0 ? 30 : 0,
  };
  w.creatures.targets.applyHit(w.sim, e, hit);
}

/** The world of the M6 fields: night, the player's torch lit and the grab bound as the game binds it (src/game/setup.ts). */
function night(): KreaturWelt {
  const w = kreaturWelt(meadow(60, 50), { x: 30, y: 25 });
  w.cenv.phase = 'nacht';
  w.light.ambient = 0.05;
  w.light.lit = true;
  w.player.addMotionHold(w.creatures.holdsPlayer);
  return w;
}

const KRIECHER_ATTACKS = CONTENT.collection('creatures').get('kriecher').angriffe;

/**
 * The M6 fields at once: a Dornling hiding as a bush and one a hit woke, a wolf poisoned with broken armour, a light
 * eater near the player, and last a Kriecher whose grab holds the player at the save.
 */
function ambush(w: KreaturWelt): void {
  w.creature('dornling', 50, 40);
  const woken = w.creature('dornling', 8, 40);
  hitOn(w, woken, 2);
  const wolf = w.creature('probe_wolf', 52, 8);
  hitOn(w, wolf, 3, 'vergiftung', 6);
  w.creature('lichtfresser', 30, 21);
  const kriecher = w.creature('kriecher', 30, 24);
  w.cheats.god = false;
  for (let i = 0; i < 20 * 60 && !w.creatures.holdsPlayer(w.sim); i++) w.run(1);
  // A few bites into the hold (its clock runs in the attack ticks).
  w.run(20);
  if (!holdingPlayer(w.state(kriecher), KRIECHER_ATTACKS, w.sim.tick)) throw new Error('the Kriecher holds nobody');
}

describe('save roundtrip: creatures', () => {
  it('restores live creatures, stocks, carcasses, the Nachtmahr and pending paths', () => {
    const report = expectRoundtrip(world, hunt, (w) => w.creatures.save);
    expect(report.id).toBe('creatures');
    const data = JSON.parse(report.canonical) as {
      creatures: { creature: string; state: string; target: number }[];
      chunks: { members: { creature: string }[] }[];
      carcasses: { creature: string }[];
      nightmare: number;
      paths: { pending: unknown[] };
    };
    // The night spawner brought shadow brood as well.
    expect(data.creatures.map((c) => c.creature)).toEqual(expect.arrayContaining(['nachtmahr', 'probe_wolf', 'probe_wolf', 'probe_wolf', 'reh', 'probe_schleicher']));
    expect(data.chunks.flatMap((c) => c.members.map((m) => m.creature))).toEqual(['hase']);
    expect(data.carcasses.map((c) => c.creature)).toEqual(['hase']);
    expect(data.nightmare).not.toBe(NULL_ENTITY);
  });

  it('save → load → continue hunts exactly like an uninterrupted run', () => {
    const a = world();
    hunt(a);
    const b = world();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    for (let i = 0; i < 4; i++) {
      a.run(45);
      b.run(45);
      expect(b.sim.hashState()).toBe(a.sim.hashState());
    }
    expect(a.creatures.paths.stats.admitted).toBeGreaterThan(0);
  });

  it('the game simulation has the participant; a world without a zone saves no creatures', () => {
    const sim = createSimulation({ seed: 3 });
    const data = sim.participant('creatures').serialize() as { creatures: unknown[]; chunks: unknown[] };
    expect(data.creatures).toEqual([]);
    expect(data.chunks).toEqual([]);
    const migrated = sim.participant('creatures').migrations?.find((m) => m.from === 0)?.migrate(undefined);
    expect(() => sim.participant('creatures').deserialize(migrated)).not.toThrow();
  });

  it('rejects malformed snapshots, unknown creatures and entities named twice', () => {
    const w = world();
    hunt(w);
    const good = w.creatures.save.serialize() as { creatures: Record<string, unknown>[]; carcasses: Record<string, unknown>[]; nightmare: number };
    const first = good.creatures[0] as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      { ...good, creatures: 1 },
      { ...good, creatures: [{ ...first, creature: 'gibtsnicht' }] },
      { ...good, creatures: [first, first] },
      { ...good, creatures: [{ ...first, extra: true }] },
      { ...good, creatures: [{ ...first, state: 'tanzen' }] },
      { ...good, nightmare: 424242 },
      { ...good, carcasses: [{ ...(good.carcasses[0] as Record<string, unknown>), creature: 'gibtsnicht' }] },
    ];
    for (const data of bad) expect(() => w.creatures.save.deserialize(data), JSON.stringify(data).slice(0, 200)).toThrow(TypeError);
    expect(w.creatures.save.serialize()).toEqual(good);
  });
  it('M6-36: camouflage, a grab in progress, a creature\'s conditions and broken armour survive save → load', () => {
    const report = expectRoundtrip(night, ambush, (w) => w.creatures.save);
    const data = JSON.parse(report.canonical) as {
      creatures: { creature: string; hidden?: boolean; tarnTick?: number; attackPhase: string; attackTick: number; attackEndTick: number; conditions: { id: string }[]; armorBreak: number }[];
    };
    const dornlings = data.creatures.filter((c) => c.creature === 'dornling');
    expect(dornlings.map((c) => c.hidden ?? false).sort()).toEqual([false, true]);
    expect(dornlings.some((c) => c.hidden !== true && (c.tarnTick ?? -1) >= 0)).toBe(true);
    const wolf = data.creatures.find((c) => c.creature === 'probe_wolf');
    expect(wolf?.conditions.map((c) => c.id)).toEqual(['vergiftung']);
    expect(wolf?.armorBreak).toBe(6);
    const kriecher = data.creatures.find((c) => c.creature === 'kriecher');
    expect(kriecher?.attackPhase).toBe('erholen');
  });

  it('M6-36: loaded mid-grab, the Kriecher still holds the player, bites at the same ticks and lets go at the same tick', () => {
    const a = night();
    ambush(a);
    const b = night();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    expect(b.creatures.holdsPlayer(b.sim)).toBe(true);
    let freedA = -1;
    let freedB = -1;
    const bitesA: number[] = [];
    const bitesB: number[] = [];
    for (let i = 0; i < 6 * 60; i++) {
      const ea = a.run(1);
      const eb = b.run(1);
      bitesA.push(...eventsOf<SimEventMap['creatureAttack']>(ea, 'creatureAttack').filter((x) => x.creature === 'kriecher').map((x) => x.tick));
      bitesB.push(...eventsOf<SimEventMap['creatureAttack']>(eb, 'creatureAttack').filter((x) => x.creature === 'kriecher').map((x) => x.tick));
      if (freedA < 0 && !a.creatures.holdsPlayer(a.sim)) freedA = a.sim.tick;
      if (freedB < 0 && !b.creatures.holdsPlayer(b.sim)) freedB = b.sim.tick;
    }
    expect(freedA).toBeGreaterThan(0);
    expect(freedB).toBe(freedA);
    expect(bitesB).toEqual(bitesA);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
  });

  it('M6-36: the leash\'s give-up (M6-13b) and the Finstermond brood (M6-27) survive save → load; old saves read neither', () => {
    const given = JSON.parse(expectRoundtrip(leashWorld, leash, (w) => w.creatures.save).canonical) as Saved;
    expect(given.creatures.filter((c) => c.leashed === true).map((c) => c.creature)).toEqual(['dornling']);
    const dark = JSON.parse(expectRoundtrip(finsterNight, (w) => w.run(20 * HZ), (w) => w.creatures.save).canonical) as Saved;
    const brood = dark.creatures.filter((c) => c.creature === 'probe_schleicher');
    expect(brood.length).toBeGreaterThan(0);
    expect(brood.every((c) => c.finster === true)).toBe(true);
    // Neither field is written where it is not set; a save of version 3 from before M6-13b/M6-27 reads both as false.
    for (const c of [...given.creatures, ...dark.creatures]) {
      if (c.creature !== 'dornling') expect('leashed' in c, c.creature).toBe(false);
      if (c.creature !== 'probe_schleicher') expect('finster' in c, c.creature).toBe(false);
    }
    for (const data of [given, dark]) {
      const old = { ...data, creatures: data.creatures.map(({ leashed: _l, finster: _f, ...rest }) => rest) };
      expect(creaturesSnapshotSchema.parse(old).creatures.every((c) => !c.leashed && !c.finster)).toBe(true);
    }
  });

  it('M6-36: loaded with the Dornling given up, it lets the prey come back just inside the leash – tick for tick like the unsaved world', () => {
    const a = leashWorld();
    leash(a);
    const b = leashWorld();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    const dornling = (w: KreaturWelt): { leashed: boolean; state: string } => {
      for (let i = 0; i < w.creatures.store.size; i++) {
        const s = w.creatures.store.valueAt(i);
        if (s.creature === 'dornling') return { leashed: s.leashed, state: s.state };
      }
      throw new Error('no Dornling');
    };
    // The player walks back to just inside the leash (between `reengageShare` and the leash), the Dornling watching him (as in
    // ki-leine.test.ts): given up, it does not hunt – in the loaded world as in the one never saved.
    const leine = a.creatures.catalog.get('dornling').profile.leine;
    const back = a.centre(20 + leine - 1, 15).x;
    for (let i = 0; i < 10 * HZ; i++) {
      for (const w of [a, b]) {
        const e = w.creatures.store.entityAt(dornlingRow(w));
        const s = w.state(e);
        const p = w.where(e);
        s.facing = Math.atan2(w.pos().y - p.y, w.pos().x - p.x);
        w.run(1, i === 0 ? [{ type: 'player.move', dx: -1, dy: 0 }] : w.pos().x <= back ? [{ type: 'player.move', dx: 0, dy: 0 }] : undefined);
      }
      expect(dornling(b), `tick ${i + 1}`).toEqual(dornling(a));
      expect(dornling(b).state).not.toBe('jagen');
    }
    expect(dornling(b).leashed).toBe(true);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
  });
});

/** Row of the Dornling in the creature store. */
function dornlingRow(w: KreaturWelt): number {
  for (let i = 0; i < w.creatures.store.size; i++) if (w.creatures.store.valueAt(i).creature === 'dornling') return i;
  throw new Error('no Dornling');
}

/** Saved creatures as far as these tests read them. */
interface Saved {
  creatures: { creature: string; leashed?: boolean; finster?: boolean }[];
}

/** The world of the leash (as tests/unit/game/ki-leine.test.ts): a wide meadow by day, the player lit and in god mode. */
function leashWorld(): KreaturWelt {
  const w = kreaturWelt(meadow(60, 30), { x: 25, y: 15 });
  w.cheats.god = true;
  w.light.lit = true;
  return w;
}

/** A revealed Dornling hunts the player, who walks off beyond its leash until it gives the prey up. */
function leash(w: KreaturWelt): void {
  const e = w.creature('dornling', 20, 15);
  const s = w.state(e);
  s.hidden = false;
  s.facing = 0;
  w.run(HZ);
  if (w.state(e).state !== 'jagen') throw new Error(`the Dornling does not hunt (${w.state(e).state})`);
  const leine = w.creatures.catalog.get('dornling').profile.leine;
  const target = w.centre(20 + leine + 3, 15).x;
  for (let i = 0; i < 10 * HZ && w.pos().x < target; i++) w.run(1, i === 0 ? [{ type: 'player.move', dx: 1, dy: 0 }] : undefined);
  w.run(1, [{ type: 'player.move', dx: 0, dy: 0 }]);
  for (let i = 0; i < 20 * HZ && !w.state(e).leashed; i++) w.run(1);
  if (!w.state(e).leashed) throw new Error(`the Dornling never gave up (${((w.pos().x - w.where(e).x) / TILE_PX).toFixed(1)} tiles)`);
}

/** A Finstermond night (as tests/unit/game/spawn.test.ts): the night spawner brings the stronger brood. */
function finsterNight(): KreaturWelt {
  const w = kreaturWelt(meadow(10, 10), { x: 5, y: 5 });
  w.cheats.god = true;
  w.cenv.phase = 'nacht';
  w.cenv.finster = true;
  w.light.ambient = 0.05;
  return w;
}
