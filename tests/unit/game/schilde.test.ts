/**
 * M6-09 Schild-Mechanik (docs/SPIEL.md §10 "Schilde (M6-09)"; MASTERPROMPT §19.2 "Schilde: Holz (40 % Blockkraft),
 * Bronze, Eisen, Turmschild (90 %, langsam)", §12.2 "Mit Schild … hängt sie am Gürtel (−40 % Radius)"): block power and
 * stamina per blocked point from the shield's data, the guard breaks when stamina runs out, a tower shield walks slower
 * while blocking, blocks wear the shield, and with a shield in the off hand the carried torch hangs on the belt.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { hitDamage, hitstopTicks, knockbackPx, secondsToTicks } from '../../../src/game/combat/formulas';
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

  it(`ein geblockter Schlag stößt nur ${BALANCE.combat.block.knockbackFactor * 100} % so weit zurück (BALANCE.combat.block.knockbackFactor)`, () => {
    const push = (block: boolean): number => {
      const k = block ? blocking('probe_holzschild').k : kampfWelt();
      const foe = block ? (k.dummies.list[0] as NonNullable<(typeof k.dummies.list)[number]>) : k.dummy(12, 0);
      const x0 = k.pos().x;
      const h = k.strikePlayer(foe, { critChance: 0, damage: 1, wucht: 5 });
      expect(h?.blocked).toBe(block);
      k.run(hitstopTicks(5) + BALANCE.combat.impact.knockbackTicks + 1);
      return x0 - k.pos().x;
    };
    // Positions are 32-bit floats (the motion columns).
    expect(push(false)).toBeCloseTo(knockbackPx(5), 2);
    expect(push(true)).toBeCloseTo(knockbackPx(5) * B.knockbackFactor, 2);
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

describe('Zweihandwaffe, Bogen, Armbrust und Schild (§19.2, §12.2; M6-48: sie lassen keine Hand für den Schild)', () => {
  /** A player with `hand` in the hand and `shield` in the off hand, blocking towards a foe to the east. */
  function blockingWith(hand: string, shield: string) {
    const k = kampfWelt();
    k.offhand(shield);
    k.hold(hand);
    k.aimBy(30, 0);
    const foe = k.dummy(12, 0);
    k.run(1, [{ type: 'combat.block', on: true }]);
    k.run(20);
    return { k, foe };
  }

  for (const [hand, shield] of [
    ['probe_zweihand', 'probe_bronzeschild'],
    ['felsbrecher', 'bronzeschild'],
    ['bronzezweihaender', 'holzschild'],
  ] as const) {
    it(`${hand} mit ${shield}: der Schild hängt ungenutzt, die Waffe wehrt ab (weaponPower) und der Schild nutzt sich nicht ab`, () => {
      expect(catalog.get(hand).waffe?.klasse).toBe('zweihand');
      const { k, foe } = blockingWith(hand, shield);
      const before = k.equipment.worn('nebenhand')?.haltbarkeit;
      expect(k.combat.effectiveBlock(k.sim)).toMatchObject({ kind: 'block', shield: null, power: B.weaponPower });
      const h = k.strikePlayer(foe, { critChance: 0, damage: 10 });
      expect(h).toMatchObject({ blocked: true, parried: false });
      expect(h?.amount).toBeCloseTo(hitDamage(10, 0, 0, false, B.weaponPower), 12);
      expect(k.equipment.worn('nebenhand')?.haltbarkeit).toBe(before);
    });
  }

  for (const hand of ['kurzbogen', 'armbrust'] as const) {
    it(`${hand} mit Schild: die Nebenhand zieht bzw. hält – die Blocktaste zielt, der Schild fängt nichts ab`, () => {
      expect(B.noShieldClasses).toContain(catalog.get(hand).waffe?.klasse);
      const { k, foe } = blockingWith(hand, 'bronzeschild');
      expect(k.combat.effectiveBlock(k.sim)).toMatchObject({ kind: 'ziel', shield: null });
      const before = k.equipment.worn('nebenhand')?.haltbarkeit;
      const h = k.strikePlayer(foe, { critChance: 0, damage: 10 });
      expect(h).toMatchObject({ blocked: false, parried: false });
      expect(h?.amount).toBeCloseTo(10, 12);
      expect(k.equipment.worn('nebenhand')?.haltbarkeit).toBe(before);
    });
  }

  it('die Schleuder lässt die Nebenhand frei: der Schild blockt', () => {
    expect(B.noShieldClasses).not.toContain('schleuder');
    const { k, foe } = blockingWith('schleuder', 'bronzeschild');
    const h = k.strikePlayer(foe, { critChance: 0, damage: 10 });
    expect(h).toMatchObject({ blocked: true });
    expect(h?.amount).toBeCloseTo(hitDamage(10, 0, 0, false, catalog.get('bronzeschild').schild?.blockkraft ?? 0), 12);
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
  /** The light the player carries with `hand` in the hand and a torch in the off hand (the rule the combat system registers with the light system). */
  function carriedWith(hand: string) {
    const k = kampfWelt();
    k.offhand('fackel');
    k.hold(hand);
    return findCarriedLight(k.inventory.state, catalog, k.combat.twoHandedRule);
  }

  for (const hand of ['kurzbogen', 'kompositbogen', 'armbrust', 'probe_bogen', 'probe_armbrust', 'felsbrecher', 'probe_zweihand'] as const) {
    it(`M6-79: ${hand} lässt keine Hand für die Fackel – sie hängt am Gürtel (−40 % Radius), wie der Schild ungenutzt hängt (ADR-0154)`, () => {
      expect(B.noShieldClasses).toContain(catalog.get(hand).waffe?.klasse);
      const carried = carriedWith(hand);
      expect(carried).toMatchObject({ ref: equipmentRef('nebenhand'), mode: 'guertel' });
      expect(carriedRadiusPx(carried?.mode ?? 'hand')).toBeCloseTo(0.6 * carriedRadiusPx('hand'), 12);
    });
  }

  for (const hand of ['schleuder', 'probe_schleuder', 'probe_schwert', 'holzkeule', 'wurfmesser_feuerstein'] as const) {
    it(`M6-79: ${hand} lässt die Nebenhand frei – die Fackel bleibt in der Hand`, () => {
      expect(B.noShieldClasses).not.toContain(catalog.get(hand).waffe?.klasse);
      expect(carriedWith(hand)).toMatchObject({ ref: equipmentRef('nebenhand'), mode: 'hand' });
    });
  }

  it('M6-79: mit dem Bogen in der Hand und ohne Licht in der Nebenhand hängt die Fackel aus der Schnellleiste am Gürtel', () => {
    const k = kampfWelt();
    k.hold('fackel', 1, 3);
    k.hold('kurzbogen', 1, 0);
    expect(findCarriedLight(k.inventory.state, catalog, k.combat.twoHandedRule)).toMatchObject({ ref: { bereich: 'schnellleiste', index: 3 }, mode: 'guertel' });
  });

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
