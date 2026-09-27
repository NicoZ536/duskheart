/**
 * Test support for the building tests that need the real game (`createSimulation`, src/game/setup.ts): the build grid
 * wired to the stations, lights and gathering of the generated world – what other systems placed keeps parts off
 * their tiles and the other way round, the shovel and hoe keep off the built ground.
 *
 * `bauSpiel()` spawns the player, sets clear weather at noon and finds a free site of 11 × 9 tiles of dry, level,
 * empty land near the spawn (every tile also passing `also`, when given; another size with `size`); site tile (x, y) is
 * world tile `at(x, y)`. The player starts in the middle of the site (tile (5, 4) of the default site).
 */
import type { EventArgs } from '../../../src/engine/events';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../../src/game/items/slots';
import type { WorldCollision } from '../../../src/game/player/collision';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import { BLOCK_ALL } from '../../../src/world/collision/tiles';
import { TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_MASK, type ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';

/** The world of the tests. */
export const BAU_SPIEL_CONFIG = { seed: 1, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** Size of the free site [tiles]. */
const SITE = { w: 11, h: 9 } as const;
/** How far from the spawn the site may lie [tiles]. */
const SEARCH_TILES = 60;
/** A generated world and many ticks: more than the default 5 s on a loaded machine. */
export const BAU_SPIEL_TIMEOUT_MS = 60_000;

/** One simulation event as drained. */
export type Ev = EventArgs<SimEventMap>;

/** The events of one type. */
export function eventsOf<K extends keyof SimEventMap>(events: readonly Ev[], type: K): SimEventMap[K][] {
  return events.filter((e) => e[0] === type).map((e) => e[1] as SimEventMap[K]);
}

/** The reasons of the refused commands. */
export function rejections(events: readonly Ev[]): string[] {
  return eventsOf(events, 'commandRejected').map((r) => r.reason);
}

export interface BauSpiel {
  readonly sim: Simulation;
  /** Steps `ticks` ticks (the commands in the first) and returns their events. */
  run(commands?: readonly GameCommand[], ticks?: number): Ev[];
  sys<T>(id: string): T;
  /** World tile of site tile (x, y). */
  at(x: number, y: number): { tx: number; ty: number };
  /** Chunk and local index of site tile (x, y). */
  chunkAt(x: number, y: number): { chunk: ChunkData; i: number };
  /** Puts the player on the centre of site tile (x, y). */
  stand(x: number, y: number): void;
  give(item: string, count: number): void;
  /** Pieces of `item` in the bags. */
  count(item: string): number;
  /** First bag slot holding `item`. */
  slotOf(item: string): SlotRef;
  /** Puts `item` into the hand (given first). */
  hold(item: string): void;
  /** Places build part `part` on site tile (x, y) (gives it first); the refusals. */
  build(part: string, x: number, y: number): string[];
}

/**
 * The real game on a free site next to the spawn; with `also` only a site whose every tile passes it as well (tiles
 * the shovel can dig: the start beach is a place and cannot be dug).
 */
export function bauSpiel(also?: (sim: Simulation, tx: number, ty: number) => boolean, size: { readonly w: number; readonly h: number } = SITE): BauSpiel {
  const sim = createSimulation(BAU_SPIEL_CONFIG);
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
  collision.ensureTiles(0, px - SEARCH_TILES - size.w, py - SEARCH_TILES - size.h, px + SEARCH_TILES + size.w, py + SEARCH_TILES + size.h);
  const free = (x: number, y: number): boolean => {
    const chunk = sim.world.chunks.get(0, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
    if (chunk === undefined) return false;
    const i = ((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK);
    if ((collision.grid.tileInfo(0, x, y) & BLOCK_ALL) !== 0 || chunk.object[i] !== 0 || ((chunk.water[i] as number) & WATER_DEPTH_MASK) !== 0) return false;
    return ((chunk.flags[i] as number) & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) === 0 && (also === undefined || also(sim, x, y));
  };
  let site: { x: number; y: number } | null = null;
  for (let r = 0; r <= SEARCH_TILES && site === null; r++) {
    for (let dy = -r; dy <= r && site === null; dy++) {
      for (let dx = -r; dx <= r && site === null; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        let ok = true;
        for (let y = py + dy; y < py + dy + size.h && ok; y++) for (let x = px + dx; x < px + dx + size.w && ok; x++) ok = free(x, y);
        if (ok) site = { x: px + dx, y: py + dy };
      }
    }
  }
  if (site === null) throw new Error('no free site near the spawn');
  const { x: x0, y: y0 } = site;
  const at = (x: number, y: number): { tx: number; ty: number } => ({ tx: x0 + x, ty: y0 + y });
  const inventory = sys<InventorySystem>('inventory');
  const g: BauSpiel = {
    sim,
    run,
    sys,
    at,
    chunkAt(x, y) {
      const t = at(x, y);
      const chunk = sim.world.chunks.get(0, t.tx >> CHUNK_SHIFT, t.ty >> CHUNK_SHIFT);
      if (chunk === undefined) throw new Error(`site tile ${x},${y} not resident`);
      return { chunk, i: ((t.ty & CHUNK_MASK) << CHUNK_SHIFT) | (t.tx & CHUNK_MASK) };
    },
    stand(x, y) {
      run([{ type: 'player.teleport', x: (x0 + x + 0.5) * TILE_PX, y: (y0 + y + 0.5) * TILE_PX, layer: 0 }], 2);
    },
    give(item, count) {
      run([{ type: 'inventory.give', item, count }]);
    },
    count(item) {
      return inventory.count(item);
    },
    slotOf(item) {
      const state = inventory.state;
      for (const area of BAG_AREAS) {
        const index = state[area].findIndex((s) => s !== null && s.item === item);
        if (index >= 0) return { bereich: area, index };
      }
      throw new Error(`no ${item} in the bags`);
    },
    hold(item) {
      g.give(item, 1);
      const slot = g.slotOf(item);
      if (slot.bereich !== 'schnellleiste') run([{ type: 'inventory.move', from: slot, to: { bereich: 'schnellleiste', index: 0 } }]);
      run([{ type: 'player.selectHotbar', index: g.slotOf(item).index }]);
    },
    build(part, x, y) {
      g.give(part, 1);
      return rejections(run([{ type: 'build.place', part, ...at(x, y) }]));
    },
  };
  g.stand(Math.floor(size.w / 2), Math.floor(size.h / 2));
  return g;
}
