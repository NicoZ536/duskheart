/**
 * Speichern → Laden → weiter (docs/ARCHITEKTUR.md "Aktive Zone", ADR-0024): Der erste Tick nach dem Laden gleicht dem Tick
 * des ununterbrochenen Laufs (Review M6, savedet:first-tick-commands-before-zone und savedet:light-list-stale-after-load).
 * - Die beim Speichern aktiven Chunks sind vor dem ersten Tick wieder aktiv (`ActiveZone.resumeSaved` in `restoreInto`):
 *   Befehle dieses Ticks – eine Falle stellen, Kreaturen erscheinen lassen – finden die Zone, die der ununterbrochene Lauf
 *   hinterließ, statt einer eingefrorenen Welt ohne Kollisionsraster ("blocked").
 * - Neben einem brennenden Lagerfeuer in der kalten Winternacht gespeichert und geladen, wärmt das Feuer im ersten Tick wie
 *   ohne Speichern; der Lauf bleibt 600 Ticks lang Tick für Tick gleich.
 * Im Integrationsprojekt (M6-Gate, ADR-0036 Stufenleiter): 600 Ticks echter Simulation mit Speichern und Laden sind ein Lauf, kein
 * Unit-Test – `npm run check` bleibt im Budget, `npm run verify` prüft ihn.
 */
import { describe, expect, it } from 'vitest';
import type { EventArgs } from '../../src/engine/events';
import { parseGameCommand } from '../../src/game/commands';
import type { InventorySystem } from '../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../src/game/items/slots';
import type { LightSystem } from '../../src/game/light/system';
import type { PlayerSystem } from '../../src/game/player/system';
import { createSimulation } from '../../src/game/setup';
import type { SimEventMap, Simulation } from '../../src/game/sim';
import { MemorySaveStore } from '../../src/save/memoryStore';
import { loadWorld, saveWorld } from '../../src/save/world';
import { TILE_PX } from '../../src/world/model/coords';

const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** A generated world, a save, a load and hundreds of hashed ticks: more than the default 5 s on a loaded machine. */
const TIMEOUT_MS = 120_000;
type Ev = EventArgs<SimEventMap>;

function step(sim: Simulation, commands: readonly unknown[] = []): Ev[] {
  const out: Ev[] = [];
  sim.step(commands.map((c) => parseGameCommand(c)));
  sim.events.drain((...e) => out.push(e));
  return out;
}

function at(sim: Simulation): { x: number; y: number; tx: number; ty: number } {
  const p = { x: 0, y: 0 };
  if (!(sim.system('player') as unknown as PlayerSystem).position(sim, p)) throw new Error('no player');
  return { x: p.x, y: p.y, tx: Math.floor(p.x / TILE_PX), ty: Math.floor(p.y / TILE_PX) };
}

function slotOf(sim: Simulation, item: string): SlotRef {
  const state = (sim.system('inventory') as unknown as InventorySystem).state;
  for (const area of BAG_AREAS) {
    const index = state[area].findIndex((s) => s !== null && s.item === item);
    if (index >= 0) return { bereich: area, index };
  }
  throw new Error(`no ${item} in the bags`);
}

async function saveAndLoad(sim: Simulation): Promise<Simulation> {
  const store = new MemorySaveStore();
  await saveWorld(store, sim, { worldId: 'w', name: 'W', now: 1, gameVersion: 'test' });
  return loadWorld(store, 'w');
}

/** What a tick's events say about spawns, traps and refusals (entity ids included: they must match too). */
function outcome(events: readonly Ev[]): string[] {
  return events.filter((e) => e[0] === 'creatureSpawned' || e[0] === 'trapPlaced' || e[0] === 'commandRejected').map((e) => `${e[0]} ${JSON.stringify(e[1])}`);
}

describe('Der erste Tick nach dem Laden', () => {
  it(
    'Falle und Kreaturen im ersten Tick nach dem Laden: dieselben Ereignisse und derselbe Zustand wie ohne Speichern',
    async () => {
      const sim = createSimulation(CONFIG);
      step(sim, [{ type: 'player.spawn' }]);
      step(sim, [{ type: 'setWeather', state: 'klar' }, { type: 'debug.god', on: true }]);
      step(sim, [{ type: 'inventory.give', item: 'kastenfalle', count: 1 }]);
      for (let i = 0; i < 30; i++) step(sim);
      const loaded = await saveAndLoad(sim);
      expect(loaded.hashState()).toBe(sim.hashState());
      const p = at(sim);
      const first = [
        { type: 'creature.spawn', creature: 'wolf', count: 2, x: Math.round(p.x + 160), y: Math.round(p.y - 120), layer: 0 },
        { type: 'trap.place', from: slotOf(sim, 'kastenfalle'), tx: p.tx + 1, ty: p.ty + 1 },
      ];
      const uninterrupted = outcome(step(sim, first));
      const afterLoad = outcome(step(loaded, first));
      // The uninterrupted run sets the trap and spawns both wolves (the scene is open ground next to the player).
      expect(uninterrupted.filter((e) => e.startsWith('creatureSpawned'))).toHaveLength(2);
      expect(uninterrupted.filter((e) => e.startsWith('trapPlaced'))).toHaveLength(1);
      expect(uninterrupted.filter((e) => e.startsWith('commandRejected'))).toEqual([]);
      expect(afterLoad).toEqual(uninterrupted);
      for (let i = 0; i < 120; i++) {
        expect(loaded.hashState(), `Tick ${i + 1} nach dem Laden`).toBe(sim.hashState());
        step(sim);
        step(loaded);
      }
      expect(loaded.hashState()).toBe(sim.hashState());
    },
    TIMEOUT_MS,
  );

  it(
    'neben dem brennenden Lagerfeuer in der Winternacht gespeichert: 600 Ticks lang derselbe hashState()',
    async () => {
      const sim = createSimulation(CONFIG);
      step(sim, [{ type: 'player.spawn' }]);
      step(sim, [{ type: 'setSeason', season: 'winter' }]);
      step(sim, [{ type: 'setTime', hour: 23, minute: 0 }]);
      step(sim, [{ type: 'setWeather', state: 'klar' }, { type: 'debug.god', on: true }]);
      step(sim, [
        { type: 'inventory.give', item: 'lagerfeuer', count: 1 },
        { type: 'inventory.give', item: 'holz', count: 6 },
      ]);
      const light = sim.system('light') as unknown as LightSystem;
      const p = at(sim);
      for (const [dx, dy] of [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ] as const) {
        if (light.state.placed.length > 0) break;
        step(sim, [{ type: 'light.place', from: slotOf(sim, 'lagerfeuer'), tx: p.tx + dx, ty: p.ty + dy }]);
      }
      const fire = light.state.placed[0];
      if (fire === undefined) throw new Error('no free tile for the camp fire');
      step(sim, [{ type: 'light.fuel', light: fire.id, from: slotOf(sim, 'holz'), count: 6 }]);
      step(sim, [{ type: 'light.ignite', tx: fire.tx, ty: fire.ty }]);
      for (let i = 0; i < 120; i++) step(sim);
      expect(fire.fire?.lit).toBe(true);
      const vitals = (s: Simulation): { heatC: number; feltC: number } => {
        const v = (s.system('vitals') as unknown as { vitalsOf(x: Simulation): { heatC: number; feltC: number } | undefined }).vitalsOf(s);
        if (v === undefined) throw new Error('no vitals');
        return v;
      };
      // The fire warms the player in the cold.
      expect(vitals(sim).heatC).toBeGreaterThan(0);
      const loaded = await saveAndLoad(sim);
      expect(loaded.hashState()).toBe(sim.hashState());
      for (let i = 0; i < 600; i++) {
        step(sim);
        step(loaded);
        if (i === 0) expect(vitals(loaded).heatC, 'Wärme im ersten Tick nach dem Laden').toBe(vitals(sim).heatC);
        expect(loaded.hashState(), `Tick ${i + 1} nach dem Laden`).toBe(sim.hashState());
      }
    },
    TIMEOUT_MS,
  );
});
