/**
 * Die Basis im echten Spiel (`createSimulation`, M4-20, M4-21, M4-28): Herdfeuer, Kisten und Feuer mit den Kopplungen
 * von src/game/setup.ts auf der generierten Welt –
 * - das Herdfeuer steht im Bau-Raster, brennt, leuchtet in der Lichtquellenliste, wärmt den Spieler und sperrt Spawns;
 *   fern vom Spieler eingefroren holt es über die Aktive Zone auf (Zeitsprung) und ist dann wie ein durchgehend
 *   brennendes;
 * - E öffnet eine Kiste und ein Herdfeuer – auch ein kaltes mit Brennstoff (entzündet wird im Bildschirm,
 *   `hearth.ignite`); die Werkbank nimmt aus der Kiste;
 * - eine brennende Fackel in der Nebenhand setzt eine Holzwand in Brand (`light.ignite` → Feuer-Simulation).
 */
import { describe, expect, it } from 'vitest';
import type { EventArgs } from '../../../src/engine/events';
import type { BuildingSystem } from '../../../src/game/building/system';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import type { FireSystem } from '../../../src/game/fire/system';
import type { HearthSystem } from '../../../src/game/hearth/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../../src/game/items/slots';
import type { LightSystem } from '../../../src/game/light/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import type { StorageSystem } from '../../../src/game/storage/system';
import { TILE_PX } from '../../../src/world/model/coords';

const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
type Ev = EventArgs<SimEventMap>;

interface Game {
  readonly sim: Simulation;
  run(commands?: readonly GameCommand[], ticks?: number): Ev[];
  sys<T>(id: string): T;
  tile(): { tx: number; ty: number };
}

function game(): Game {
  const sim = createSimulation(CONFIG);
  const run = (commands: readonly GameCommand[] = [], ticks = 1): Ev[] => {
    const out: Ev[] = [];
    for (let i = 0; i < ticks; i++) {
      sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      sim.events.drain((...e) => out.push(e));
    }
    return out;
  };
  const sys = <T>(id: string): T => sim.system(id) as unknown as T;
  const tile = (): { tx: number; ty: number } => {
    const at = { x: 0, y: 0 };
    if (!sys<PlayerSystem>('player').position(sim, at)) throw new Error('no player');
    return { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
  };
  run([{ type: 'player.spawn' }], 30);
  run([{ type: 'setWeather', state: 'klar' }]);
  return { sim, run, sys, tile };
}

function of<K extends keyof SimEventMap>(events: readonly Ev[], type: K): SimEventMap[K][] {
  return events.filter((e) => e[0] === type).map((e) => e[1] as SimEventMap[K]);
}

/** The first anchor within `r` tiles of the player where `part` may be placed now (ghost preview). */
function spot(g: Game, part: string, r = 6): { tx: number; ty: number } {
  const building = g.sys<BuildingSystem>('building');
  const inventory = g.sys<InventorySystem>('inventory');
  if (inventory.count(part) < 1) g.run([{ type: 'inventory.give', item: part, count: 1 }]);
  const p = g.tile();
  for (let d = 2; d <= r; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        if (building.preview(g.sim, part, p.tx + dx, p.ty + dy) === null) return { tx: p.tx + dx, ty: p.ty + dy };
      }
    }
  }
  throw new Error(`no spot for ${part}`);
}

/** The first bag slot holding `item`. */
function slotOf(g: Game, item: string): SlotRef {
  const state = g.sys<InventorySystem>('inventory').state;
  for (const area of BAG_AREAS) {
    const index = state[area].findIndex((s) => s !== null && s.item === item);
    if (index >= 0) return { bereich: area, index };
  }
  throw new Error(`no ${item} in the bags`);
}

/** Puts the player on the tile south of (tx, ty). */
function standBelow(g: Game, tx: number, ty: number): void {
  g.run([{ type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 1.5) * TILE_PX, layer: 0 }], 2);
}

function place(g: Game, part: string): { tx: number; ty: number } {
  const at = spot(g, part);
  const ev = g.run([{ type: 'build.place', part, ...at }]);
  expect(of(ev, 'commandRejected')).toEqual([]);
  return at;
}

/** Two simulations of the generated world and their ticks: more than the default 5 s on a loaded machine. */
const FULL_SIM_TIMEOUT_MS = 30_000;

describe('Die Basis in createSimulation', { timeout: FULL_SIM_TIMEOUT_MS }, () => {
  it('Herdfeuer: brennt, leuchtet, wärmt, sperrt Spawns; eingefroren und aufgeholt wie durchgehend brennend', () => {
    const ticking = game();
    const frozen = game();
    for (const g of [ticking, frozen]) {
      place(g, 'herdfeuer');
      const hearth = g.sys<HearthSystem>('hearth');
      const h = hearth.hearths[0];
      if (h === undefined) throw new Error('no hearth');
      g.run([{ type: 'inventory.give', item: 'holz', count: 5 }]);
      g.run([{ type: 'hearth.fuel', hearth: h.id, from: slotOf(g, 'holz') }]);
      expect(of(g.run([{ type: 'hearth.ignite', hearth: h.id }]), 'hearthIgnited')).toHaveLength(1);
      const light = g.sys<LightSystem>('light');
      expect(light.sources(g.sim).some((l) => l.kind === 'herdfeuer')).toBe(true);
      const c = { x: (h.tx + 1.5) * TILE_PX, y: (h.ty + 1.5) * TILE_PX };
      expect(hearth.spawnBlocked(g.sim, 0, c.x + 5 * TILE_PX, c.y)).toBe(true);
      expect(light.levelAt(g.sim, 0, c.x, c.y + 2 * TILE_PX)).toBeGreaterThan(0.5);
    }
    const minutes = 10;
    const ticks = minutes * (ticking.sim.clock.ticksPerGameHour / 60);
    ticking.run([], ticks);
    // Far away the hearth's chunk freezes; the time jump and the return let it catch up.
    const home = frozen.tile();
    frozen.run([{ type: 'player.teleport', x: (home.tx + 300) * TILE_PX, y: home.ty * TILE_PX, layer: 0 }], 2);
    frozen.run([{ type: 'advanceTime', minutes }]);
    frozen.run([{ type: 'player.teleport', x: (home.tx + 0.5) * TILE_PX, y: (home.ty + 0.5) * TILE_PX, layer: 0 }], 1);
    const rest = (g: Game): unknown => {
      const h = g.sys<HearthSystem>('hearth').hearths[0];
      return h === undefined ? null : { lit: h.lit, rest: h.rest, vorrat: h.vorrat, bis: h.bis };
    };
    const tickDiff = frozen.sim.tick - ticking.sim.tick;
    ticking.run([], tickDiff);
    expect(rest(frozen)).toEqual(rest(ticking));
  });

  it('E öffnet eine Kiste, E öffnet ein kaltes Herdfeuer mit Brennstoff (Review M4 #24), sein Knopf entzündet es; die Werkbank nimmt aus der Kiste', () => {
    const g = game();
    const chestAt = place(g, 'kiste_holz');
    const storage = g.sys<StorageSystem>('storage');
    const chest = storage.chests[0];
    if (chest === undefined) throw new Error('no chest');
    standBelow(g, chestAt.tx, chestAt.ty);
    const opened = g.run([{ type: 'player.interact', on: true, ...chestAt }], 2);
    g.run([{ type: 'player.interact', on: false }]);
    expect(of(opened, 'chestOpened')).toEqual([expect.objectContaining({ chest: chest.id })]);
    g.run([{ type: 'inventory.give', item: 'fasern', count: 3 }]);
    g.run([{ type: 'storage.put', chest: chest.id, from: slotOf(g, 'fasern') }]);
    const craft = g.run([{ type: 'craft.start', recipe: 'rezept_faserseil', count: 1 }]);
    expect(of(craft, 'chestTaken')).toEqual([expect.objectContaining({ taken: 'fasern', by: 'handwerk' })]);
    const hearthAt = place(g, 'herdfeuer');
    const hearth = g.sys<HearthSystem>('hearth').hearths[0];
    if (hearth === undefined) throw new Error('no hearth');
    g.run([{ type: 'inventory.give', item: 'holzkohle', count: 1 }]);
    standBelow(g, hearthAt.tx + 1, hearthAt.ty + 2);
    g.run([{ type: 'hearth.fuel', hearth: hearth.id, from: slotOf(g, 'holzkohle') }]);
    // E on the cold hearth with fuel opens its screen (the fuel can be taken out again); it does not light it.
    const pressed = g.run([{ type: 'player.interact', on: true, tx: hearthAt.tx + 1, ty: hearthAt.ty + 2 }], 2);
    g.run([{ type: 'player.interact', on: false }]);
    expect(of(pressed, 'hearthOpened')).toEqual([expect.objectContaining({ hearth: hearth.id })]);
    expect(of(pressed, 'hearthIgnited')).toEqual([]);
    expect(g.sys<HearthSystem>('hearth').hearths[0]?.lit).toBe(false);
    // The screen's button lights it.
    expect(of(g.run([{ type: 'hearth.ignite', hearth: hearth.id }]), 'hearthIgnited')).toHaveLength(1);
  });

  it('eine brennende Fackel in der Nebenhand setzt eine Holzwand in Brand', () => {
    const g = game();
    const wall = place(g, 'wand_holz');
    g.run([{ type: 'inventory.give', item: 'fackel', count: 1 }]);
    g.run([{ type: 'inventory.move', from: slotOf(g, 'fackel'), to: { bereich: 'ausruestung', index: 5 } }]);
    g.run([{ type: 'light.toggle' }], 2);
    // Walk next to the wall (the torch reaches the tiles in interaction reach).
    g.run([{ type: 'player.teleport', x: (wall.tx + 0.5) * TILE_PX, y: (wall.ty + 1.5) * TILE_PX, layer: 0 }], 2);
    const ev = g.run([{ type: 'light.ignite', ...wall }]);
    expect(of(ev, 'commandRejected')).toEqual([]);
    expect(of(ev, 'fireStarted')).toEqual([expect.objectContaining({ cause: 'fackel', tx: wall.tx, ty: wall.ty })]);
    const fire = g.sys<FireSystem>('fire');
    expect(fire.burningAt(0, wall.tx, wall.ty)).toBe(true);
    const burned = g.run([], 5 * 60 + 5);
    expect(of(burned, 'partDamaged').length).toBeGreaterThanOrEqual(5);
    expect(g.sys<LightSystem>('light').sources(g.sim).some((l) => l.kind === 'brand')).toBe(true);
  });
});
