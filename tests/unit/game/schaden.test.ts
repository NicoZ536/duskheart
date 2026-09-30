/**
 * M6-04 Schaden §19.3 (docs/SPIEL.md §10 "Treffer-Ablauf"; MASTERPROMPT §19.3 "8 Typen, Resistenzen/Schwächen, Rüstung
 * R/(R+50), Krit 5 % ×1,75, Zustände über Waffen/Munition", §D): the damage formula per type, resistance and weakness,
 * armour, crits from the stream `combat`, conditions of weapons, the player's damage through `VitalsSystem.damage` with
 * the causes `kreatur` and `projektil` (god mode stays in force), armour and resistances from the worn equipment, armour
 * wear; M6-05's unit part: hitstop 2–6 ticks and knockback by impact.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { DAMAGE_TYPE_IDS } from '../../../src/content/balance/combat';
import { armorReduction, critRoll, hitDamage, hitstopTicks, hostile, knockbackPx, resistFactor } from '../../../src/game/combat/formulas';
import { createCombatAttack } from '../../../src/game/combat/system';
import { COMBAT_TEAMS, DAMAGE_TYPES } from '../../../src/game/combat/targets';
import { eventsOf, kampfWelt } from './kampf-testwelt';

const D = BALANCE.combat.damage;

describe('Formeln §19.3', () => {
  it('die acht Schadensarten sind in Content und Simulation dieselben', () => {
    expect([...DAMAGE_TYPES]).toEqual([...DAMAGE_TYPE_IDS]);
    expect(DAMAGE_TYPES).toHaveLength(8);
  });

  it('Rüstung R / (R + 50): 0 nichts, 50 halbiert, 12 ≈ 19 %; gebrochene Rüstung unter 0 nimmt nichts', () => {
    expect(armorReduction(0)).toBe(0);
    expect(armorReduction(50)).toBe(0.5);
    expect(armorReduction(12)).toBeCloseTo(12 / 62, 12);
    expect(armorReduction(-4)).toBe(0);
  });

  it('Resistenz 0,5 halbiert, Schwäche −0,5 nimmt 1,5×, begrenzt auf −1 … 1', () => {
    expect(resistFactor(0.5)).toBe(0.5);
    expect(resistFactor(-0.5)).toBe(1.5);
    expect(resistFactor(3)).toBe(0);
    expect(resistFactor(-3)).toBe(2);
  });

  it('Schaden = Basis × (1 − Resistenz) × (1 − Rüstung) × Krit × (1 − Blockkraft), nie unter 0', () => {
    expect(hitDamage(20, 0.25, 50, true, 0.4)).toBeCloseTo(20 * 0.75 * 0.5 * D.critFactor * 0.6, 12);
    expect(hitDamage(20, 1, 0, false, 0)).toBe(0);
    expect(critRoll(0.049)).toBe(true);
    expect(critRoll(0.05)).toBe(false);
  });

  it('Hitstop 2–6 Ticks und Rückstoß nach Wucht 1–5 (M6-05)', () => {
    expect([1, 2, 3, 4, 5].map(hitstopTicks)).toEqual([2, 3, 4, 5, 6]);
    expect(hitstopTicks(0)).toBe(2);
    expect(hitstopTicks(9)).toBe(6);
    const kb = [1, 2, 3, 4, 5].map(knockbackPx);
    for (let i = 1; i < kb.length; i++) expect(kb[i]).toBeGreaterThan(kb[i - 1] as number);
  });

  it('der Spieler und jede Kreatur kämpfen gegeneinander, Kreaturen nicht untereinander', () => {
    for (const t of COMBAT_TEAMS) {
      expect(hostile(t, t), t).toBe(false);
      if (t !== 'spieler') expect(hostile('spieler', t)).toBe(true);
    }
    expect(hostile('tier', 'feind')).toBe(false);
    expect(hostile('schattenbrut', 'tier')).toBe(false);
  });
});

describe('Treffer auf Kreaturen', () => {
  it('jede der acht Arten liest ihre eigene Resistenz: Schwäche verstärkt, Resistenz schwächt', () => {
    const k = kampfWelt();
    for (const type of DAMAGE_TYPES) {
      const resist = { hieb: 0, stich: 0, wucht: 0, feuer: 0, frost: 0, gift: 0, licht: 0, schatten: 0 };
      resist[type] = -0.5;
      const weak = k.dummy(10, 0, { resist });
      const tough = k.dummy(10, 0, { resist: { ...resist, [type]: 0.5 } });
      const a = { ...createCombatAttack(), damage: 10, type, critChance: 0, fromX: k.pos().x, fromY: k.pos().y };
      expect(k.combat.resolve(k.sim, k.sim.player, weak.entity, a)?.amount, type).toBeCloseTo(15, 12);
      expect(k.combat.resolve(k.sim, k.sim.player, tough.entity, a)?.amount, type).toBeCloseTo(5, 12);
    }
  });

  it(`Krit ${D.critChance * 100} % ×${D.critFactor}: geseedet und im erwarteten Anteil`, () => {
    const k = kampfWelt([], { x: 1, y: 1 }, 7);
    const d = k.dummy(10, 0, { health: 1e9, maxHealth: 1e9 });
    const a = { ...createCombatAttack(), damage: 10, fromX: 0, fromY: 0 };
    const N = 4000;
    let crits = 0;
    for (let i = 0; i < N; i++) {
      const h = k.combat.resolve(k.sim, k.sim.player, d.entity, a);
      if (h?.crit === true) {
        crits++;
        expect(h.amount).toBeCloseTo(10 * D.critFactor, 12);
      } else expect(h?.amount).toBe(10);
    }
    expect(crits / N).toBeGreaterThan(0.04);
    expect(crits / N).toBeLessThan(0.06);
    // Same seed, same crits (stream `combat`).
    const again = kampfWelt([], { x: 1, y: 1 }, 7);
    const d2 = again.dummy(10, 0, { health: 1e9, maxHealth: 1e9 });
    let crits2 = 0;
    for (let i = 0; i < N; i++) if (again.combat.resolve(again.sim, again.sim.player, d2.entity, a)?.crit === true) crits2++;
    expect(crits2).toBe(crits);
  });

  it('Rüstung des Ziels mindert den Schaden; ein Zustand der Waffe landet mit seiner Chance, geblockt nicht', () => {
    const k = kampfWelt();
    const d = k.dummy(10, 0, { armor: 50 });
    const a = { ...createCombatAttack(), damage: 10, critChance: 0, condition: { id: 'blutung', chance: 1, sekunden: 5 }, fromX: 0, fromY: 0 };
    expect(k.combat.resolve(k.sim, k.sim.player, d.entity, a)).toMatchObject({ amount: 5, condition: 'blutung', conditionSeconds: 5 });
    const blocker = k.dummy(10, 0, { blockSinceTick: 0, blockPower: 0.5, facing: Math.PI });
    k.run(20);
    const blocked = k.combat.resolve(k.sim, k.sim.player, blocker.entity, { ...a, fromX: blocker.x - 20, fromY: blocker.y });
    expect(blocked).toMatchObject({ blocked: true, condition: null, amount: 5 });
  });

  it('kein Treffer auf Unverwundbare, Tote und die eigene Seite', () => {
    const k = kampfWelt();
    const a = { ...createCombatAttack(), damage: 10, fromX: 0, fromY: 0 };
    expect(k.combat.resolve(k.sim, k.sim.player, k.dummy(10, 0, { invulnerable: true }).entity, a)).toBeNull();
    expect(k.combat.resolve(k.sim, k.sim.player, k.dummy(10, 0, { health: 0 }).entity, a)).toBeNull();
    expect(k.combat.resolve(k.sim, k.sim.player, k.dummy(10, 0, { team: 'spieler' }).entity, a)).toBeNull();
    expect(k.combat.resolve(k.sim, k.sim.player, 99_999, a)).toBeNull();
  });
});

describe('Treffer auf den Spieler', () => {
  it('Schaden über VitalsSystem.damage mit Ursache „kreatur“ bzw. „projektil“', () => {
    const k = kampfWelt();
    const foe = k.dummy(12, 0);
    const events = new Map<string, unknown[]>();
    k.strikePlayer(foe, { critChance: 0, damage: 12 });
    k.strikePlayer(foe, { critChance: 0, damage: 5, projectile: true });
    k.sim.events.drain((type, payload) => events.set(type, [...(events.get(type) ?? []), payload]));
    expect(eventsOf(events, 'playerDamaged')).toEqual([expect.objectContaining({ cause: 'kreatur', amount: 12 }), expect.objectContaining({ cause: 'projektil', amount: 5 })]);
    expect(k.vit().health).toBe(83);
    expect(eventsOf(events, 'hitLanded')).toEqual([expect.objectContaining({ targetTeam: 'spieler', material: 'fleisch' }), expect.objectContaining({ amount: 5 })]);
  });

  it('God-Modus: kein Treffer landet, kein Schaden, kein Rückstoß', () => {
    const k = kampfWelt();
    k.cheats.god = true;
    const foe = k.dummy(12, 0);
    const pos = k.pos();
    expect(k.strikePlayer(foe, { damage: 50, wucht: 5 })).toBeNull();
    k.run(10);
    expect(k.vit().health).toBe(100);
    expect(k.pos()).toEqual(pos);
  });

  it('Rüstung und Resistenzen der Ausrüstung schützen; jeder Treffer nutzt die getragene Rüstung ab', () => {
    const k = kampfWelt();
    k.wear('probe_brustpanzer', 'brust');
    const foe = k.dummy(12, 0);
    const h = k.strikePlayer(foe, { critChance: 0, damage: 10 });
    expect(h?.amount).toBeCloseTo(10 * (1 - 12 / 62), 12);
    const fire = k.strikePlayer(foe, { critChance: 0, damage: 10, type: 'feuer' });
    expect(fire?.amount).toBeCloseTo(10 * 0.5 * (1 - 12 / 62), 12);
    expect(k.equipment.worn('brust')?.haltbarkeit).toBe(58);
  });

  it('Rückstoß schiebt den Spieler über wenige Ticks vom Angreifer weg; Zustände landen', () => {
    const k = kampfWelt();
    const foe = k.dummy(12, 0);
    const x0 = k.pos().x;
    k.strikePlayer(foe, { critChance: 0, damage: 1, wucht: 5, condition: { id: 'vergiftung', chance: 1, sekunden: 10 } });
    k.run(hitstopTicks(5) + BALANCE.combat.impact.knockbackTicks + 1);
    // Positions are 32-bit floats (the motion columns).
    expect(x0 - k.pos().x).toBeCloseTo(knockbackPx(5), 2);
    expect(k.life.conditions.has('vergiftung')).toBe(true);
  });

  it('die Rolle macht unverwundbar: der Schlag verfehlt und gibt „ausweichrolle“', () => {
    const k = kampfWelt();
    const foe = k.dummy(12, 0);
    k.run(1, [{ type: 'player.roll', dx: 0, dy: 1 }]);
    expect(k.strikePlayer(foe)).toBeNull();
    const events = new Map<string, unknown[]>();
    k.sim.events.drain((type, payload) => events.set(type, [...(events.get(type) ?? []), payload]));
    expect(eventsOf(events, 'xpGained')).toEqual([expect.objectContaining({ source: 'ausweichrolle', skill: 'verteidigung' })]);
  });

  it('ein Treffer mit Stagger unterbricht das Ausholen des Spielers; taumelnd schlägt er nicht', () => {
    const k = kampfWelt();
    k.hold('probe_zweihand');
    k.run(2, [{ type: 'combat.attack', on: true }]);
    expect(k.combat.state.player.phase).toBe('ausholen');
    k.strikePlayer(k.dummy(12, 0), { critChance: 0, damage: 1, staggerSeconds: 0.5 });
    expect(k.combat.state.player.phase).toBe('bereit');
    expect(eventsOf(k.run(1, [{ type: 'combat.attack', on: false }, { type: 'combat.attack', on: true }]), 'commandRejected')).toEqual([expect.objectContaining({ reason: 'staggered' })]);
  });
});
