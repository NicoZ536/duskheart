/**
 * M4-04 Verarbeitungsstationen, Aufholen in der echten Simulation (MASTERPROMPT §15.1 "… holen in entladenen Chunks per
 * Zeitstempel auf"; docs/ARCHITEKTUR.md "Aufholen"): ein Lehmofen neben dem Spieler – 2 h Zeitsprung (Zone eingefroren,
 * Aufhol-Registry) ergibt dieselbe Station wie 2 h durchgehend tickend. Lief bis M7-75 in
 * tests/unit/game/verarbeitung-aufholen.test.ts und steht unverändert hier (ADR-0192: Läufe der ganzen Simulation in der
 * Integration, wie feld-aufholen und verderb-aufholen); die Aufhol-Regel selbst prüft die Unit-Datei auf einer
 * gezeichneten Stationswelt (ein Schritt, zwei Schritte, wechselnd aktiv und eingefroren).
 */
import { describe, expect, it } from 'vitest';
import { NULL_ENTITY } from '../../src/engine/ecs';
import type { InventorySystem } from '../../src/game/inventory/system';
import type { PlayerSystem } from '../../src/game/player/system';
import { createSimulation } from '../../src/game/setup';
import type { Simulation } from '../../src/game/sim';
import type { StationSystem } from '../../src/game/stations/system';
import { TILE_PX } from '../../src/world/model/coords';

/**
 * The whole game simulation ticks 7 200 times here (2 h game time, with the wildlife of the creature population since
 * M6): ≈ 2,3 s alone, up to three times that inside a loaded `npm run check`; the default 5 s is for small units.
 */
const FULL_SIM_TIMEOUT_MS = 30_000;

describe('Aufholen in der echten Simulation', { timeout: FULL_SIM_TIMEOUT_MS }, () => {
  /** A game simulation with the player, a clay oven with bricks and wood next to it; returns the systems. */
  function game(): { sim: Simulation; stations: StationSystem; oven: number } {
    const sim = createSimulation({ seed: 20260924, worldSize: 'small' });
    sim.step([{ type: 'player.spawn' }]);
    expect(sim.player).not.toBe(NULL_ENTITY);
    const player = sim.system('player') as PlayerSystem;
    const stations = sim.system('stations') as StationSystem;
    const inventory = sim.system('inventory') as InventorySystem;
    const at = { x: 0, y: 0 };
    player.position(sim, at);
    const ptx = Math.floor(at.x / TILE_PX);
    const pty = Math.floor(at.y / TILE_PX);
    let oven = 0;
    for (let r = 1; r <= 2 && oven === 0; r++) {
      for (const [dx, dy] of [[r, 0], [-r - 1, 0], [0, r], [0, -r - 1], [r, r], [-r - 1, -r - 1]] as const) {
        const id = stations.placeAt(sim, 'lehmofen', 0, ptx + dx, pty + dy);
        if (typeof id === 'number') {
          oven = id;
          break;
        }
      }
    }
    expect(oven).toBeGreaterThan(0);
    sim.step([
      { type: 'inventory.give', item: 'ziegel_roh', count: 6 },
      { type: 'inventory.give', item: 'holz', count: 3 },
    ]);
    const slot = (item: string): { bereich: 'inventar' | 'schnellleiste'; index: number } => {
      for (const bereich of ['schnellleiste', 'inventar'] as const) {
        const index = inventory.state[bereich].findIndex((s) => s?.item === item);
        if (index >= 0) return { bereich, index };
      }
      throw new Error(`no ${item}`);
    };
    sim.step([
      { type: 'station.put', station: oven, from: slot('ziegel_roh'), bereich: 'eingang' },
      { type: 'station.put', station: oven, from: slot('holz'), bereich: 'brennstoff' },
    ]);
    sim.events.drain(() => undefined);
    expect(stations.station(oven)?.proc?.eingang[0]).toEqual({ item: 'ziegel_roh', count: 6 });
    return { sim, stations, oven };
  }

  it('Zeitsprung um 2 h (Zone eingefroren, Aufhol-Registry) = 2 h durchgehend tickend', () => {
    const ticking = game();
    const jumped = game();
    jumped.sim.step([{ type: 'advanceTime', minutes: 120 }]);
    while (ticking.sim.tick < jumped.sim.tick) ticking.sim.step();
    expect(ticking.sim.tick).toBe(jumped.sim.tick);
    const a = ticking.stations.station(ticking.oven);
    const b = jumped.stations.station(jumped.oven);
    expect(b).toEqual(a);
    // In two hours (120 s real at the default day length) two batches are fired, the third one glows on.
    expect(a?.proc?.ausgang[0]).toEqual({ item: 'ziegel', count: 4 });
    expect(a?.proc?.rezept).toBe('rezept_ziegel');
  });
});
