/**
 * M3-03 Ausrüstung (MASTERPROMPT §13.1, §11.2, §11.4, §D): Kopf, Brust, Beine, Füße, Rücken, Nebenhand
 * (Licht oder Schild), 2× Schmuck, Gürtel mit 3 Schnellverbrauch-Plätzen; Haltbarkeit (kaputt =
 * unbenutzbar, nie zerstört); Werte-Aggregation.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { aggregateEquipmentStats, heaviestArmorWeight, isBroken, isUsable, wearStack, zeroStats, type EquippedPiece } from '../../../src/game/equipment/formulas';
import { equipmentModifierSource } from '../../../src/game/equipment/modifiers';
import { EquipmentSystem } from '../../../src/game/equipment/system';
import { emptyBags, PlayerBags, slotAt, withSlot } from '../../../src/game/inventory/bags';
import { moveStack, quickMove } from '../../../src/game/inventory/ops';
import { InventorySystem } from '../../../src/game/inventory/system';
import { maxDurability, qualityFactor } from '../../../src/game/items/formulas';
import { EQUIPMENT_SLOTS, equipmentRef, slotAccepts, type SlotRef } from '../../../src/game/items/slots';
import { newStack, type ItemStack } from '../../../src/game/items/stack';
import { Simulation } from '../../../src/game/sim';
import { createPlayerModifiers } from '../../../src/game/survival/modifiers';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { testCatalog } from './items-fixtures';

const catalog = testCatalog();
const inv = (index: number): SlotRef => ({ bereich: 'inventar', index });
const belt = (index: number): SlotRef => ({ bereich: 'guertel', index });

function piece(item: string, quality = 1): EquippedPiece {
  const def = catalog.get(item);
  return { def, stack: newStack(def, 1, { qualitaet: quality }) };
}

function broken(p: EquippedPiece): EquippedPiece {
  return { def: p.def, stack: { ...p.stack, haltbarkeit: 0 } };
}

describe('Ausrüstungsplätze (§13.1)', () => {
  it('Kopf, Brust, Beine, Füße, Rücken, Nebenhand, 2× Schmuck und 3 Gürtelplätze', () => {
    expect(EQUIPMENT_SLOTS).toEqual(['kopf', 'brust', 'beine', 'fuesse', 'ruecken', 'nebenhand', 'schmuck1', 'schmuck2']);
    expect(emptyBags().guertel).toHaveLength(BALANCE.items.bags.beltSlots);
    expect(BALANCE.items.bags.beltSlots).toBe(3);
  });

  it('jeder Platz nimmt nur, was dorthin gehört', () => {
    const accepts = (item: string): string[] =>
      [...EQUIPMENT_SLOTS.map((s) => equipmentRef(s)), belt(0), { bereich: 'rucksack' as const, index: 0 }]
        .filter((ref) => slotAccepts(ref, catalog.get(item)))
        .map((ref) => (ref.bereich === 'ausruestung' ? (EQUIPMENT_SLOTS[ref.index] as string) : ref.bereich));
    expect(accepts('probe_helm')).toEqual(['kopf']);
    expect(accepts('probe_brust')).toEqual(['brust']);
    expect(accepts('probe_stiefel')).toEqual(['fuesse']);
    expect(accepts('probe_umhang')).toEqual(['ruecken']);
    expect(accepts('probe_schild')).toEqual(['nebenhand']);
    expect(accepts('probe_fackel')).toEqual(['nebenhand']);
    expect(accepts('probe_ring')).toEqual(['schmuck1', 'schmuck2']);
    expect(accepts('himbeeren')).toEqual(['guertel']);
    expect(accepts('probe_trank')).toEqual(['guertel']);
    expect(accepts('probe_rucksack_8')).toEqual(['rucksack']);
    expect(accepts('stein')).toEqual([]);
    expect(accepts('probe_axt')).toEqual([]);
  });

  it('zwei Schmuckstücke gleichzeitig; Licht oder Schild in der Nebenhand', () => {
    let s = emptyBags();
    for (const [i, item] of ['probe_ring', 'probe_amulett', 'probe_fackel', 'probe_schild'].entries()) s = withSlot(s, inv(i), newStack(catalog.get(item), 1));
    const ring = moveStack(s, catalog, inv(0), equipmentRef('schmuck1'));
    if (!ring.ok) throw new Error(ring.reason);
    const both = quickMove(ring.state, catalog, inv(1));
    if (!both.ok) throw new Error(both.reason);
    expect(slotAt(both.state, equipmentRef('schmuck2'))?.item).toBe('probe_amulett');
    const light = quickMove(both.state, catalog, inv(2));
    if (!light.ok) throw new Error(light.reason);
    expect(slotAt(light.state, equipmentRef('nebenhand'))?.item).toBe('probe_fackel');
    // The shield swaps with the torch in the off-hand.
    const shield = moveStack(light.state, catalog, inv(3), equipmentRef('nebenhand'));
    if (!shield.ok) throw new Error(shield.reason);
    expect([slotAt(shield.state, equipmentRef('nebenhand'))?.item, slotAt(shield.state, inv(3))?.item]).toEqual(['probe_schild', 'probe_fackel']);
  });
});

describe('Haltbarkeit: kaputt = unbenutzbar, nie zerstört (§13.1, §D)', () => {
  it('Startwerte je Stufe nach §D; Qualität +10 % / +20 %', () => {
    expect(BALANCE.items.durabilityByTier).toEqual([60, 150, 250, 400, 550, 700, 900, 1200]);
    expect([qualityFactor(1), qualityFactor(2), qualityFactor(3)]).toEqual([1, 1.1, 1.2]);
    expect([maxDurability(60, 1), maxDurability(60, 2), maxDurability(60, 3)]).toEqual([60, 66, 72]);
    expect(newStack(catalog.get('probe_axt'), 1, { qualitaet: 3 }).haltbarkeit).toBe(72);
    expect(() => qualityFactor(4)).toThrow(RangeError);
  });

  it('jede Nutzung kostet Haltbarkeit; bei 0 ist das Stück kaputt und bleibt es', () => {
    let s: ItemStack = newStack(catalog.get('probe_axt'), 1);
    const once = wearStack(s, 1);
    expect([once.stack.haltbarkeit, once.broke]).toEqual([59, false]);
    const last = wearStack({ ...s, haltbarkeit: 3 }, 5);
    expect([last.stack.haltbarkeit, last.broke]).toEqual([0, true]);
    s = last.stack;
    expect([isBroken(s), isUsable(s)]).toEqual([true, false]);
    expect(wearStack(s, 1)).toEqual({ stack: s, broke: false });
    expect(wearStack(newStack(catalog.get('stein'), 5), 1).broke).toBe(false);
  });

  it('das System nutzt Stücke ab, meldet den Bruch einmal und lässt das kaputte Stück an seinem Platz', () => {
    const sim = new Simulation({ seed: 1 });
    const bags = new PlayerBags(catalog);
    const inventory = sim.addSystem(new InventorySystem(bags));
    const equipment = sim.addSystem(new EquipmentSystem(bags));
    inventory.give(sim, 'probe_axt', 1);
    const hand: SlotRef = { bereich: 'schnellleiste', index: 0 };
    bags.replace(withSlot(bags.state, hand, { ...(slotAt(bags.state, hand) as ItemStack), haltbarkeit: 2 }));
    sim.events.drain(() => undefined);
    expect(equipment.wear(sim, hand)).toBe('worn');
    expect(equipment.wear(sim, hand)).toBe('broke');
    expect(equipment.wear(sim, hand)).toBe('alreadyBroken');
    expect(equipment.usable(hand)).toBe(false);
    expect(slotAt(bags.state, hand)).toMatchObject({ item: 'probe_axt', haltbarkeit: 0 });
    expect(equipment.wear(sim, inv(0))).toBe('empty');
    inventory.give(sim, 'stein', 1);
    expect(equipment.wear(sim, inv(0))).toBe('noDurability');
    const events: unknown[] = [];
    sim.events.drain((type, payload) => events.push([type, payload]));
    expect(events.filter((e) => (e as [string])[0] === 'itemBroken')).toEqual([['itemBroken', { at: hand, item: 'probe_axt', tick: 0 }]]);
  });
});

describe('Werte-Aggregation', () => {
  it('summiert die Werte aller getragenen Stücke mit Qualitätsfaktor', () => {
    const stats = aggregateEquipmentStats([piece('probe_helm', 2), piece('probe_brust'), piece('probe_ring')]);
    expect(stats.werte.ruestung).toBeCloseTo(2 * 1.1 + 3, 10);
    expect(stats.werte.isolation).toBeCloseTo(5 * 1.1 + 30, 10);
    expect(stats.werte.maxLeben).toBe(10);
    expect(stats.werte.magnetradius).toBe(1);
    expect(stats.werte.kuehlung).toBe(0);
  });

  it('begrenzt Isolation auf 0–40, Kühlung auf 0–15, Resistenzen auf 1 (§11.2)', () => {
    const stats = aggregateEquipmentStats([piece('probe_helm'), piece('probe_brust'), piece('probe_umhang'), piece('probe_ring'), piece('probe_amulett')]);
    expect(stats.werte.isolation).toBe(40);
    expect(stats.werte.kuehlung).toBe(3);
    expect(stats.werte.furchtresistenz).toBe(1);
    expect(BALANCE.items.statLimits.kuehlung).toEqual({ min: 0, max: 15 });
  });

  it('kaputte Stücke geben keine Werte, wiegen aber weiter; das schwerste Stück bestimmt das Rüstungsgewicht (§11.4)', () => {
    const helm = piece('probe_helm');
    const boots = piece('probe_stiefel');
    const stats = aggregateEquipmentStats([broken(helm), piece('probe_brust'), broken(boots)]);
    expect(stats.werte.ruestung).toBe(3);
    expect(stats.werte.tempo).toBe(0);
    expect(stats.ruestungsgewicht).toBe('schwer');
    expect(heaviestArmorWeight([helm])).toBe('leicht');
    expect(heaviestArmorWeight([helm, piece('probe_brust')])).toBe('mittel');
    expect(heaviestArmorWeight([piece('probe_ring')])).toBeNull();
    expect(aggregateEquipmentStats([])).toEqual({ werte: zeroStats(), ruestungsgewicht: null });
  });

  it('das System rechnet die Werte nur nach Änderungen neu und speist die Spieler-Modifikatoren', () => {
    const sim = new Simulation({ seed: 1 });
    const bags = new PlayerBags(catalog);
    const inventory = sim.addSystem(new InventorySystem(bags));
    const equipment = sim.addSystem(new EquipmentSystem(bags));
    const neutral = equipment.stats();
    expect(equipment.stats()).toBe(neutral);
    for (const item of ['probe_brust', 'probe_stiefel', 'probe_umhang']) inventory.give(sim, item, 1);
    for (let i = 0; i < 3; i++) sim.step([{ type: 'inventory.quickMove', from: inv(i) }]);
    expect(equipment.worn('brust')?.item).toBe('probe_brust');
    const stats = equipment.stats();
    expect(stats).not.toBe(neutral);
    expect(stats.werte.isolation).toBe(40);
    const mods = createPlayerModifiers();
    equipmentModifierSource(equipment)(sim, NULL_ENTITY, mods);
    expect(mods).toMatchObject({ armorWeight: 'schwer', insulation: 40, cooling: 3, maxHealthBonus: 10, maxStaminaBonus: 5 });
    expect(mods.moveSpeedFactor).toBeCloseTo(0.95, 10);
  });
});
