/**
 * Review M6 im echten Spiel (`createSimulation`, src/game/setup.ts) – die Kopplung des Befunds
 * tests:hearth-spawn-wiring-untested: MASTERPROMPT §12.4 „Spawnt nur … außerhalb von Leuchtfeuer- und Herdzonen“, §16.5
 * „keine Schattenbrut-Spawns im Radius“. Der Nacht-Spawner der Kreaturen fragt das Herdfeuer-System der Simulation
 * (`creatures.useHearth(hearth)`): Ein brennendes Herdfeuer hält die Brut aus seinem Radius, während sie ringsum weiter
 * erscheint. (Leuchtfeuer kommen erst mit M7.)
 */
import { describe, expect, it } from 'vitest';
import type { EventArgs } from '../../../src/engine/events';
import type { BuildingSystem } from '../../../src/game/building/system';
import { parseGameCommand } from '../../../src/game/commands';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import type { HearthSystem } from '../../../src/game/hearth/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import type { LightSystem } from '../../../src/game/light/system';
import { BAG_AREAS, type SlotRef } from '../../../src/game/items/slots';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import { BALANCE } from '../../../src/content/balance';
import { TILE_PX } from '../../../src/world/model/coords';

/** The fixture world (small, seed 3; tools/save/fixture.ts). */
const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** A generated world and several game minutes of night: more than the default 5 s on a loaded machine. */
const TIMEOUT_MS = 120_000;
/** Spawner rounds watched (one every `intervalSeconds`). */
const ROUNDS = 10;
/** The player's distance east of the hearth's centre [tiles]: the brood's ring (16–40 tiles) runs through the hearth's zone. */
const PLAYER_EAST_TILES = 22;
type Ev = EventArgs<SimEventMap>;

function sys<T>(sim: Simulation, id: string): T {
  return sim.system(id) as unknown as T;
}

function run(sim: Simulation, commands: readonly unknown[] = [], ticks = 1): Ev[] {
  const out: Ev[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
    sim.events.drain((...e) => out.push(e));
  }
  return out;
}

function slotOf(sim: Simulation, item: string): SlotRef {
  const state = sys<InventorySystem>(sim, 'inventory').state;
  for (const area of BAG_AREAS) {
    const index = state[area].findIndex((s) => s !== null && s.item === item);
    if (index >= 0) return { bereich: area, index };
  }
  throw new Error(`no ${item} in the bags`);
}

function refused(events: readonly Ev[]): string[] {
  return events.filter((e) => e[0] === 'commandRejected').map((e) => JSON.stringify(e[1]));
}

describe('Herdfeuer und Nacht-Spawner im echten Spiel', () => {
  it(
    'ein brennendes Herdfeuer hält die Schattenbrut aus seinem Radius – ringsum erscheint sie weiter',
    () => {
      const sim = createSimulation(CONFIG);
      run(sim, [{ type: 'player.spawn' }], 30);
      run(sim, [{ type: 'setWeather', state: 'klar' }, { type: 'debug.god', on: true }]);
      run(sim, [
        { type: 'inventory.give', item: 'herdfeuer', count: 1 },
        { type: 'inventory.give', item: 'holz', count: 20 },
      ]);
      const building = sys<BuildingSystem>(sim, 'building');
      const p = { x: 0, y: 0 };
      sys<PlayerSystem>(sim, 'player').position(sim, p);
      const ptx = Math.floor(p.x / TILE_PX);
      const pty = Math.floor(p.y / TILE_PX);
      let site: { tx: number; ty: number } | null = null;
      for (let d = 2; d <= 8 && site === null; d++) {
        for (let dy = -d; dy <= d && site === null; dy++) {
          for (let dx = -d; dx <= d && site === null; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) === d && building.preview(sim, 'herdfeuer', ptx + dx, pty + dy) === null) site = { tx: ptx + dx, ty: pty + dy };
          }
        }
      }
      if (site === null) throw new Error('no free site for the hearth next to the spawn');
      expect(refused(run(sim, [{ type: 'build.place', part: 'herdfeuer', ...site }]))).toEqual([]);
      const hearth = sys<HearthSystem>(sim, 'hearth');
      const h = hearth.hearths[0];
      if (h === undefined) throw new Error('the hearth was not built');
      expect(refused(run(sim, [{ type: 'hearth.fuel', hearth: h.id, from: slotOf(sim, 'holz') }]))).toEqual([]);
      expect(refused(run(sim, [{ type: 'hearth.ignite', hearth: h.id }]))).toEqual([]);
      const centre = { x: (h.tx + h.w / 2) * TILE_PX, y: (h.ty + h.h / 2) * TILE_PX };
      const radius = hearth.radiusTiles(h) * TILE_PX;
      // What the creature system asks: the hearth system of this simulation (the object `createSimulation` hands it).
      let asked = 0;
      let blocked = 0;
      const rule = hearth.spawnBlocked.bind(hearth);
      (hearth as { spawnBlocked: HearthSystem['spawnBlocked'] }).spawnBlocked = (s, layer, x, y) => {
        asked++;
        const no = rule(s, layer, x, y);
        if (no) blocked++;
        return no;
      };
      run(sim, [{ type: 'setTime', hour: 23, minute: 0 }]);
      run(sim, [{ type: 'player.teleport', x: centre.x + PLAYER_EAST_TILES * TILE_PX, y: centre.y, layer: 0 }], 2);
      // The ring of the brood (16–40 tiles from the player) holds dark tiles inside the hearth's zone: there it may not come.
      const SB = BALANCE.spawn.shadowBrood;
      const map = sys<LightSystem>(sim, 'light').mapFor(sim);
      const player = { x: 0, y: 0 };
      sys<PlayerSystem>(sim, 'player').position(sim, player);
      let darkInZone = 0;
      for (let ty = Math.floor((centre.y - radius) / TILE_PX); ty <= Math.floor((centre.y + radius) / TILE_PX); ty++) {
        for (let tx = Math.floor((centre.x - radius) / TILE_PX); tx <= Math.floor((centre.x + radius) / TILE_PX); tx++) {
          const x = (tx + 1 / 2) * TILE_PX;
          const y = (ty + 1 / 2) * TILE_PX;
          const d = Math.hypot(x - player.x, y - player.y);
          if (d < SB.minTiles * TILE_PX || d > SB.maxTiles * TILE_PX || Math.hypot(x - centre.x, y - centre.y) > radius) continue;
          if (map.tileLevel(0, tx, ty) < SB.maxLight) darkInZone++;
        }
      }
      expect(darkInZone).toBeGreaterThan(0);
      const creatures = sys<CreatureSystem>(sim, 'creatures');
      const round = SB.intervalSeconds * BALANCE.time.tickHz;
      let brood = 0;
      const inside: string[] = [];
      for (let r = 0; r < ROUNDS; r++) {
        run(sim, [{ type: 'player.teleport', x: centre.x + PLAYER_EAST_TILES * TILE_PX, y: centre.y, layer: 0 }]);
        expect(hearth.burning(sim, h)).toBe(true);
        for (const e of run(sim, [], round + 5)) {
          if (e[0] !== 'creatureSpawned') continue;
          const s = e[1] as SimEventMap['creatureSpawned'];
          if (!creatures.catalog.get(s.creature).shadow) continue;
          brood++;
          if (Math.hypot(s.x - centre.x, s.y - centre.y) <= radius) inside.push(`${s.creature} at ${s.x},${s.y}`);
        }
        // The brood goes, so the spawner keeps spawning.
        run(sim, [{ type: 'creature.kill', radius: 60 }]);
      }
      // The spawner asked the hearth for its places, the brood came – none of it inside the burning hearth's zone.
      expect(asked).toBeGreaterThan(0);
      expect(asked).toBeGreaterThanOrEqual(blocked);
      expect(brood).toBeGreaterThan(0);
      expect(inside).toEqual([]);
    },
    TIMEOUT_MS,
  );
});
