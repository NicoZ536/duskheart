import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { demoScript, runHeadless } from '../../../src/game/headless';
import { createSimulation } from '../../../src/game/setup';
import { openSaveDb } from '../../../src/save/db';
import { MemorySaveStore } from '../../../src/save/memoryStore';
import { SaveError } from '../../../src/save/registry';
import type { SaveStore } from '../../../src/save/store';
import { MAIN_SLOT, captureSimulation, loadWorld, restoreSimulation, saveWorld, simulationRegistry } from '../../../src/save/world';

/** Build version the saves are written with (`__DH_VERSION__` in the browser). */
const BUILD = '0.1.0';

const stores: Array<[string, () => Promise<SaveStore>]> = [
  ['IndexedDB (fake-indexeddb)', () => openSaveDb(new IDBFactory())],
  ['memory', () => Promise.resolve(new MemorySaveStore())],
];

describe.each(stores)('world save/load: %s', (_name, openStore) => {
  it('save → load → continue gives the same hash as an uninterrupted run', async () => {
    const script = demoScript({ ticks: 1500, seed: 12 });
    const whole = runHeadless({ seed: 99, ticks: 1500, commands: script, config: { dayLengthMinutes: 12 } });
    const part = runHeadless({ seed: 99, ticks: 700, commands: script, config: { dayLengthMinutes: 12 } });
    const store = await openStore();
    const saved = await saveWorld(store, part.sim, { worldId: 'w1', name: 'Erste Welt', now: 1000, gameVersion: BUILD });
    expect(saved).toMatchObject({ id: 'w1', seed: 99, tick: 700, day: 1, createdAt: 1000, savedAt: 1000 });
    const loaded = await loadWorld(store, 'w1');
    expect(loaded).not.toBe(part.sim);
    expect(loaded.hashState()).toBe(part.sim.hashState());
    expect(loaded.config).toEqual(part.sim.config);
    const rest = runHeadless({ sim: loaded, ticks: 800, commands: script });
    expect(rest.hash).toBe(whole.hash);
    store.close();
  });

  it('keeps createdAt, updates savedAt and supports several slots', async () => {
    const store = await openStore();
    const sim = createSimulation({ seed: 1 });
    await saveWorld(store, sim, { worldId: 'w', name: 'W', now: 5, gameVersion: BUILD });
    sim.step();
    const again = await saveWorld(store, sim, { worldId: 'w', name: 'W', now: 9, gameVersion: BUILD, slot: 'autosave-0' });
    expect(again.createdAt).toBe(5);
    expect(again.savedAt).toBe(9);
    expect(await store.listSlots('w')).toEqual(['autosave-0', MAIN_SLOT]);
    expect((await loadWorld(store, 'w', 'autosave-0')).tick).toBe(1);
    expect((await loadWorld(store, 'w')).tick).toBe(0);
    store.close();
  });

  it('rejects missing worlds, missing slots and corrupted snapshots', async () => {
    const store = await openStore();
    await expect(loadWorld(store, 'nope')).rejects.toThrow(SaveError);
    const sim = createSimulation({ seed: 2 });
    await saveWorld(store, sim, { worldId: 'w', name: 'W', now: 1, gameVersion: BUILD });
    await expect(loadWorld(store, 'w', 'other')).rejects.toThrow(/no save in slot "other"/);
    const record = await store.getSlot('w', MAIN_SLOT);
    if (record === undefined) throw new Error('slot missing');
    const tampered = structuredClone(record.snapshot) as { participants: { clock: { data: { tick: number } } } };
    tampered.participants.clock.data.tick += 1;
    await store.write((b) => b.putSlot({ ...record, snapshot: tampered }));
    await expect(loadWorld(store, 'w')).rejects.toThrow(/is corrupt: hash/);
    store.close();
  });
});

describe('capture/restore', () => {
  it('captures every participant with an integrity hash', () => {
    const sim = createSimulation({ seed: 8 });
    const cap = captureSimulation(sim);
    expect(Object.keys(cap.snapshot.participants)).toEqual(simulationRegistry(sim).ids());
    expect(cap.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(restoreSimulation(cap.config, cap.snapshot).hashState()).toBe(sim.hashState());
  });
});
