/**
 * Die Lichtquellenliste folgt der aktiven Zone auch mitten im Tick (Review M6, savedet:light-list-stale-after-load): Der
 * erste Systemschritt eines Ticks aktiviert Chunks nacheinander, und ein Zonen-Zuhörer (die Kreaturen) liest dazwischen das
 * Licht. Die Liste dieses Ticks darf danach die Lichter der später aktivierten Chunks nicht auslassen – sonst wärmt ein
 * Lagerfeuer, zu dem der Spieler zurückkehrt, in diesem Tick nicht (`LightEnvironment.activeVersion`, `ActiveZone.version`).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { parseGameCommand } from '../../../src/game/commands';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../../src/game/items/slots';
import type { LightSystem } from '../../../src/game/light/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import { CHUNK_SHIFT, CHUNK_SIZE, TILE_PX } from '../../../src/world/model/coords';

/** A generated world and a few hundred ticks: more than the default 5 s on a loaded machine. */
const TIMEOUT_MS = 60_000;

function step(sim: Simulation, commands: readonly unknown[] = [], ticks = 1): void {
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
    sim.events.drain(() => undefined);
  }
}

function slotOf(sim: Simulation, item: string): SlotRef {
  const state = (sim.system('inventory') as unknown as InventorySystem).state;
  for (const area of BAG_AREAS) {
    const index = state[area].findIndex((s) => s !== null && s.item === item);
    if (index >= 0) return { bereich: area, index };
  }
  throw new Error(`no ${item} in the bags`);
}

function heatC(sim: Simulation): number {
  const v = (sim.system('vitals') as unknown as { vitalsOf(s: Simulation): { heatC: number } | undefined }).vitalsOf(sim);
  if (v === undefined) throw new Error('no vitals');
  return v.heatC;
}

describe('Lichtquellen und aktive Zone', () => {
  it(
    'zurück am brennenden Lagerfeuer: es wärmt schon im Tick, in dem sein Chunk wieder aktiv wird',
    () => {
      const sim = createSimulation({ seed: 1, worldSize: 'small', dayLengthMinutes: 24 });
      step(sim, [{ type: 'player.spawn' }], 2);
      step(sim, [{ type: 'setWeather', state: 'klar' }, { type: 'debug.god', on: true }]);
      step(sim, [
        { type: 'inventory.give', item: 'lagerfeuer', count: 1 },
        { type: 'inventory.give', item: 'holz', count: 8 },
      ]);
      const p = { x: 0, y: 0 };
      (sim.system('player') as unknown as PlayerSystem).position(sim, p);
      const tx = Math.floor(p.x / TILE_PX);
      const ty = Math.floor(p.y / TILE_PX);
      const light = sim.system('light') as unknown as LightSystem;
      for (const [dx, dy] of [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ] as const) {
        if (light.state.placed.length > 0) break;
        step(sim, [{ type: 'light.place', from: slotOf(sim, 'lagerfeuer'), tx: tx + dx, ty: ty + dy }]);
      }
      const fire = light.state.placed[0];
      if (fire === undefined) throw new Error('no free tile for the camp fire');
      step(sim, [{ type: 'light.fuel', light: fire.id, from: slotOf(sim, 'holz'), count: 8 }]);
      step(sim, [{ type: 'light.ignite', tx: fire.tx, ty: fire.ty }]);
      const warm = heatC(sim);
      expect(warm).toBeGreaterThan(0);
      // Far away (beyond radius + hysteresis): the fire's chunk freezes, the fire warms nobody.
      const far = (BALANCE.stream.activeRadiusChunks + BALANCE.stream.hysteresisChunks + 2) * CHUNK_SIZE * TILE_PX;
      step(sim, [{ type: 'player.teleport', x: p.x, y: p.y - far, layer: 0 }], 120);
      expect(sim.world.zone.isActive(0, fire.tx >> CHUNK_SHIFT, fire.ty >> CHUNK_SHIFT)).toBe(false);
      expect(heatC(sim)).toBe(0);
      // Back: the zone activates the chunks around the player one by one, the fire's not first; the creatures' zone listener
      // reads the light at every activation. The vitals of the same tick feel the fire.
      const versionBefore = sim.world.zone.version;
      step(sim, [{ type: 'player.teleport', x: p.x, y: p.y, layer: 0 }]);
      expect(sim.world.zone.version).toBeGreaterThan(versionBefore);
      expect(fire.fire?.lit).toBe(true);
      expect(heatC(sim)).toBe(warm);
    },
    TIMEOUT_MS,
  );
});
