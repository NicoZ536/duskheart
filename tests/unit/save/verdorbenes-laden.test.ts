/**
 * Spoiled food lies where the food spoiled, and a save of it loads (M7-29, docs/SPIEL.md §21 "Verderb … wird zu
 * `verdorbenes`"; §27 "jede Mechanik speicherbar"): an apple on the belt and bread in the pantry barrel turn into
 * `verdorbenes`, which neither slot takes from the player – the belt only consumables, the barrel only food, dishes and
 * drinks. The participants' load checks used the put rules and refused such a save ("does not fit there", "cannot
 * hold"); they now hold what spoiled in place (`slotHolds`, `containerHolds`), while putting it there stays refused.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { SPOILED_FOOD_ITEM, slotAccepts, slotHolds } from '../../../src/game/items/slots';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import { SPOILED_ITEM } from '../../../src/game/spoilage';
import { containerAccepts, containerHolds } from '../../../src/game/storage/formulas';
import { MemorySaveStore } from '../../../src/save/memoryStore';
import { loadWorld, saveWorld } from '../../../src/save/world';
import { lagerWelt } from '../game/lager-testwelt';
import { meadow } from '../game/spieler-testwelt';
import { catalog } from '../game/stationen-testwelt';

/** Steps `sim` with `commands` and `ticks − 1` more ticks; returns the refusal reasons. */
function run(sim: Simulation, commands: readonly unknown[], ticks = 1): string[] {
  const refused: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? (commands as Parameters<Simulation['step']>[0]) : undefined);
    sim.events.drain((type, payload) => {
      if (type === 'commandRejected') refused.push((payload as { reason: string }).reason);
    });
  }
  return refused;
}

describe('Verdorbenes bleibt liegen, wo es verdarb – und lädt', () => {
  it('die Regel: Gürtel und Vorratsfass halten Verdorbenes, nehmen es aber nicht an', () => {
    expect(SPOILED_ITEM).toBe(SPOILED_FOOD_ITEM);
    const spoiled = catalog.get(SPOILED_FOOD_ITEM);
    const belt = { bereich: 'guertel', index: 0 } as const;
    expect(slotAccepts(belt, spoiled)).toBe(false);
    expect(slotHolds(belt, spoiled)).toBe(true);
    // Anything else keeps the put rule on the belt.
    expect(slotHolds(belt, catalog.get('holz'))).toBe(false);
    const barrel = BALANCE.storage.containers.vorratsfass;
    if (barrel === undefined) throw new Error('no pantry barrel');
    expect(containerAccepts(barrel, spoiled)).toBe(false);
    expect(containerHolds(barrel, spoiled)).toBe(true);
    expect(containerHolds(barrel, catalog.get('holz'))).toBe(false);
  });

  it('ein Apfel am Gürtel verdirbt dort; der Spielstand lädt mit dem Verdorbenen am Gürtel, zurücklegen bleibt abgelehnt', async () => {
    const sim = createSimulation({ seed: 3, worldSize: 'small', dayLengthMinutes: 24 });
    expect(run(sim, [{ type: 'player.spawn' }], 30)).toEqual([]);
    expect(run(sim, [{ type: 'inventory.give', item: 'apfel', count: 3, frische: 5 }])).toEqual([]);
    const bags = (s: Simulation): InventorySystem => s.system('inventory') as unknown as InventorySystem;
    const index = bags(sim).state.inventar.findIndex((s) => s?.item === 'apfel');
    expect(run(sim, [{ type: 'inventory.move', from: { bereich: 'inventar', index }, to: { bereich: 'guertel', index: 0 }, count: 3 }])).toEqual([]);
    expect(run(sim, [{ type: 'spoilage.advance', hours: 200 }], 2)).toEqual([]);
    expect(bags(sim).state.guertel[0]).toEqual({ item: SPOILED_FOOD_ITEM, count: 3 });
    const store = new MemorySaveStore();
    await saveWorld(store, sim, { worldId: 'w', name: 'w', now: 1, gameVersion: 'test' });
    const loaded = await loadWorld(store, 'w');
    expect(bags(loaded).state.guertel[0]).toEqual({ item: SPOILED_FOOD_ITEM, count: 3 });
    expect(loaded.hashState()).toBe(sim.hashState());
    // Off the belt and back: the belt still takes only consumables.
    expect(run(loaded, [{ type: 'inventory.move', from: { bereich: 'guertel', index: 0 }, to: { bereich: 'inventar', index }, count: 3 }])).toEqual([]);
    expect(run(loaded, [{ type: 'inventory.move', from: { bereich: 'inventar', index }, to: { bereich: 'guertel', index: 0 }, count: 3 }])).not.toEqual([]);
  });

  it('das Vorratsfass: ein Spielstand mit verdorbenem Brot darin lädt, Fremdes wird weiter abgelehnt, hineinlegen nicht möglich', () => {
    const w = lagerWelt(meadow(24, 16), { x: 10, y: 8 });
    expect(w.build('vorratsfass', 12, 8)).toBeNull();
    const id = w.storage.chests[0]?.id ?? -1;
    w.give('brot', 2);
    w.act({ type: 'storage.put', chest: id, from: w.slotOf('brot') });
    const good = w.storage.save.serialize() as { chests: Array<Record<string, unknown> & { slots: unknown[] }>; nextId: number };
    const chest = good.chests[0] as Record<string, unknown> & { slots: unknown[] };
    expect(chest.slots[0]).toMatchObject({ item: 'brot', count: 2 });
    // The bread spoiled where it lay.
    const spoiled = { ...good, chests: [{ ...chest, slots: [{ item: SPOILED_FOOD_ITEM, count: 2 }, ...chest.slots.slice(1)] }] };
    expect(() => w.storage.save.deserialize(structuredClone(spoiled))).not.toThrow();
    expect(w.storage.chests[0]?.slots[0]).toEqual({ item: SPOILED_FOOD_ITEM, count: 2 });
    const wood = { ...good, chests: [{ ...chest, slots: [{ item: 'holz', count: 2 }, ...chest.slots.slice(1)] }] };
    expect(() => w.storage.save.deserialize(wood)).toThrow(TypeError);
    // The player cannot put spoiled food (or wood) into the barrel.
    w.give(SPOILED_FOOD_ITEM, 1);
    const refused = w.act({ type: 'storage.put', chest: id, from: w.slotOf(SPOILED_FOOD_ITEM) }).get('commandRejected') ?? [];
    expect(refused).toEqual([expect.objectContaining({ reason: 'wrongItem' })]);
  });
});
