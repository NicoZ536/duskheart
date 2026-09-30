/**
 * M6-03 Parade (docs/SPIEL.md §10 "Parade (M6-03)"; MASTERPROMPT §19.1 "Block in den letzten 0,15 s vor dem Treffer →
 * Gegner taumelt, der nächste Treffer ist kritisch"): a block begun at most 9 ticks (0,15 s) before a blow parries it –
 * exactly: 9 ticks parries, 10 only blocks; no damage, the attacker staggers and its next hit taken is critical; the block
 * works in the tick its command arrives (no buffer); from behind nothing is blocked; a bow aims, it does not parry.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { PARRY_WINDOW_TICKS, hitDamage, secondsToTicks } from '../../../src/game/combat/formulas';
import { COMBAT_XP, createCombatAttack } from '../../../src/game/combat/system';
import type { HitResult } from '../../../src/game/combat/targets';
import type { SimSystem } from '../../../src/game/sim';
import { eventsOf, kampfWelt, runUntil, type Dummy, type KampfWelt } from './kampf-testwelt';

const P = BALANCE.combat.parry;

/** A foe that strikes the player (10 damage, impact 2) in tick `at`; the hit lands in `out`. */
function foeStrikesAt(k: KampfWelt, foe: Dummy, at: number, out: { hit: HitResult | null; tick: number }): void {
  const system: SimSystem = {
    id: `angreifer-${at}`,
    timeScope: 'global',
    update: (sim) => {
      if (sim.tick !== at) return;
      out.tick = sim.tick;
      const a = { ...createCombatAttack(), team: foe.team, damage: 10, wucht: 2, staggerSeconds: 0.3, fromX: foe.x, fromY: foe.y };
      const h = k.combat.resolve(sim, foe.entity, sim.player, a);
      out.hit = h === null ? null : { ...h };
    },
  };
  k.sim.addSystem(system);
}

/** A world where the player blocks with a sword facing a foe to the east, the foe strikes `delay` ticks after the block. */
function blockThenHit(delay: number) {
  const k = kampfWelt();
  k.hold('probe_schwert');
  k.aimBy(30, 0);
  const foe = k.dummy(12, 0);
  const out = { hit: null as HitResult | null, tick: -1 };
  const blockTick = k.sim.tick;
  foeStrikesAt(k, foe, blockTick + delay, out);
  const events = k.run(delay + 1, [{ type: 'combat.block', on: true }]);
  return { k, foe, out, blockTick, events };
}

describe('Parade: Zeitfenster exakt', () => {
  it(`das Fenster ist ${P.windowSeconds} s = ${PARRY_WINDOW_TICKS} Ticks`, () => {
    expect(PARRY_WINDOW_TICKS).toBe(9);
  });

  for (const delay of [0, 1, 8, 9]) {
    it(`Block ${delay} Ticks vor dem Treffer pariert: kein Schaden, der Angreifer taumelt`, () => {
      const { k, foe, out, blockTick, events } = blockThenHit(delay);
      expect(out.tick).toBe(blockTick + delay);
      expect(k.combat.state.player.blockSinceTick).toBe(blockTick);
      expect(out.hit).toMatchObject({ parried: true, amount: 0 });
      expect(k.vit().health).toBe(100);
      expect(eventsOf(events, 'parried')).toEqual([expect.objectContaining({ entity: k.sim.player, attacker: foe.entity })]);
      expect(foe.hits).toEqual([expect.objectContaining({ parried: true, amount: 0, staggerTicks: secondsToTicks(P.staggerSeconds), attacker: k.sim.player })]);
      expect(eventsOf(events, 'staggered')).toEqual([expect.objectContaining({ entity: foe.entity })]);
      expect(eventsOf(events, 'xpGained')).toEqual([expect.objectContaining({ source: COMBAT_XP.parry, skill: 'verteidigung' })]);
    });
  }

  it('10 Ticks nach Blockbeginn ist es nur noch ein Block: Schaden × (1 − Blockkraft), keine Parade', () => {
    const { k, foe, out, events } = blockThenHit(PARRY_WINDOW_TICKS + 1);
    expect(out.hit).toMatchObject({ parried: false, blocked: true });
    const expected = hitDamage(10, 0, 0, out.hit?.crit ?? false, BALANCE.combat.block.weaponPower);
    expect(out.hit?.amount).toBeCloseTo(expected, 6);
    expect(eventsOf(events, 'parried')).toEqual([]);
    expect(eventsOf(events, 'blocked')).toEqual([expect.objectContaining({ entity: k.sim.player, attacker: foe.entity })]);
    expect(eventsOf(events, 'xpGained')).toEqual([expect.objectContaining({ source: COMBAT_XP.blocked })]);
    expect(foe.hits).toEqual([]);
  });

  it('ohne Block trifft der volle Schaden', () => {
    const k = kampfWelt();
    const foe = k.dummy(12, 0);
    const h = k.strikePlayer(foe, { critChance: 0 });
    expect(h).toMatchObject({ parried: false, blocked: false, amount: 10 });
    expect(k.vit().health).toBe(90);
  });
});

describe('Parade: Folgen', () => {
  it('der nächste Treffer auf den parierten Angreifer ist kritisch – einmal', () => {
    const { k, foe } = blockThenHit(3);
    expect(k.combat.state.marks.map((m) => m.entity)).toEqual([foe.entity]);
    k.run(1, [{ type: 'combat.block', on: false }]);
    // The parry's hitstop holds the player a few ticks; then the sword's blow lands.
    k.run(1, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]);
    runUntil(k, () => foe.hits.length === 2, 30);
    const riposte = foe.hits.at(-1);
    expect(riposte).toMatchObject({ parried: false, crit: true });
    expect(riposte?.amount).toBeCloseTo(8 * BALANCE.combat.damage.critFactor, 6);
    expect(k.combat.state.marks).toEqual([]);
  });

  it(`die Markierung verfällt nach ${P.riposteSeconds} s`, () => {
    const { k } = blockThenHit(3);
    k.run(secondsToTicks(P.riposteSeconds) + 1);
    expect(k.combat.state.marks).toEqual([]);
  });
});

describe('Parade: Richtung, Eingabe, Fernwaffe, Faust', () => {
  it('von hinten wird weder pariert noch geblockt', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    k.aimBy(30, 0);
    const foe = k.dummy(-12, 0);
    k.run(1, [{ type: 'combat.block', on: true }]);
    const h = k.strikePlayer(foe, { critChance: 0 });
    expect(h).toMatchObject({ parried: false, blocked: false, amount: 10 });
  });

  it('eine Rolle senkt den Block; danach beginnt er neu – mit neuem Paradefenster', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    k.aimBy(30, 0);
    k.run(1, [{ type: 'combat.block', on: true }]);
    const first = k.combat.state.player.blockSinceTick;
    k.run(1, [{ type: 'player.roll', dx: 0, dy: 1 }]);
    expect(k.combat.state.player.blockSinceTick).toBe(-1);
    let rolled = -1;
    for (let i = 0; i < k.player.rollDurationTicks + 2 && rolled < 0; i++) {
      const tick = k.sim.tick;
      k.run(1);
      if (k.body().rollTicks === 0) rolled = tick;
    }
    expect(rolled).toBeGreaterThan(first);
    expect(k.combat.state.player.blockSinceTick).toBe(rolled);
  });

  it('mit dem Bogen hebt die Blocktaste die Waffe zum Zielen: keine Parade, kein Block', () => {
    const k = kampfWelt();
    k.hold('probe_bogen');
    k.aimBy(30, 0);
    const foe = k.dummy(12, 0);
    k.run(1, [{ type: 'combat.block', on: true }]);
    expect(k.combat.effectiveBlock(k.sim)?.kind).toBe('ziel');
    expect(k.strikePlayer(foe, { critChance: 0 })).toMatchObject({ parried: false, blocked: false, amount: 10 });
  });

  it('auch die Fäuste parieren', () => {
    const k = kampfWelt();
    k.aimBy(30, 0);
    const foe = k.dummy(12, 0);
    k.run(1, [{ type: 'combat.block', on: true }]);
    expect(k.strikePlayer(foe)).toMatchObject({ parried: true, amount: 0 });
  });

  it('im Schlaf oder tot wird kein Block angenommen', () => {
    const k = kampfWelt();
    k.vit().health = 0;
    expect(eventsOf(k.run(1, [{ type: 'combat.block', on: true }]), 'commandRejected')).toEqual([expect.objectContaining({ type: 'combat.block', reason: 'dead' })]);
  });
});
