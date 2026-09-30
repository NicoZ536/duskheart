/**
 * M6-09 Schild-Mechanik (docs/SPIEL.md §10 "Schilde (M6-09)"; MASTERPROMPT §19.2 "Schilde: Holz (40 % Blockkraft),
 * Bronze, Eisen, Turmschild (90 %, langsam)", §12.2 "Mit Schild … hängt sie am Gürtel (−40 % Radius)"): block power and
 * stamina per blocked point from the shield's data, the guard breaks when stamina runs out, a tower shield walks slower
 * while blocking, blocks wear the shield, and with a shield in the off hand the carried torch hangs on the belt.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { hitDamage, secondsToTicks } from '../../../src/game/combat/formulas';
import { carriedRadiusPx, findCarriedLight } from '../../../src/game/light/formulas';
import { equipmentRef } from '../../../src/game/items/slots';
import { withSlot } from '../../../src/game/inventory/bags';
import { eventsOf, kampfCatalog, kampfWelt, type KampfWelt } from './kampf-testwelt';

const B = BALANCE.combat.block;
const catalog = kampfCatalog();

/** A player with `shield` in the off hand, blocking towards a foe to the east (parry window long over). */
function blocking(shield: string) {
  const k = kampfWelt();
  k.offhand(shield);
  k.aimBy(30, 0);
  const foe = k.dummy(12, 0);
  k.run(1, [{ type: 'combat.block', on: true }]);
  k.run(20);
  return { k, foe };
}

function events(k: KampfWelt): Map<string, unknown[]> {
  const m = new Map<string, unknown[]>();
  k.sim.events.drain((type, payload) => m.set(type, [...(m.get(type) ?? []), payload]));
  return m;
}

describe('Blockkraft und Ausdauer aus den Schilddaten', () => {
  for (const [id, power] of [
    ['probe_holzschild', 0.4],
    ['probe_bronzeschild', 0.6],
    ['probe_turmschild', 0.9],
  ] as const) {
    it(`${id}: ${power * 100} % Blockkraft, Ausdauer je abgefangenem Punkt`, () => {
      const { k, foe } = blocking(id);
      const s = catalog.get(id).schild;
      expect(s?.blockkraft).toBe(power);
      const stamina = k.vit().stamina;
      const h = k.strikePlayer(foe, { critChance: 0, damage: 10 });
      expect(h).toMatchObject({ blocked: true, parried: false });
      expect(h?.amount).toBeCloseTo(hitDamage(10, 0, 0, false, power), 12);
      expect(h?.blockStamina).toBeCloseTo(10 * power * (s?.ausdauerJeSchaden ?? 0), 12);
      expect(stamina - k.vit().stamina).toBeCloseTo(10 * power * (s?.ausdauerJeSchaden ?? 0), 12);
      expect(k.equipment.worn('nebenhand')?.haltbarkeit).toBe(59);
    });
  }

  it('ein Schild pariert im Fenster wie jede Blockart', () => {
    const k = kampfWelt();
    k.offhand('probe_holzschild');
    k.aimBy(30, 0);
    const foe = k.dummy(12, 0);
    k.run(1, [{ type: 'combat.block', on: true }]);
    expect(k.strikePlayer(foe)).toMatchObject({ parried: true, amount: 0 });
  });

  it('ohne Ausdauer bricht die Deckung: der Block fällt, der Spieler taumelt', () => {
    const { k, foe } = blocking('probe_holzschild');
    k.vit().stamina = 1;
    k.strikePlayer(foe, { critChance: 0, damage: 10 });
    const ev = events(k);
    expect(eventsOf(ev, 'blocked')).toEqual([expect.objectContaining({ guardBroken: true })]);
    expect(k.combat.state.player.blockSinceTick).toBe(-1);
    expect(k.combat.state.player.blockHeld).toBe(false);
    expect(k.combat.staggered(k.sim.tick + secondsToTicks(B.guardBreakSeconds) - 1)).toBe(true);
    // The next blow lands in full.
    expect(k.strikePlayer(foe, { critChance: 0, damage: 10 })).toMatchObject({ blocked: false, amount: 10 });
  });

  it('ein zerbrochener Schild blockt nicht als Schild (die Hand wehrt ab)', () => {
    const { k, foe } = blocking('probe_bronzeschild');
    const worn = k.equipment.worn('nebenhand');
    if (worn === null) throw new Error('no shield');
    k.inventory.bags.replace(withSlot(k.inventory.state, equipmentRef('nebenhand'), { ...worn, haltbarkeit: 0 }));
    const h = k.strikePlayer(foe, { critChance: 0, damage: 10 });
    expect(h?.amount).toBeCloseTo(10 * (1 - B.fistPower), 12);
  });
});

describe('Turmschild-Tempo', () => {
  it('beim Blocken geht man langsamer, mit dem Turmschild noch langsamer (Tempofaktor)', () => {
    const walk = (shield: string | null, block: boolean): number => {
      const k = kampfWelt();
      if (shield !== null) k.offhand(shield);
      const y0 = k.pos().y;
      k.run(1, [...(block ? [{ type: 'combat.block' as const, on: true }] : [])]);
      k.run(20, [{ type: 'player.move', dx: 0, dy: 1 }]);
      return k.pos().y - y0;
    };
    const free = walk(null, false);
    const wood = walk('probe_holzschild', true);
    const tower = walk('probe_turmschild', true);
    expect(wood).toBeCloseTo(free * B.moveFactor, 0);
    expect(tower).toBeCloseTo(free * B.moveFactor * (catalog.get('probe_turmschild').schild?.tempoFaktor ?? 1), 0);
  });
});

describe('Nebenhand-Konflikt mit Licht', () => {
  it('mit Schild in der Nebenhand hängt die Fackel aus der Schnellleiste am Gürtel (−40 % Radius)', () => {
    const k = kampfWelt();
    k.offhand('probe_holzschild');
    k.hold('fackel', 1, 3);
    k.hold('probe_schwert', 1, 0);
    const carried = findCarriedLight(k.inventory.state, catalog, k.combat.twoHandedRule);
    expect(carried?.mode).toBe('guertel');
    expect(carriedRadiusPx('guertel')).toBeCloseTo(carriedRadiusPx('hand') * BALANCE.light.offhand.beltRadiusFactor, 12);
    expect(BALANCE.light.offhand.beltRadiusFactor).toBe(0.6);
  });
});
