/**
 * Bestand und Spawn der Wildtiere (M6-27, docs/SPIEL.md §11 „Bestand und Spawn“, MASTERPROMPT §20.1):
 * - im echten Spiel besiedelt die aktive Zone ihre Chunks beim ersten Aktivieren aus der Spawntabelle des Bioms – je Chunk
 *   höchstens `maxPerChunk`, nur im Inneren der Chunks, gleich in zwei Welten desselben Seeds;
 * - frieren die Chunks ein (Zeitsprung), wandern die Tiere in den Bestand ihres Heimat-Chunks und kommen danach mit
 *   denselben Seriennummern zurück; ausgerottetes Wild wächst in den Stunden danach nach;
 * - das Aufholen eines eingefrorenen Chunks (Nachwuchs und Fallen) ist zerlegbar: a → c gleich a → b → c.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { SPAWN_TABLES } from '../../../src/content/creatures/index';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../../src/world/model/coords';
import { ChunkData } from '../../../src/world/model/chunk';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { CreaturePopulation, type FrozenTrap, type PopulationTraps } from '../../../src/game/creatures/population';
import { ZONE_MARGIN_TILES } from '../../../src/game/creatures/zone';
import { createSimulation } from '../../../src/game/setup';
import { createHitResult } from '../../../src/game/combat/system';
import { Simulation } from '../../../src/game/sim';
import { probeCatalog, testCreatureEnvironment } from './kreatur-testwelt';

const W = BALANCE.spawn.wildlife;
const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** Two simulations of the generated world: more than the default 5 s on a loaded machine. */
const FULL_SIM_TIMEOUT_MS = 30_000;

function game(): { sim: Simulation; creatures: CreatureSystem; run: (commands?: readonly GameCommand[], ticks?: number) => void } {
  const sim = createSimulation(CONFIG);
  const creatures = sim.system('creatures') as unknown as CreatureSystem;
  const run = (commands: readonly GameCommand[] = [], ticks = 1): void => {
    for (let i = 0; i < ticks; i++) {
      sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      sim.events.drain(() => undefined);
    }
  };
  run([{ type: 'player.spawn' }], 2);
  return { sim, creatures, run };
}

/** Every live creature: id, serial, home chunk and tile. */
function census(c: CreatureSystem): { creature: string; serial: number; home: string; tx: number; ty: number }[] {
  const out: { creature: string; serial: number; home: string; tx: number; ty: number }[] = [];
  const p = { x: 0, y: 0 };
  for (let i = 0; i < c.store.size; i++) {
    const s = c.store.valueAt(i);
    c.positionOf(c.store.entityAt(i), p);
    out.push({ creature: s.creature, serial: s.serial, home: `${s.homeCx},${s.homeCy}`, tx: Math.floor(p.x / TILE_PX), ty: Math.floor(p.y / TILE_PX) });
  }
  return out;
}

/** The creatures the spawn tables name (by day and by night), sorted. */
const WILDLIFE = [...new Set(SPAWN_TABLES.flatMap((t) => [...t.tag, ...t.nacht].map((e) => e.kreatur)))].sort();

describe('Wildtiere im Spiel (M6-27)', { timeout: FULL_SIM_TIMEOUT_MS }, () => {
  it('die aktive Zone besiedelt ihre Chunks aus der Spawntabelle: höchstens vier je Chunk, im Inneren, gleich in zwei Welten', () => {
    const a = game();
    const list = census(a.creatures);
    expect(list.length).toBeGreaterThan(0);
    const perChunk = new Map<string, number>();
    for (const c of list) perChunk.set(c.home, (perChunk.get(c.home) ?? 0) + 1);
    for (const n of perChunk.values()) expect(n).toBeLessThanOrEqual(W.maxPerChunk);
    for (const c of list) {
      // Only creatures of the spawn tables (every creature group's, M6-19 ff.).
      expect(WILDLIFE).toContain(c.creature);
      const lx = c.tx & CHUNK_MASK;
      const ly = c.ty & CHUNK_MASK;
      expect(lx >= ZONE_MARGIN_TILES && lx < 32 - ZONE_MARGIN_TILES && ly >= ZONE_MARGIN_TILES && ly < 32 - ZONE_MARGIN_TILES).toBe(true);
      expect(`${c.tx >> CHUNK_SHIFT},${c.ty >> CHUNK_SHIFT}`).toBe(c.home);
    }
    const b = game();
    expect(census(b.creatures)).toEqual(list);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
  });

  it('ein Zeitsprung friert die Zone ein: die Tiere kommen aus dem Bestand mit ihren Seriennummern zurück', () => {
    const g = game();
    const before = census(g.creatures).map((c) => `${c.creature}#${c.serial}`).sort();
    // Two game hours: less than the regrowth interval, the stock comes back as it went.
    g.run([{ type: 'advanceTime', minutes: 120 }], 2);
    const after = census(g.creatures).map((c) => `${c.creature}#${c.serial}`).sort();
    expect(after).toEqual(before);
    for (const s of g.creatures.population.stocks.values()) expect(s.members).toEqual([]);
  });

  it('ausgerottetes Wild wächst in den Stunden danach nach, bis zur Obergrenze', () => {
    const g = game();
    // Every animal of the zone falls (a deadly hit through the combatant provider; the zone is wider than the debug kill).
    const hit = { ...createHitResult(), attacker: g.sim.player, amount: 1e6 };
    const all = Array.from({ length: g.creatures.store.size }, (_, i) => g.creatures.store.entityAt(i));
    for (const e of all) g.creatures.targets.applyHit(g.sim, e, hit);
    g.run([], 2);
    expect(g.creatures.store.size).toBe(0);
    // The jump and a world tick after it (carcasses rot on the world tick).
    g.run([{ type: 'advanceTime', minutes: 60 * W.regrowGameHours * 4 + 30 }], BALANCE.time.tickHz + 2);
    const list = census(g.creatures);
    expect(list.length).toBeGreaterThan(0);
    const perChunk = new Map<string, number>();
    for (const c of list) perChunk.set(c.home, (perChunk.get(c.home) ?? 0) + 1);
    for (const n of perChunk.values()) expect(n).toBeLessThanOrEqual(W.maxPerChunk);
    // The carcasses of the massacre rotted meanwhile.
    expect(g.creatures.carcasses.size).toBe(0);
  });
});

describe('Aufholen eines eingefrorenen Chunks (M6-27, M6-30)', () => {
  /** A population over a Grünhain chunk with one hare in stock and one armed box trap. */
  function frozen(): { pop: CreaturePopulation; chunk: ChunkData; traps: FrozenTrap[]; caught: string[] } {
    const sim = new Simulation({ seed: 5, dayLengthMinutes: 24 });
    const chunk = new ChunkData(0 as Layer, 3, 4);
    chunk.biome.fill(contentWorldIdTables().biomes.runtimeId('gruenhain'));
    const pop = new CreaturePopulation({ sim, catalog: probeCatalog('inhalt'), environment: testCreatureEnvironment(), placeable: () => true });
    const stock = pop.stockOf(0, 3, 4, 0);
    stock.seeded = true;
    stock.regrowTick = 1000;
    stock.members.push({ creature: 'hase', variant: -1, serial: 1, health: 5, x: 3 * 512 + 100, y: 4 * 512 + 100, homeX: 0, homeY: 0, pack: 0, storedTick: 0 });
    pop.serial = 2;
    const traps: FrozenTrap[] = [{ id: 1, item: 'kastenfalle', catchTick: 500 }];
    const caught: string[] = [];
    const host: PopulationTraps = {
      armedIn: (_l, _cx, _cy, out) => {
        out.length = 0;
        for (const t of traps) if (t.catchTick >= 0) out.push(t);
        return out;
      },
      caught: (t, creature, tick) => {
        t.catchTick = -1;
        caught.push(`${creature}@${tick}`);
      },
    };
    pop.useTraps(host);
    return { pop, chunk, traps, caught };
  }

  function state(f: ReturnType<typeof frozen>): string {
    return JSON.stringify({ stocks: f.pop.serialize(), serial: f.pop.serial, traps: f.traps, caught: f.caught });
  }

  it('a → c ist a → b → c, für jede Teilung; from = to ändert nichts', () => {
    const tph = new Simulation({ seed: 5, dayLengthMinutes: 24 }).clock.ticksPerGameHour;
    const end = Math.round(3 * 24 * tph);
    const whole = frozen();
    whole.pop.catchUp(whole.chunk, 0, end);
    // Over three days the stock grew and the trap caught.
    expect(whole.caught.length).toBe(1);
    expect(whole.pop.find(0, 3, 4)?.members.length).toBeGreaterThan(0);
    expect(whole.pop.find(0, 3, 4)?.members.length).toBeLessThanOrEqual(W.maxPerChunk);
    for (const split of [1, 499, 500, 1000, 1001, Math.round(end / 3), end - 1]) {
      const parts = frozen();
      parts.pop.catchUp(parts.chunk, 0, split);
      parts.pop.catchUp(parts.chunk, split, split);
      parts.pop.catchUp(parts.chunk, split, end);
      expect(state(parts), `Teilung bei ${split}`).toBe(state(whole));
    }
  });

  it('der Nachwuchs überschreitet die Obergrenze nicht', () => {
    const f = frozen();
    const stock = f.pop.find(0, 3, 4);
    if (stock === undefined) throw new Error('no stock');
    for (let i = 0; i < W.maxPerChunk - 1; i++) stock.members.push({ ...(stock.members[0] as (typeof stock.members)[number]), serial: 10 + i });
    f.traps.length = 0;
    f.pop.catchUp(f.chunk, 0, 10_000_000);
    expect(stock.members.length).toBe(W.maxPerChunk);
  });
});
