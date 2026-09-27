/**
 * Review M4 im echten Spiel (`createSimulation`, src/game/setup.ts) – die Kopplungen der Befunde #2, #12, #13 und #14:
 * - #2: Werkbank aus den Taschen aufgestellt, das Aufwertungsrezept läuft, Strg+Z (`station.remove`) wird abgelehnt – am
 *   Ende steht Werkbank II, und es gibt weder eine zweite Werkbank noch ein Werkbank-II-Item.
 * - #12: das Harz einer Lampe, die fällt (ihre Wand abgebaut) oder zerstört wird, fällt an der Lampe zu Boden – nur beim
 *   Abbauen durch den Spieler kommt es in die Taschen.
 * - #13: eine kalte Lampe macht aus Bett und Lampe keinen Schlafraum; brennend meldet das Lichtsystem sie dem Raum.
 * - #14: eine Werkbank in der Werkstatt arbeitet 15 % schneller, auch wenn der Spieler draußen vor der Tür steht.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { EventArgs } from '../../../src/engine/events';
import type { BuildingSystem } from '../../../src/game/building/system';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import { craftSeconds, craftTicks } from '../../../src/game/crafting/formulas';
import type { CraftingSystem } from '../../../src/game/crafting/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../../src/game/items/slots';
import type { LightSystem } from '../../../src/game/light/system';
import type { WorldCollision } from '../../../src/game/player/collision';
import type { PlayerSystem } from '../../../src/game/player/system';
import type { RoomsSystem } from '../../../src/game/rooms/system';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import type { StationSystem } from '../../../src/game/stations/system';
import { BLOCK_ALL } from '../../../src/world/collision/tiles';
import { TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_MASK } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';

const CONFIG = { seed: 1, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** A free site of 11 × 9 tiles next to the spawn. */
const SITE = { w: 11, h: 9 } as const;
/** A generated world and many ticks: more than the default 5 s on a loaded machine. */
const FULL_SIM_TIMEOUT_MS = 60_000;
type Ev = EventArgs<SimEventMap>;

interface Game {
  readonly sim: Simulation;
  readonly x0: number;
  readonly y0: number;
  run(commands?: readonly GameCommand[], ticks?: number): Ev[];
  sys<T>(id: string): T;
  at(x: number, y: number): { tx: number; ty: number };
  stand(x: number, y: number): void;
  give(item: string, count: number): void;
  slotOf(item: string): SlotRef;
  build(part: string, x: number, y: number): void;
}

function of<K extends keyof SimEventMap>(events: readonly Ev[], type: K): SimEventMap[K][] {
  return events.filter((e) => e[0] === type).map((e) => e[1] as SimEventMap[K]);
}

function reasons(events: readonly Ev[]): string[] {
  return of(events, 'commandRejected').map((r) => r.reason);
}

function game(): Game {
  const sim = createSimulation(CONFIG);
  const sys = <T>(id: string): T => sim.system(id) as unknown as T;
  const run = (commands: readonly GameCommand[] = [], ticks = 1): Ev[] => {
    const out: Ev[] = [];
    for (let i = 0; i < ticks; i++) {
      sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      sim.events.drain((...e) => out.push(e));
    }
    return out;
  };
  run([{ type: 'player.spawn' }], 2);
  run([{ type: 'setWeather', state: 'klar' }, { type: 'setTime', hour: 12, minute: 0 }]);
  const player = sys<PlayerSystem>('player');
  const collision = sys<WorldCollision>('world-collision');
  const p = { x: 0, y: 0 };
  if (!player.position(sim, p)) throw new Error('no player');
  const px = Math.floor(p.x / TILE_PX);
  const py = Math.floor(p.y / TILE_PX);
  collision.ensureTiles(0, px - 40, py - 40, px + 40, py + 40);
  const free = (x: number, y: number): boolean => {
    const chunk = sim.world.chunks.get(0, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
    if (chunk === undefined) return false;
    const i = ((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK);
    return (collision.grid.tileInfo(0, x, y) & BLOCK_ALL) === 0 && chunk.object[i] === 0 && ((chunk.water[i] as number) & WATER_DEPTH_MASK) === 0 && ((chunk.flags[i] as number) & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) === 0;
  };
  let site: { x: number; y: number } | null = null;
  for (let r = 0; r <= 30 && site === null; r++) {
    for (let dy = -r; dy <= r && site === null; dy++) {
      for (let dx = -r; dx <= r && site === null; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        let ok = true;
        for (let y = py + dy; y < py + dy + SITE.h && ok; y++) for (let x = px + dx; x < px + dx + SITE.w && ok; x++) ok = free(x, y);
        if (ok) site = { x: px + dx, y: py + dy };
      }
    }
  }
  if (site === null) throw new Error('no free site next to the spawn');
  const { x: x0, y: y0 } = site;
  const at = (x: number, y: number): { tx: number; ty: number } => ({ tx: x0 + x, ty: y0 + y });
  const inventory = sys<InventorySystem>('inventory');
  const g: Game = {
    sim,
    x0,
    y0,
    run,
    sys,
    at,
    stand(x, y) {
      run([{ type: 'player.teleport', x: (x0 + x + 0.5) * TILE_PX, y: (y0 + y + 0.5) * TILE_PX, layer: 0 }], 2);
    },
    give(item, count) {
      run([{ type: 'inventory.give', item, count }]);
    },
    slotOf(item) {
      const state = inventory.state;
      for (const area of BAG_AREAS) {
        const index = state[area].findIndex((s) => s !== null && s.item === item);
        if (index >= 0) return { bereich: area, index };
      }
      throw new Error(`no ${item} in the bags`);
    },
    build(part, x, y) {
      g.give(part, 1);
      const ev = run([{ type: 'build.place', part, ...at(x, y) }]);
      expect(reasons(ev), `${part} at ${x},${y}`).toEqual([]);
    },
  };
  g.stand(5, 4);
  return g;
}

/** Walls around the site rectangle (x0, y0)–(x1, y1) (the walls on its edge), a door at (doorX, y1), a straw roof over all. */
function house(g: Game, x0: number, y0: number, x1: number, y1: number, doorX: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (x === x0 || x === x1 || y === y0 || y === y1) g.build(x === doorX && y === y1 ? 'tuer_holz' : 'wand_holz', x, y);
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.build('dach_stroh', x, y);
}

/** Steps in front of (south of) the lamp on site tile (x, y) and fills it with `count` lumps of resin. */
function fillLamp(g: Game, x: number, y: number, count: number): number {
  const lamp = g.sys<LightSystem>('light').lightAt(0, g.x0 + x, g.y0 + y);
  if (lamp === undefined) throw new Error(`no lamp at ${x},${y}`);
  g.stand(x, y + 1);
  g.give('harz', count);
  expect(reasons(g.run([{ type: 'light.fuel', light: lamp.id, from: g.slotOf('harz'), count }]))).toEqual([]);
  return lamp.id;
}

describe('Review M4 in createSimulation', { timeout: FULL_SIM_TIMEOUT_MS }, () => {
  it('#2: Strg+Z während Werkbank I → II wird abgelehnt – keine zweite Werkbank, kein Werkbank-II-Item', () => {
    const g = game();
    const stations = g.sys<StationSystem>('stations');
    const inventory = g.sys<InventorySystem>('inventory');
    g.give('werkbank', 1);
    g.stand(1, 3);
    expect(reasons(g.run([{ type: 'station.place', from: g.slotOf('werkbank'), ...g.at(1, 1) }]))).toEqual([]);
    const bench = stations.placed[0]?.id as number;
    g.give('brett', 8);
    g.give('balken', 2);
    g.give('kupferbarren', 2);
    g.give('faserseil', 4);
    expect(reasons(g.run([{ type: 'craft.start', recipe: 'rezept_werkbank_2', count: 1 }], 2))).toEqual([]);
    expect(reasons(g.run([{ type: 'station.remove', station: bench }]))).toEqual(['inUse']);
    const done = g.run([], BALANCE.crafting.durationSeconds.gross * BALANCE.time.tickHz + 2);
    expect(of(done, 'stationUpgraded')).toEqual([expect.objectContaining({ id: bench, to: 'werkbank_2' })]);
    expect([inventory.count('werkbank'), inventory.count('werkbank_2')]).toEqual([0, 0]);
    expect(stations.placed.map((p) => p.station)).toEqual(['werkbank_2']);
  });

  it('#12: fällt die Wand einer Wandlampe oder wird eine Lampe zerstört, fällt ihr Harz an der Lampe zu Boden', () => {
    const g = game();
    const inventory = g.sys<InventorySystem>('inventory');
    const building = g.sys<BuildingSystem>('building');
    g.stand(4, 5);
    // A wall with a wall lamp on its south side, filled with three lumps.
    g.build('wand_holz', 2, 2);
    g.build('harzlampe_wand', 2, 3);
    fillLamp(g, 2, 3, 3);
    const harz = inventory.count('harz');
    const fell = g.run([{ type: 'build.remove', ...g.at(2, 2) }]);
    expect(of(fell, 'partRemoved').map((e) => e.reason)).toEqual(['abgebaut', 'abgefallen']);
    expect(inventory.count('harz')).toBe(harz);
    expect(of(fell, 'dropSpawned').filter((d) => d.item === 'harz').map((d) => d.count)).toEqual([3]);
    // A standing lamp burned down by damage: its lumps drop where it stood.
    g.build('harzlampe', 6, 3);
    fillLamp(g, 6, 3, 2);
    const burned: Ev[] = [];
    const tx = g.x0 + 6;
    const ty = g.y0 + 3;
    building.damage(g.sim, 0, 'objekt', tx, ty, 1_000_000);
    burned.push(...g.run());
    expect(of(burned, 'partRemoved')).toEqual([expect.objectContaining({ part: 'harzlampe', reason: 'zerstoert' })]);
    expect(inventory.count('harz')).toBe(harz);
    const dropped = of(burned, 'dropSpawned').filter((d) => d.item === 'harz');
    expect(dropped.map((d) => d.count)).toEqual([2]);
    // Taken down by the player: the lumps go into the bags, as before.
    g.build('harzlampe', 7, 5);
    fillLamp(g, 7, 5, 2);
    const before = inventory.count('harz');
    const taken = g.run([{ type: 'build.remove', ...g.at(7, 5) }]);
    expect(of(taken, 'dropSpawned').filter((d) => d.item === 'harz')).toEqual([]);
    expect(inventory.count('harz')).toBe(before + 2);
  });

  it('#13: Bett und kalte Lampe sind kein Schlafraum; die brennende Lampe macht ihn dazu', () => {
    const g = game();
    const rooms = g.sys<RoomsSystem>('rooms');
    g.stand(2, 2);
    house(g, 0, 0, 5, 5, 2);
    g.build('strohbett', 1, 1);
    g.build('harzlampe', 4, 1);
    const room = (): { lights: number; type: string | null; licht: number } => {
      const r = rooms.roomAt(g.sim, 0, g.x0 + 3, g.y0 + 3);
      return { lights: r?.contents.lights ?? -1, type: r?.type?.id ?? null, licht: r?.contents.furniture.licht ?? 0 };
    };
    expect(rooms.roomAt(g.sim, 0, g.x0 + 3, g.y0 + 3)?.region.interior).toBe(true);
    expect(room()).toEqual({ lights: 0, type: null, licht: 0 });
    // Filled but cold: still no light.
    fillLamp(g, 4, 1, 1);
    g.run();
    expect(room()).toEqual({ lights: 0, type: null, licht: 0 });
    expect(reasons(g.run([{ type: 'light.ignite', ...g.at(4, 1) }]))).toEqual([]);
    expect(room()).toEqual({ lights: 1, type: 'schlafraum', licht: 1 });
  });

  it('#14: die Werkbank in der Werkstatt arbeitet 15 % schneller, auch wenn der Spieler draußen vor der Tür steht', () => {
    const g = game();
    const rooms = g.sys<RoomsSystem>('rooms');
    const crafting = g.sys<CraftingSystem>('crafting');
    g.stand(4, 3);
    // A roofed house with the interior (1, 1)–(8, 3), its door at (4, 4); three stations inside make it a workshop.
    house(g, 0, 0, 9, 4, 4);
    const place = (item: string, x: number, y: number): void => {
      g.give(item, 1);
      expect(reasons(g.run([{ type: 'station.place', from: g.slotOf(item), ...g.at(x, y) }])), item).toEqual([]);
    };
    place('saegebock', 1, 1);
    place('steinmetzbank', 7, 1);
    place('werkbank', 5, 3);
    expect(rooms.roomAt(g.sim, 0, g.x0 + 3, g.y0 + 2)?.type?.id).toBe('werkstatt');
    // Outside, south of the door: the bench is within reach, the player's own tile is no workshop.
    g.stand(5, 6);
    expect(rooms.craftTempo(g.sim)).toBe(0);
    expect(crafting.workshopTempoAt(g.sim, 0, g.x0 + 5, g.y0 + 3)).toBe(BALANCE.rooms.effects.workshopTempo);
    g.give('holz', 8);
    g.give('zweig', 4);
    g.give('faserseil', 2);
    const ev = g.run([{ type: 'craft.start', recipe: 'rezept_saegebock', count: 1 }], 2);
    expect(reasons(ev)).toEqual([]);
    const seconds = craftSeconds(crafting.recipes.get('rezept_saegebock'));
    expect(of(ev, 'craftStarted')).toEqual([expect.objectContaining({ ticks: craftTicks(seconds, crafting.skillBonus('handwerk') + BALANCE.rooms.effects.workshopTempo, 1) })]);
  });
});
