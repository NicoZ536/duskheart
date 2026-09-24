import { describe, expect, it } from 'vitest';
import { PlayerBags } from '../../../../src/game/inventory/bags';
import { InventorySystem } from '../../../../src/game/inventory/system';
import { EquipmentSystem } from '../../../../src/game/equipment/system';
import { createSimulation } from '../../../../src/game/setup';
import { Simulation } from '../../../../src/game/sim';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { testCatalog } from '../../game/items-fixtures';

/** A simulation with bags over the test catalog (backpacks, tools and armour exist there). */
function fixtureSim(): { sim: Simulation; inventory: InventorySystem } {
  const sim = new Simulation({ seed: 3 });
  const bags = new PlayerBags(testCatalog());
  const inventory = sim.addSystem(new InventorySystem(bags));
  sim.addSystem(new EquipmentSystem(bags));
  return { sim, inventory };
}

describe('save roundtrip: inventory', () => {
  it('restores inventory, hotbar, freshness and the selected slot of the game simulation', () => {
    const report = expectRoundtrip(
      () => createSimulation({ seed: 5 }),
      (sim) => {
        const inventory = sim.system('inventory') as InventorySystem;
        inventory.give(sim, 'stein', 130);
        inventory.give(sim, 'himbeeren', 6, { frische: 40 });
        inventory.give(sim, 'himbeeren', 2);
        sim.step([{ type: 'inventory.move', from: { bereich: 'inventar', index: 1 }, to: { bereich: 'schnellleiste', index: 2 } }, { type: 'player.selectHotbar', index: 2 }]);
      },
      (sim) => sim.participant('inventory'),
    );
    expect(report.id).toBe('inventory');
    const data = JSON.parse(report.canonical) as { inventar: unknown[]; schnellleiste: unknown[]; auswahl: number };
    expect(data.inventar.slice(0, 3)).toEqual([{ item: 'stein', count: 100 }, null, { item: 'himbeeren', count: 8, frische: 55 }]);
    expect(data.schnellleiste[2]).toEqual({ item: 'stein', count: 30 });
    expect(data.auswahl).toBe(2);
  });

  it('restores a backpack with its compartment, durability, quality and extra data', () => {
    const report = expectRoundtrip(
      () => fixtureSim(),
      ({ sim, inventory }) => {
        inventory.give(sim, 'probe_rucksack_16', 1);
        sim.step([{ type: 'inventory.move', from: { bereich: 'inventar', index: 0 }, to: { bereich: 'rucksack', index: 0 } }]);
        inventory.give(sim, 'probe_axt', 1, { qualitaet: 3 });
        inventory.give(sim, 'stein', 100 * 30 + 7, { daten: { herkunft: 'strand' } });
      },
      ({ inventory }) => inventory.save,
    );
    const data = JSON.parse(report.canonical) as { rucksack: unknown; rucksackfach: unknown[]; schnellleiste: unknown[] };
    expect(data.rucksack).toEqual({ item: 'probe_rucksack_16', count: 1 });
    expect(data.rucksackfach).toHaveLength(16);
    expect(data.rucksackfach[0]).toEqual({ item: 'stein', count: 7, daten: { herkunft: 'strand' } });
    expect(data.schnellleiste[0]).toEqual({ item: 'probe_axt', count: 1, haltbarkeit: 72, qualitaet: 3 });
  });

  it('a full save and load gives the same state hash', () => {
    const a = createSimulation({ seed: 5 });
    (a.system('inventory') as InventorySystem).give(a, 'apfel', 13);
    const b = createSimulation({ seed: 5 });
    b.participant('inventory').deserialize(structuredClone(a.participant('inventory').serialize()));
    expect(b.participant('inventory').serialize()).toEqual(a.participant('inventory').serialize());
  });

  it('rejects malformed or inconsistent snapshots and keeps its state', () => {
    const { sim, inventory } = fixtureSim();
    inventory.give(sim, 'holz', 3);
    const good = inventory.save.serialize() as Record<string, unknown>;
    const inventar = good['inventar'] as unknown[];
    const withSlot = (slot: unknown, index = 1): unknown[] => inventar.map((s, i) => (i === index ? slot : s));
    const bad: unknown[] = [
      null,
      { ...good, auswahl: 10 },
      { ...good, inventar: inventar.slice(1) },
      { ...good, extra: true },
      { ...good, inventar: withSlot({ item: 'gibtsnicht', count: 1 }) },
      { ...good, inventar: withSlot({ item: 'holz', count: 101 }) },
      { ...good, inventar: withSlot({ item: 'himbeeren', count: 1 }) },
      { ...good, inventar: withSlot({ item: 'probe_axt', count: 1 }) },
      { ...good, rucksack: { item: 'holz', count: 1 } },
      { ...good, rucksackfach: [null] },
      { ...good, rucksack: { item: 'probe_rucksack_8', count: 1 }, rucksackfach: [] },
    ];
    for (const data of bad) expect(() => inventory.save.deserialize(data), JSON.stringify(data)).toThrow(TypeError);
    expect(inventory.save.serialize()).toEqual(good);
  });
});
