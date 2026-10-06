/**
 * Test support for the map tests (karte, the roundtrip of `map`; strand B, M7-49): the player test world of spieler-testwelt.ts
 * (small world, 256² map cells) with the map system and a probe that raises a look-out tower's `towerClimbed` when armed.
 */
import { MapSystem } from '../../../src/game/map/system';
import type { SimSystem, Simulation } from '../../../src/game/sim';
import type { Layer } from '../../../src/world/model/coords';
import { meadow, OFFSET, testWorld, type TestWorld } from './spieler-testwelt';

/** Pushes a `towerClimbed` once when armed (a look-out tower's use, without the places system). */
export class TowerProbe implements SimSystem {
  readonly id = 'test-turm';
  readonly timeScope = 'global' as const;
  armed: { x: number; y: number; r: number } | null = null;
  update(sim: Simulation): void {
    if (this.armed === null) return;
    const a = this.armed;
    this.armed = null;
    sim.events.push('towerClimbed', { place: 2, ortstyp: 'aussichtsturm', radiusTiles: a.r, x: a.x, y: a.y, layer: 0, tick: sim.eventTick });
  }
}

export interface KarteWelt extends TestWorld {
  readonly map: MapSystem;
  readonly tower: TowerProbe;
  /** Whether the world tile at drawn offset (x, y) from the map origin is revealed on `layer`. */
  seen(x: number, y: number, layer?: Layer): boolean;
}

export function karteWelt(rows: readonly string[] = meadow(40, 40)): KarteWelt {
  const w = testWorld(rows);
  const tower = w.sim.addSystem(new TowerProbe());
  const map = w.sim.addSystem(new MapSystem(w.sim, { player: w.player }));
  return Object.assign(w, { map, tower, seen: (x: number, y: number, layer: Layer = 0) => map.revealed(layer, OFFSET + x, OFFSET + y) });
}
