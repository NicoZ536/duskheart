/**
 * Fast variant of the headless integration test for `npm run check`: same properties as
 * headless.test.ts with fewer ticks.
 */
import { describe, expect, it } from 'vitest';
import { demoScript, runHeadless } from '../../src/game/headless';
import { MemorySaveStore } from '../../src/save/memoryStore';
import { loadWorld, saveWorld } from '../../src/save/world';

/** Build version the saves are written with (`__DH_VERSION__` in the browser). */
const BUILD = '0.1.0';

const TICKS = 1_500;
const SEED = 7;
const SCRIPT = demoScript({ ticks: TICKS, seed: 99 });

describe('headless simulation (fast)', () => {
  it('two runs with the same seed and commands produce the identical hash', () => {
    const a = runHeadless({ seed: SEED, ticks: TICKS, commands: SCRIPT });
    const b = runHeadless({ seed: SEED, ticks: TICKS, commands: SCRIPT });
    expect(b.hash).toBe(a.hash);
    expect(a.events.entitySpawned).toBeGreaterThan(40);
    // The world took part: active zone around the controlled entity, weather, chunk changes in the hash.
    expect(a.sim.world.zone.size).toBeGreaterThanOrEqual(25);
    const chunk = a.sim.world.zone.chunks[0];
    if (chunk === undefined) throw new Error('no active chunk');
    chunk.height[0] = (chunk.height[0] as number) + 1;
    expect(a.sim.hashState()).not.toBe(b.hash);
  });

  it('a different seed produces a different hash', () => {
    const a = runHeadless({ seed: SEED, ticks: TICKS, commands: SCRIPT });
    expect(runHeadless({ seed: SEED + 1, ticks: TICKS, commands: SCRIPT }).hash).not.toBe(a.hash);
  });

  it('save → load → continue equals the uninterrupted run', async () => {
    const whole = runHeadless({ seed: SEED, ticks: TICKS, commands: SCRIPT });
    const store = new MemorySaveStore();
    const first = runHeadless({ seed: SEED, ticks: 777, commands: SCRIPT });
    await saveWorld(store, first.sim, { worldId: 'fast', name: 'Fast', now: 1, gameVersion: BUILD });
    const loaded = await loadWorld(store, 'fast');
    expect(runHeadless({ sim: loaded, ticks: TICKS - 777, commands: SCRIPT }).hash).toBe(whole.hash);
  });
});
