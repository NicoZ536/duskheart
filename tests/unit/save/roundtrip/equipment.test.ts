import { describe, expect, it } from 'vitest';
import { PlayerBags } from '../../../../src/game/inventory/bags';
import { InventorySystem } from '../../../../src/game/inventory/system';
import { EquipmentSystem } from '../../../../src/game/equipment/system';
import { createSimulation } from '../../../../src/game/setup';
import { Simulation } from '../../../../src/game/sim';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { testCatalog } from '../../game/items-fixtures';

function fixtureSim(): { sim: Simulation; inventory: InventorySystem; equipment: EquipmentSystem } {
  const sim = new Simulation({ seed: 3 });
  const bags = new PlayerBags(testCatalog());
  const inventory = sim.addSystem(new InventorySystem(bags));
  const equipment = sim.addSystem(new EquipmentSystem(bags));
  return { sim, inventory, equipment };
}

const inv = (index: number) => ({ bereich: 'inventar' as const, index });

describe('save roundtrip: equipment', () => {
  it('restores the belt of the game simulation', () => {
    const report = expectRoundtrip(
      () => createSimulation({ seed: 6 }),
      (sim) => {
        (sim.system('inventory') as InventorySystem).give(sim, 'walnuss', 12, { frische: 90 });
        sim.step([{ type: 'inventory.move', from: inv(0), to: { bereich: 'guertel', index: 2 }, count: 5 }]);
      },
      (sim) => sim.participant('equipment'),
    );
    expect(report.id).toBe('equipment');
    expect(JSON.parse(report.canonical)).toMatchObject({ guertel: [null, null, { item: 'walnuss', count: 5, frische: 90 }] });
  });

  it('restores worn pieces by slot, including worn and broken durability', () => {
    const report = expectRoundtrip(
      () => fixtureSim(),
      ({ sim, inventory, equipment }) => {
        for (const item of ['probe_helm', 'probe_ring', 'probe_amulett', 'probe_schild']) inventory.give(sim, item, 1, item === 'probe_helm' ? { qualitaet: 2 } : {});
        // Rings and helmet go to the inventory, the shield (held in the hand) to the hotbar first.
        sim.step([
          ...[0, 1, 2].map((i) => ({ type: 'inventory.quickMove' as const, from: inv(i) })),
          { type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: { bereich: 'ausruestung', index: 5 } },
        ]);
        equipment.wear(sim, { bereich: 'ausruestung', index: 0 }, 6);
        equipment.wear(sim, { bereich: 'ausruestung', index: 5 }, 60);
      },
      ({ equipment }) => equipment.save,
    );
    expect(JSON.parse(report.canonical)).toMatchObject({
      ausruestung: {
        kopf: { item: 'probe_helm', count: 1, haltbarkeit: 60, qualitaet: 2 },
        nebenhand: { item: 'probe_schild', count: 1, haltbarkeit: 0 },
        schmuck1: { item: 'probe_ring', count: 1 },
        schmuck2: { item: 'probe_amulett', count: 1 },
        brust: null,
      },
    });
  });

  it('restored equipment gives the same stats', () => {
    const a = fixtureSim();
    a.inventory.give(a.sim, 'probe_brust', 1);
    a.sim.step([{ type: 'inventory.quickMove', from: inv(0) }]);
    const b = fixtureSim();
    b.equipment.save.deserialize(structuredClone(a.equipment.save.serialize()));
    expect(b.equipment.stats()).toEqual(a.equipment.stats());
    expect(b.equipment.stats().werte.isolation).toBe(30);
  });

  it('rejects malformed or inconsistent snapshots and keeps its state', () => {
    const { equipment } = fixtureSim();
    const good = equipment.save.serialize() as { ausruestung: Record<string, unknown>; guertel: unknown[] };
    const bad: unknown[] = [
      null,
      { ...good, guertel: [null, null] },
      { ...good, ausruestung: { ...good.ausruestung, handschuhe: null } },
      { ...good, ausruestung: { ...good.ausruestung, kopf: { item: 'probe_brust', count: 1, haltbarkeit: 60 } } },
      { ...good, ausruestung: { ...good.ausruestung, kopf: { item: 'probe_helm', count: 1 } } },
      { ...good, guertel: [{ item: 'stein', count: 1 }, null, null] },
    ];
    for (const data of bad) expect(() => equipment.save.deserialize(data), JSON.stringify(data)).toThrow(TypeError);
    expect(equipment.save.serialize()).toEqual(good);
  });
});
