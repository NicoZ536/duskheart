/**
 * Loaded, the observers check their state-like triggers when the running world would (M7-41 … M7-47; docs/SPIEL.md §28
 * "Determinismus": saved and loaded runs on tick for tick like the uninterrupted one). A state-like trigger – a condition,
 * an item carried, a statistic's total – is checked on the world tick or in a step in which a statistic counted. The
 * revision counter behind "a statistic counted" is not saved: a loaded observer took every first step for "counted" and
 * checked them all, so a hint whose condition came true after the last world tick held a world tick early in the loaded
 * copy only (strand E saw `hinweis_zerlegen` queued after loading). Here a fish trap comes into the bags right after a world
 * tick (`hinweis_reuse`: carrying one), the world is saved and loaded at once, and both run on past the next world tick: the
 * guide, the statistics, achievements, chronicle and quests stay equal in every tick.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import { canonicalJson } from '../../../src/save/canonical';
import { MemorySaveStore } from '../../../src/save/memoryStore';
import { loadWorld, saveWorld } from '../../../src/save/world';

const OBSERVERS = ['stats', 'achievements', 'chronicle', 'quests', 'guide'] as const;

function observed(sim: Simulation): Record<string, string> {
  return Object.fromEntries(OBSERVERS.map((id) => [id, canonicalJson(sim.participant(id).serialize())]));
}

function queued(sim: Simulation): string[] {
  const g = sim.participant('guide').serialize() as { warteschlange: Array<{ hint: string }>; funke: { id: string } | null; hinweis: { id: string } | null };
  return [...g.warteschlange.map((p) => p.hint), ...(g.hinweis === null ? [] : [g.hinweis.id]), ...(g.funke === null ? [] : [g.funke.id])];
}

describe('Beobachter nach dem Laden', () => {
  it('eine Reuse nach dem Welttick: geladen hält der Hinweis erst am nächsten Welttick, wie ohne Speichern', async () => {
    const sim = createSimulation({ seed: 3, worldSize: 'small', dayLengthMinutes: 24 });
    sim.step([{ type: 'player.spawn' }]);
    for (let i = 0; i < 120; i++) sim.step();
    const interval = sim.clock.worldTickInterval;
    // Right after a world tick: the next one is a whole interval away.
    while (sim.tick % interval !== 1) sim.step();
    sim.events.clear();
    sim.step([{ type: 'inventory.give', item: 'reuse', count: 1 }]);
    sim.events.clear();
    expect(queued(sim)).not.toContain('hinweis_reuse');
    const store = new MemorySaveStore();
    await saveWorld(store, sim, { worldId: 'w', name: 'w', now: 1, gameVersion: 'test' });
    const loaded = await loadWorld(store, 'w');
    expect(observed(loaded)).toEqual(observed(sim));
    let held = -1;
    for (let i = 0; i <= interval; i++) {
      sim.step();
      loaded.step();
      sim.events.clear();
      loaded.events.clear();
      expect(observed(loaded), `tick ${sim.tick}`).toEqual(observed(sim));
      if (held < 0 && queued(sim).includes('hinweis_reuse')) held = sim.tick;
    }
    // The running world held the trap hint on its world tick – and so did the loaded one, not earlier.
    expect(held % interval).toBe(0);
    expect(loaded.hashState()).toBe(sim.hashState());
  });
});
