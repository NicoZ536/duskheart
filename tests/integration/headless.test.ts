/**
 * M0-15 headless simulation (MASTERPROMPT §31.2): 10 000 ticks with scripted commands in Node,
 * no render/audio/UI. Determinism across runs, seed dependence, save → load → continue.
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { demoScript, runHeadless } from '../../src/game/headless';
import { openSaveDb } from '../../src/save/db';
import { MemorySaveStore } from '../../src/save/memoryStore';
import { loadWorld, saveWorld } from '../../src/save/world';

const TICKS = 10_000;
const SEED = 1337;
const SCRIPT = demoScript({ ticks: TICKS, seed: 4242 });

describe('headless simulation (10 000 ticks)', () => {
  it('two runs with the same seed and commands produce the identical hash', () => {
    const a = runHeadless({ seed: SEED, ticks: TICKS, commands: SCRIPT });
    const b = runHeadless({ seed: SEED, ticks: TICKS, commands: SCRIPT });
    expect(a.sim.tick).toBe(TICKS);
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(b.hash).toBe(a.hash);
    expect(b.events).toEqual(a.events);
    // The script really exercised the simulation.
    expect(a.events.entitySpawned).toBeGreaterThan(80);
    expect(a.events.entityDespawned).toBeGreaterThan(30);
    expect(a.events.commandRejected).toBeGreaterThan(0);
    expect(a.events.worldTick).toBe(Math.floor(TICKS / 60));
  });

  it('a different seed produces a different hash', () => {
    const a = runHeadless({ seed: SEED, ticks: TICKS, commands: SCRIPT });
    const c = runHeadless({ seed: SEED + 1, ticks: TICKS, commands: SCRIPT });
    expect(c.hash).not.toBe(a.hash);
  });

  it('runs a full 12 minute day across 06:00 deterministically', () => {
    const dayTicks = 12 * 60 * 60; // 12 real minutes at 60 Hz
    const ticks = dayTicks + 600;
    const script = demoScript({ ticks, seed: 77, worldSize: 'small' });
    const config = { dayLengthMinutes: 12, worldSize: 'small' } as const;
    const a = runHeadless({ seed: SEED, ticks, commands: script, config });
    expect(a.events.dailyTick).toBe(1);
    expect(a.sim.clock.day).toBe(2);
    expect([a.sim.clock.hour, a.sim.clock.minute]).toEqual([6, 20]);
    const b = runHeadless({ seed: SEED, ticks, commands: script, config });
    expect(b.hash).toBe(a.hash);
  });

  for (const [name, open] of [
    ['IndexedDB (fake-indexeddb)', () => openSaveDb(new IDBFactory())],
    ['memory store', () => Promise.resolve(new MemorySaveStore())],
  ] as const) {
    it(`save → load → continue equals the uninterrupted run (${name})`, async () => {
      const whole = runHeadless({ seed: SEED, ticks: TICKS, commands: SCRIPT });
      const store = await open();
      let sim = runHeadless({ seed: SEED, ticks: 3_333, commands: SCRIPT }).sim;
      await saveWorld(store, sim, { worldId: 'integration', name: 'Integration', now: 1 });
      sim = await loadWorld(store, 'integration');
      expect(sim.tick).toBe(3_333);
      // Save a second time mid-way to cover repeated save/load cycles.
      sim = runHeadless({ sim, ticks: 3_000, commands: SCRIPT }).sim;
      await saveWorld(store, sim, { worldId: 'integration', name: 'Integration', now: 2 });
      sim = await loadWorld(store, 'integration');
      const rest = runHeadless({ sim, ticks: TICKS - 6_333, commands: SCRIPT });
      expect(rest.sim.tick).toBe(TICKS);
      expect(rest.hash).toBe(whole.hash);
      store.close();
    });
  }
});
