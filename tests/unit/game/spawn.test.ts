/**
 * Bestand und Spawn der Wildtiere (M6-27, docs/SPIEL.md §11 „Bestand und Spawn“, MASTERPROMPT §20.1):
 * - im echten Spiel besiedelt die aktive Zone ihre Chunks beim ersten Aktivieren aus der Spawntabelle des Bioms – je Chunk
 *   höchstens `maxPerChunk`, nur im Inneren der Chunks, gleich in zwei Welten desselben Seeds;
 * - frieren die Chunks ein (Zeitsprung), wandern die Tiere in den Bestand ihres Heimat-Chunks und kommen danach mit
 *   denselben Seriennummern zurück; ausgerottetes Wild wächst in den Stunden danach nach;
 * - das Aufholen eines eingefrorenen Chunks (Nachwuchs und Fallen) ist zerlegbar: a → c gleich a → b → c;
 * - unter dem Finstermond bringt der Nachtspawner bis zu 1,5-mal so viel Schattenbrut, und jede ist stärker (Leben, Schaden,
 *   Tempo × `BALANCE.spawn.shadowBrood.finstermond`, gespeichert als `finster`);
 * - Spawnbedingungen je Tabelleneintrag (`ort`, M6-27b): Frösche nur am Wasser, Krabben auf trockenem Sand, Quallen im
 *   Flachwasser, Robben nah am Wasser – ein Chunk ohne passende Kachel bekommt keine; der Nachtspawner achtet sie ebenso.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { SPAWN_TABLES } from '../../../src/content/creatures/index';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../../src/world/model/coords';
import { ChunkData, WATER_DEPTH_DEEP, WATER_DEPTH_MASK, WATER_DEPTH_SHALLOW } from '../../../src/world/model/chunk';
import { spawnSiteFits, type SpawnGround } from '../../../src/game/creatures/population';
import { spawnSiteSchema, spawnTableSchema, type SpawnSite } from '../../../src/content/creatures/schema';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { CreaturePopulation, type FrozenTrap, type PopulationTraps } from '../../../src/game/creatures/population';
import { ZONE_MARGIN_TILES } from '../../../src/game/creatures/zone';
import { createSimulation } from '../../../src/game/setup';
import { createHitResult } from '../../../src/game/combat/system';
import { Simulation } from '../../../src/game/sim';
import { shadowBroodMax } from '../../../src/game/creatures/formulas';
import { creaturesSnapshotSchema } from '../../../src/game/creatures/state';
import type { SimEventMap } from '../../../src/game/sim';
import { eventsOf } from './kampf-testwelt';
import { AI_PROFILES, CREATURES, LOOT_TABLES, TRAPS } from '../../../src/content/creatures/index';
import { CreatureCatalog } from '../../../src/game/creatures/catalog';
import { OFFSET, PROBE_BEUTE, PROBE_KREATUREN, PROBE_PROFILE, kreaturWelt, meadow, probeCatalog, testCreatureEnvironment, type KreaturWelt } from './kreatur-testwelt';

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

describe('Finstermond: mehr und stärkere Schattenbrut (M6-27, §12.4)', () => {
  const SB = BALANCE.spawn.shadowBrood;
  const FM = SB.finstermond;
  const HZ = BALANCE.time.tickHz;
  const BASE = probeCatalog().get('probe_schleicher').def.leben;

  /** A night on an open field (the player god-like in the middle), with or without the Finstermond, after `seconds`. */
  function night(finster: boolean, seconds: number): KreaturWelt {
    const w = kreaturWelt(meadow(10, 10), { x: 5, y: 5 });
    w.cheats.god = true;
    w.cenv.phase = 'nacht';
    w.cenv.finster = finster;
    w.light.ambient = 0.05;
    for (let i = 0; i < seconds; i++) w.run(HZ);
    return w;
  }

  function brood(w: KreaturWelt): { finster: boolean; maxHealth: number }[] {
    const out: { finster: boolean; maxHealth: number }[] = [];
    for (let i = 0; i < w.creatures.store.size; i++) {
      const s = w.creatures.store.valueAt(i);
      if (s.creature === 'probe_schleicher') out.push({ finster: s.finster, maxHealth: s.maxHealth });
    }
    return out;
  }

  it('bis zu 1,5-mal so viele, jede mit 1,5-fachem Leben; ohne Finstermond die Grundform', () => {
    expect(FM.leben).toBeGreaterThan(1);
    expect(FM.schaden).toBeGreaterThan(1);
    expect(FM.tempo).toBeGreaterThan(1);
    const plain = brood(night(false, 90));
    const dark = brood(night(true, 90));
    expect(plain.length).toBe(shadowBroodMax(0, false, 'normal'));
    expect(dark.length).toBe(shadowBroodMax(0, true, 'normal'));
    expect(dark.length).toBeGreaterThan(plain.length);
    for (const b of plain) expect(b).toEqual({ finster: false, maxHealth: BASE });
    for (const b of dark) expect(b).toEqual({ finster: true, maxHealth: BASE * FM.leben });
  });

  /** A stalker one tile north of the player (not god) and its first bite's damage, finster or not. */
  function firstBite(finster: boolean): number {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    w.light.lit = true;
    const e = w.creature('probe_schleicher', 20, 14);
    w.state(e).finster = finster;
    for (let i = 0; i < 5 * HZ; i++) {
      const hurt = eventsOf<SimEventMap['hitLanded']>(w.run(1), 'hitLanded').find((h) => h.attacker === e);
      if (hurt !== undefined) return hurt.amount;
    }
    throw new Error('no bite');
  }

  it('ihr Biss trifft um den Faktor härter', () => {
    const plain = firstBite(false);
    expect(plain).toBeGreaterThan(0);
    expect(firstBite(true) / plain).toBeCloseTo(FM.schaden, 9);
  });

  /** The largest step a stalker hunting from eight tiles away takes in one tick [px], finster or not. */
  function fastestStep(finster: boolean): number {
    const w = kreaturWelt(meadow(40, 30), { x: 12, y: 15 });
    w.cheats.god = true;
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    w.light.lit = true;
    const e = w.creature('probe_schleicher', 20, 15);
    w.state(e).finster = finster;
    w.state(e).facing = Math.PI;
    let last = w.where(e);
    let top = 0;
    for (let i = 0; i < 2 * HZ; i++) {
      w.run(1);
      const p = w.where(e);
      top = Math.max(top, Math.hypot(p.x - last.x, p.y - last.y));
      last = p;
    }
    return top;
  }

  it('sie läuft um den Faktor schneller', () => {
    const plain = fastestStep(false);
    expect(plain).toBeCloseTo((probeCatalog().get('probe_schleicher').runPx), 3);
    expect(fastestStep(true) / plain).toBeCloseTo(FM.tempo, 3);
  });

  it('die Stärke übersteht Speichern und Laden; ein alter Spielstand ohne das Feld kennt keine', () => {
    const w = night(true, 20);
    const data = w.creatures.save.serialize() as { creatures: Record<string, unknown>[] };
    const saved = data.creatures.filter((c) => c.creature === 'probe_schleicher');
    expect(saved.length).toBeGreaterThan(0);
    for (const c of saved) expect(c.finster).toBe(true);
    const parsed = creaturesSnapshotSchema.parse(data);
    expect(parsed.creatures.filter((c) => c.creature === 'probe_schleicher').every((c) => c.finster)).toBe(true);
    const old = { ...data, creatures: data.creatures.map(({ finster: _f, ...rest }) => rest) };
    expect(creaturesSnapshotSchema.parse(old).creatures.every((c) => !c.finster)).toBe(true);
    // Brood of an ordinary night writes no such field at all.
    const plain = night(false, 20).creatures.save.serialize() as { creatures: Record<string, unknown>[] };
    for (const c of plain.creatures) expect('finster' in c).toBe(false);
  });
});

describe('Spawnbedingungen je Eintrag (M6-27b)', () => {
  const ids = contentWorldIdTables();
  const SIZE = 32;
  const WATER_NEAR_FROG = 3;
  const WATER_NEAR_SEAL = 4;

  /** A chunk (cx, cy) of `biome` whose tiles `paint(lx, ly)` gives ground and water depth. */
  function chunkOf(cx: number, cy: number, biome: string, paint: (lx: number, ly: number) => { ground: string; water: number }): ChunkData {
    const c = new ChunkData(0 as Layer, cx, cy);
    c.biome.fill(ids.biomes.runtimeId(biome));
    for (let ly = 0; ly < SIZE; ly++) {
      for (let lx = 0; lx < SIZE; lx++) {
        const t = paint(lx, ly);
        c.ground[ly * SIZE + lx] = ids.terrain.runtimeId(t.ground);
        c.water[ly * SIZE + lx] = t.water;
      }
    }
    return c;
  }

  /** Water depth of local tile (lx, ly) of `c` (0 outside it). */
  function depth(c: ChunkData, lx: number, ly: number): number {
    if (lx < 0 || ly < 0 || lx >= SIZE || ly >= SIZE) return 0;
    return (c.water[ly * SIZE + lx] as number) & WATER_DEPTH_MASK;
  }

  /** Plans the first population of `count` chunks painted by `paint` (a new chunk address each: other draws). */
  function plans(biome: string, count: number, paint: (lx: number, ly: number) => { ground: string; water: number }): { creature: string; lx: number; ly: number; chunk: ChunkData }[] {
    const sim = new Simulation({ seed: 5, dayLengthMinutes: 24 });
    const env = testCreatureEnvironment();
    env.season = 'sommer';
    let current: ChunkData | null = null;
    // The creature system's placement: swimmers in water with water around, the others on dry ground.
    const placeable = (kind: { mover: string }, _layer: Layer, tx: number, ty: number): boolean => {
      const c = current as ChunkData;
      const lx = tx - (c.cx << CHUNK_SHIFT);
      const ly = ty - (c.cy << CHUNK_SHIFT);
      if (kind.mover !== 'schwimmer') return depth(c, lx, ly) === 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (depth(c, lx + dx, ly + dy) === 0) return false;
      return true;
    };
    const pop = new CreaturePopulation({ sim, catalog: probeCatalog('inhalt'), environment: env, placeable });
    const out: { creature: string; lx: number; ly: number; chunk: ChunkData }[] = [];
    for (let i = 0; i < count; i++) {
      const c = chunkOf(3 + i, 4, biome, paint);
      current = c;
      for (const p of pop.planSeed(c, 0, null)) out.push({ creature: p.kind.id, lx: Math.floor(p.x / TILE_PX) - (c.cx << CHUNK_SHIFT), ly: Math.floor(p.y / TILE_PX) - (c.cy << CHUNK_SHIFT), chunk: c });
    }
    return out;
  }

  function nearWater(c: ChunkData, lx: number, ly: number, r: number): boolean {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r && depth(c, lx + dx, ly + dy) !== 0) return true;
    return false;
  }

  it('die Daten: Frosch am Wasser, Krabbe auf Sand, Qualle im Flachwasser, Robbe nah am Wasser', () => {
    const find = (biome: string, time: 'tag' | 'nacht', id: string): SpawnSite | undefined => SPAWN_TABLES.find((t) => t.id === biome)?.[time].find((e) => e.kreatur === id)?.ort;
    for (const time of ['tag', 'nacht'] as const) {
      expect(find('gruenhain', time, 'frosch')).toEqual({ wasserNaehe: WATER_NEAR_FROG });
      expect(find('salzkueste', time, 'krabbe')).toEqual({ boden: ['sand'] });
      expect(find('salzkueste', time, 'qualle')).toEqual({ wasser: 'flach' });
      expect(find('salzkueste', time, 'robbe')).toEqual({ wasserNaehe: WATER_NEAR_SEAL });
    }
    // The registry checks the ground ids against the terrain.
    expect(CONTENT.references().filter((r) => r.target === 'terrain' && r.at.includes('.ort.boden')).map((r) => `${r.id}:${r.at}=${String(r.value)}`)).toEqual(['salzkueste:tag[0].ort.boden[0]=sand', 'salzkueste:nacht[0].ort.boden[0]=sand']);
    // A site names a condition; its water search stays within the zone margin.
    expect(spawnSiteSchema.safeParse({}).success).toBe(false);
    expect(spawnSiteSchema.safeParse({ wasserNaehe: ZONE_MARGIN_TILES + 1 }).success).toBe(false);
    expect(spawnSiteSchema.safeParse({ wasserNaehe: ZONE_MARGIN_TILES }).success).toBe(true);
  });

  it('spawnSiteFits: trockener Boden, Wassertiefe, Wasser in der Nähe (gefrorenes zählt nicht)', () => {
    const tiles = new Map<string, { ground: string; water: number }>();
    const ground: SpawnGround = {
      ground: (_l, tx, ty) => tiles.get(`${tx},${ty}`)?.ground ?? 'gras',
      water: (_l, tx, ty) => tiles.get(`${tx},${ty}`)?.water ?? 0,
    };
    tiles.set('0,0', { ground: 'sand', water: 0 });
    tiles.set('1,0', { ground: 'sand', water: WATER_DEPTH_SHALLOW });
    tiles.set('3,0', { ground: 'meeresgrund', water: WATER_DEPTH_DEEP });
    tiles.set('9,9', { ground: 'erde', water: WATER_DEPTH_SHALLOW | 0b10_0000 });
    expect(spawnSiteFits({ boden: ['sand'] }, ground, 0, 0, 0)).toBe(true);
    expect(spawnSiteFits({ boden: ['sand'] }, ground, 0, 1, 0)).toBe(false);
    expect(spawnSiteFits({ boden: ['sand'] }, ground, 0, 5, 5)).toBe(false);
    expect(spawnSiteFits({ wasser: 'flach' }, ground, 0, 1, 0)).toBe(true);
    expect(spawnSiteFits({ wasser: 'flach' }, ground, 0, 3, 0)).toBe(false);
    expect(spawnSiteFits({ wasser: 'tief' }, ground, 0, 3, 0)).toBe(true);
    expect(spawnSiteFits({ wasser: 'flach' }, ground, 0, 9, 9)).toBe(false);
    // Euclidean: two tiles straight from the shallows yes, (1, 2) off the diagonal no.
    expect(spawnSiteFits({ wasserNaehe: 2 }, ground, 0, 1, 2)).toBe(true);
    expect(spawnSiteFits({ wasserNaehe: 2 }, ground, 0, 0, 2)).toBe(false);
    expect(spawnSiteFits({ wasserNaehe: 2 }, ground, 0, 1, 3)).toBe(false);
    expect(spawnSiteFits({ wasserNaehe: 2 }, ground, 0, 9, 8)).toBe(false);
    expect(spawnSiteFits({ boden: ['sand'], wasserNaehe: 1 }, ground, 0, 0, 0)).toBe(true);
    expect(spawnSiteFits({ boden: ['sand'], wasserNaehe: 1 }, ground, 0, 0, 5)).toBe(false);
  });

  it('Grünhain: Frösche nur, wo Wasser in 3 Kacheln liegt; ohne Teich keine', () => {
    const dry = plans('gruenhain', 120, () => ({ ground: 'gras', water: 0 }));
    expect(dry.length).toBeGreaterThan(0);
    expect(dry.filter((p) => p.creature === 'frosch')).toEqual([]);
    // A pond of 2 × 2 tiles in the middle of every chunk.
    const pond = plans('gruenhain', 120, (lx, ly) => (lx >= 15 && lx <= 16 && ly >= 15 && ly <= 16 ? { ground: 'erde', water: WATER_DEPTH_SHALLOW } : { ground: 'gras', water: 0 }));
    const frogs = pond.filter((p) => p.creature === 'frosch');
    expect(frogs.length).toBeGreaterThan(0);
    for (const f of frogs) expect(nearWater(f.chunk, f.lx, f.ly, WATER_NEAR_FROG)).toBe(true);
    // The other animals still come everywhere.
    expect(pond.some((p) => p.creature !== 'frosch' && !nearWater(p.chunk, p.lx, p.ly, WATER_NEAR_FROG))).toBe(true);
  });

  it('Salzküste: Krabben auf trockenem Sand, Quallen im Flachwasser, Robben nah am Wasser', () => {
    // West sand, then dune grass, a shallow band and the deep sea in the east.
    const coast = plans('salzkueste', 160, (lx) =>
      lx < 12 ? { ground: 'sand', water: 0 } : lx < 20 ? { ground: 'duenengras', water: 0 } : lx < 24 ? { ground: 'sand', water: WATER_DEPTH_SHALLOW } : { ground: 'meeresgrund', water: WATER_DEPTH_DEEP },
    );
    const of = (id: string): typeof coast => coast.filter((p) => p.creature === id);
    expect(of('krabbe').length).toBeGreaterThan(0);
    expect(of('qualle').length).toBeGreaterThan(0);
    expect(of('robbe').length).toBeGreaterThan(0);
    for (const c of of('krabbe')) expect(c.lx).toBeLessThan(12);
    for (const q of of('qualle')) expect(depth(q.chunk, q.lx, q.ly)).toBe(WATER_DEPTH_SHALLOW);
    for (const r of of('robbe')) expect(nearWater(r.chunk, r.lx, r.ly, WATER_NEAR_SEAL)).toBe(true);
    // Without sand, water or shallows: none of them.
    const inland = plans('salzkueste', 80, () => ({ ground: 'duenengras', water: 0 }));
    expect(inland.filter((p) => ['krabbe', 'qualle', 'robbe'].includes(p.creature))).toEqual([]);
    expect(inland.length).toBeGreaterThan(0);
  });
});

describe('Spawnbedingungen im Nachtspawner (M6-27b)', () => {
  const HZ = BALANCE.time.tickHz;
  /** The test world's catalogue with one night table: the fixture stalker only on sand. */
  const catalog = new CreatureCatalog(
    [...CREATURES, ...PROBE_KREATUREN],
    [...AI_PROFILES, ...PROBE_PROFILE],
    [...LOOT_TABLES, ...PROBE_BEUTE],
    [spawnTableSchema.parse({ id: 'gruenhain', tag: [], nacht: [{ kreatur: 'probe_schleicher', gewicht: 1, gruppe: [1, 1], ort: { boden: ['sand'] } }], jahreszeiten: { fruehling: 1, sommer: 1, herbst: 1, winter: 1 } })],
    TRAPS,
  );

  /** A dark night around the player at map tile (5, 5); `sand` paints a sand strip 20–30 tiles east of him. */
  function night(sand: boolean): { w: KreaturWelt; spawned: SimEventMap['creatureSpawned'][] } {
    const w = kreaturWelt(meadow(10, 10), { x: 5, y: 5 }, 1, 'probe', catalog);
    w.cheats.god = true;
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    if (sand) {
      const id = contentWorldIdTables().terrain.runtimeId('sand');
      for (let ty = OFFSET - 30; ty <= OFFSET + 40; ty++) {
        for (let tx = OFFSET + 25; tx <= OFFSET + 35; tx++) {
          const { chunk, i } = w.chunks.at(tx, ty);
          chunk.ground[i] = id;
        }
      }
    }
    const spawned: SimEventMap['creatureSpawned'][] = [];
    for (let s = 0; s < 60; s++) spawned.push(...eventsOf<SimEventMap['creatureSpawned']>(w.run(HZ), 'creatureSpawned'));
    return { w, spawned };
  }

  it('ohne Sand keine Brut, die nur auf Sand erscheint; mit Sandstreifen nur dort', () => {
    expect(night(false).spawned).toEqual([]);
    const { spawned } = night(true);
    expect(spawned.length).toBeGreaterThan(0);
    for (const s of spawned) {
      const tx = Math.floor(s.x / TILE_PX);
      expect(tx).toBeGreaterThanOrEqual(OFFSET + 25);
      expect(tx).toBeLessThanOrEqual(OFFSET + 35);
    }
  });
});
