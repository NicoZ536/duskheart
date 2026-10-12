/**
 * M7-17 Elites des Grünhains (MASTERPROMPT §20.1 „Elites: seltene, stärkere Varianten mit eigenem Muster“; docs/SPIEL.md §26
 * „Kreaturen M7“: „seltene Spawnregel je Biom (höchstens einer je Region, nach Sieg … Ruhe)“):
 * - die Inhalte: Graufang und Alter Hauer der Familie `elite` im Grünhain, stärker als ihre Art, Essenz immer in der Beute,
 *   nur in der Nachtliste der Spawntabelle (die Tagliste bleibt der M6-Stand), §C zählt sie als `elites`;
 * - der Bau: je Wetterregion genau ein Chunk (kleinster Hash aus Seed und Lage), aus Seed und Regionen bestimmt;
 * - die Sperre: ein Elite nur im Bau seiner Region, nie unter Tage, nie ein zweiter, solange einer dort lebt (aktiv oder im
 *   Bestand); andere Familien sperrt sie nie;
 * - der Sieg: der Bau ruht `BALANCE.elites.restDays` (der Nachwuchs-Wecker des Bestands rückt vor);
 * - Aufholen: aktiv ≡ eingefroren + aufgeholt ≡ a → b → c (der Bau wächst gleich nach, mit höchstens einem Elite).
 * - M7-109: Graufang führt ein Rudel – sein Spawn-Eintrag bringt Wölfe mit (`gefolge`), eine Gruppe, ein Rudel; die Ruhe-Regel
 *   des Baus bleibt.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { AI_PROFILES, CREATURES, LOOT_TABLES, SPAWN_TABLES, TRAPS } from '../../../src/content/creatures/index';
import { defineCreatureRecords } from '../../../src/content/creatures/define';
import { spawnTableSchema } from '../../../src/content/creatures/schema';
import { HOURS_PER_DAY } from '../../../src/engine/time';
import { createHitResult } from '../../../src/game/combat/system';
import { CreatureCatalog } from '../../../src/game/creatures/catalog';
import { EliteSpawnRule, ELITE_IDS, lairHash, type EliteCreatures } from '../../../src/game/creatures/elites';
import type { ChunkStock, CreatureState, StoredCreature } from '../../../src/game/creatures/state';
import { Simulation } from '../../../src/game/sim';
import type { ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SHIFT, packChunkId } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';

const E = BALANCE.elites;
const SEED = 11;

/** A creature system as the rule sees it: a store and the stocks. */
function creatures(store: CreatureState[] = [], stocks = new Map<number, ChunkStock>()): EliteCreatures {
  return {
    store: { size: store.length, valueAt: (i) => store[i] as CreatureState },
    population: {
      stocks,
      stockOf: (layer, cx, cy, tick) => {
        const id = packChunkId(layer, cx, cy);
        let s = stocks.get(id);
        if (s === undefined) stocks.set(id, (s = { seeded: true, regrowTick: tick, members: [] }));
        return s;
      },
    },
  };
}

/** Four regions: the quadrants of a small world (32 × 32 chunks). */
const QUADRANT = (tx: number, ty: number): number => (tx < 512 ? 0 : 1) + (ty < 512 ? 0 : 2);

function stored(creature: string, health = 10): StoredCreature {
  return { creature, variant: -1, serial: 1, health, x: 0, y: 0, homeX: 0, homeY: 0, pack: 0, storedTick: 0 };
}

describe('M7-17 Elites: Inhalte', () => {
  it('Graufang und Alter Hauer: Familie elite, Grünhain, stärker als Wolf und Keiler, mit Telegraph und Essenz', () => {
    expect([...ELITE_IDS].sort()).toEqual(['alter_hauer', 'graufang']);
    const def = (id: string) => CONTENT.collection('creatures').get(id);
    for (const [elite, kin] of [['graufang', 'wolf'], ['alter_hauer', 'keiler']] as const) {
      const e = def(elite);
      expect(e.familie).toBe('elite');
      expect(e.biome).toEqual(['gruenhain']);
      expect(e.leben, elite).toBeGreaterThan(def(kin).leben);
      expect(Math.max(...e.angriffe.map((a) => a.schaden)), elite).toBeGreaterThan(Math.max(...def(kin).angriffe.map((a) => a.schaden)));
      // Every attack telegraphs (§19.4: wind-up ≥ 0,3 s).
      for (const a of e.angriffe) expect(a.ausholzeit, `${elite}.${a.name}`).toBeGreaterThanOrEqual(0.3);
      // The essence always drops (one draw of the one entry).
      const loot = CONTENT.collection('lootTables').get(elite);
      expect(loot.ziehungen).toEqual([1, 1]);
      expect(loot.beute).toEqual([{ item: `essenz_${elite}`, gewicht: 1, anzahl: [1, 1] }]);
      expect(CONTENT.collection('items').get(`essenz_${elite}`).name.en.length).toBeGreaterThan(0);
    }
    // §C: counted among the creatures and as elites (M7-62 "≥ 2 Elites").
    expect(CONTENT.countsByCategory().elites).toBeGreaterThanOrEqual(2);
  });

  it('nur in der Nachtliste des Grünhains, selten (BALANCE.elites.spawnWeight); die Tagliste bleibt der M6-Stand', () => {
    const table = SPAWN_TABLES.find((t) => t.id === 'gruenhain');
    expect(table?.tag.some((e) => ELITE_IDS.has(e.kreatur))).toBe(false);
    const night = table?.nacht.filter((e) => ELITE_IDS.has(e.kreatur)) ?? [];
    expect(night.map((e) => e.kreatur).sort()).toEqual(['alter_hauer', 'graufang']);
    for (const e of night) expect([e.gewicht, e.gruppe]).toEqual([E.spawnWeight, [1, 1]]);
    const total = table?.nacht.reduce((s, e) => s + e.gewicht, 0) ?? 0;
    // Rare: together under a tenth of the night's draws.
    expect((2 * E.spawnWeight) / total).toBeLessThan(0.1);
    // No other biome knows them.
    for (const t of SPAWN_TABLES) if (t.id !== 'gruenhain') expect([...t.tag, ...t.nacht].some((e) => ELITE_IDS.has(e.kreatur)), t.id).toBe(false);
  });
});

describe('M7-17 Elites: Bau und Sperre', () => {
  const rule = (seed = SEED, store: CreatureState[] = [], stocks = new Map<number, ChunkStock>()) => new EliteSpawnRule(creatures(store, stocks), { seed, worldSize: 'small', regionAt: QUADRANT });
  const sim = new Simulation({ seed: SEED, worldSize: 'small' });

  it('je Region genau ein Bau: der Chunk mit dem kleinsten Hash, dessen Mitte in ihr liegt; aus dem Seed bestimmt', () => {
    const r = rule();
    const lairs = [...r.allLairs()];
    expect(lairs).toHaveLength(4);
    const chunks = BALANCE.world.sizeTiles.small >> CHUNK_SHIFT;
    for (let region = 0; region < 4; region++) {
      let best = { hash: Infinity, id: -1 };
      for (let cy = 0; cy < chunks; cy++)
        for (let cx = 0; cx < chunks; cx++) {
          if (QUADRANT(cx * 32 + 16, cy * 32 + 16) !== region) continue;
          const h = lairHash(SEED, cx, cy);
          if (h < best.hash) best = { hash: h, id: packChunkId(0, cx, cy) };
        }
      expect(lairs).toContain(best.id);
    }
    expect([...rule().allLairs()]).toEqual(lairs);
    expect([...rule(SEED + 1).allLairs()]).not.toEqual(lairs);
  });

  it('ein Elite nur im Bau, nie unter Tage; andere Familien sperrt die Regel nie', () => {
    const r = rule();
    const lair = [...r.allLairs()][0] as number;
    let lx = -1;
    let ly = -1;
    for (let cy = 0; cy < 32 && lx < 0; cy++) for (let x = 0; x < 32; x++) if (r.isLair(x, cy) && packChunkId(0, x, cy) === lair) [lx, ly] = [x, cy];
    expect(lx).toBeGreaterThanOrEqual(0);
    const tile = (c: number): number => (c << CHUNK_SHIFT) + 7;
    expect(r.blocker(sim, 0, tile(lx), tile(ly), 'elite')).toBe(false);
    expect(r.blocker(sim, -1, tile(lx), tile(ly), 'elite')).toBe(true);
    // Every other chunk of the world refuses an elite; no chunk refuses the others.
    let refused = 0;
    for (let cy = 0; cy < 32; cy++)
      for (let x = 0; x < 32; x++) {
        if (r.isLair(x, cy)) continue;
        if (r.blocker(sim, 0, tile(x), tile(cy), 'elite')) refused++;
        for (const f of ['gegner', 'friedlich', 'schattenbrut'] as const) expect(r.blocker(sim, 0, tile(x), tile(cy), f)).toBe(false);
      }
    expect(refused).toBe(32 * 32 - 4);
    for (const f of ['gegner', 'friedlich', 'schattenbrut'] as const) expect(r.blocker(sim, -1, tile(lx), tile(ly), f)).toBe(false);
  });

  it('höchstens einer je Region: ein lebender Elite daheim im Bau – aktiv oder im Bestand – sperrt den nächsten', () => {
    const base = rule();
    const lair = [...base.allLairs()][1] as number;
    let lx = -1;
    let ly = -1;
    for (let cy = 0; cy < 32; cy++) for (let x = 0; x < 32; x++) if (packChunkId(0, x, cy) === lair) [lx, ly] = [x, cy];
    const t = (c: number): number => (c << CHUNK_SHIFT) + 9;
    // Active at home (also when it stands elsewhere: the home counts).
    const active = { creature: 'graufang', layer: 0, homeCx: lx, homeCy: ly, health: 50 } as CreatureState;
    expect(rule(SEED, [active]).blocker(sim, 0, t(lx), t(ly), 'elite')).toBe(true);
    // Fallen (health 0 until the flush): no longer.
    expect(rule(SEED, [{ ...active, health: 0 } as CreatureState]).blocker(sim, 0, t(lx), t(ly), 'elite')).toBe(false);
    // A wolf at home does not count.
    expect(rule(SEED, [{ ...active, creature: 'wolf' } as CreatureState]).blocker(sim, 0, t(lx), t(ly), 'elite')).toBe(false);
    // Frozen in the lair's stock.
    const stocks = new Map<number, ChunkStock>([[lair, { seeded: true, regrowTick: 0, members: [stored('hase'), stored('alter_hauer')] }]]);
    expect(rule(SEED, [], stocks).blocker(sim, 0, t(lx), t(ly), 'elite')).toBe(true);
    const fallen = new Map<number, ChunkStock>([[lair, { seeded: true, regrowTick: 0, members: [stored('alter_hauer', 0)] }]]);
    expect(rule(SEED, [], fallen).blocker(sim, 0, t(lx), t(ly), 'elite')).toBe(false);
  });

  it('nach dem Sieg ruht der Bau BALANCE.elites.restDays: der Nachwuchs-Wecker rückt vor; andere Tode ändern nichts', () => {
    const s = new Simulation({ seed: SEED, worldSize: 'small', dayLengthMinutes: 24 });
    s.skipTicks(5000);
    const stocks = new Map<number, ChunkStock>();
    const dead = { creature: 'graufang', layer: 0, homeCx: 3, homeCy: 4, health: 0 } as CreatureState;
    const r = rule(SEED, [dead], stocks);
    r.onDeath(s, 'wolf');
    expect(stocks.size).toBe(0);
    r.onDeath(s, 'graufang');
    const rest = Math.round(E.restDays * HOURS_PER_DAY * s.clock.ticksPerGameHour);
    expect(stocks.get(packChunkId(0, 3, 4))?.regrowTick).toBe(s.eventTick + rest);
    expect(E.restDays).toBe(7);
  });
});

/** Grünhain at night: Graufang or a hare, one at a time (every draw a candidate for the lair). */
const PROBE_TABLE = defineCreatureRecords('spawnTables', spawnTableSchema, [
  {
    id: 'gruenhain',
    tag: [{ kreatur: 'hase', gewicht: 1, gruppe: [1, 1] }],
    nacht: [
      { kreatur: 'graufang', gewicht: 1, gruppe: [1, 1] },
      { kreatur: 'hase', gewicht: 1, gruppe: [1, 1] },
    ],
    jahreszeiten: { fruehling: 1, sommer: 1, herbst: 1, winter: 1 },
  },
]);

/** Map tiles of the lair chunk (4, 2) and of a chunk of the other region (4, 3) (OFFSET 64: map 64…95 × 0…31 and 32…63). */
const LAIR = { cx: 4, cy: 2 };
const OTHER = { cx: 4, cy: 3 };
/** The lair is a region of its own (region 1); the rest of the world is region 0. */
const REGION = (tx: number, ty: number): number => (tx >> CHUNK_SHIFT === LAIR.cx && ty >> CHUNK_SHIFT === LAIR.cy ? 1 : 0);

interface EliteWelt {
  readonly w: KreaturWelt;
  readonly rule: EliteSpawnRule;
  chunk(c: { cx: number; cy: number }): ChunkData;
}

/** A meadow of 3 × 2 chunks at night, the player (god mode) in the far corner, the elite rule wired as in the game. */
function eliteWelt(): EliteWelt {
  const catalog = new CreatureCatalog([...CREATURES], [...AI_PROFILES], [...LOOT_TABLES], [...PROBE_TABLE], TRAPS);
  const w = kreaturWelt(meadow(96, 64), { x: 4, y: 4 }, SEED, 'probe', catalog);
  w.cheats.god = true;
  w.cenv.phase = 'nacht';
  const rule = new EliteSpawnRule(w.creatures, { seed: SEED, worldSize: 'small', regionAt: REGION });
  w.creatures.addSpawnBlocker(rule.blocker);
  w.creatures.onDeath(rule.onDeath);
  const gruenhain = contentWorldIdTables().biomes.runtimeId('gruenhain');
  const chunk = (c: { cx: number; cy: number }): ChunkData => {
    const d = w.chunks.get(0, c.cx, c.cy);
    if (d === undefined) throw new Error(`no chunk ${c.cx},${c.cy}`);
    d.biome.fill(gruenhain);
    return d;
  };
  for (const c of [LAIR, OTHER]) {
    const stock = w.creatures.population.stockOf(0, c.cx, c.cy, 0);
    stock.seeded = true;
    stock.regrowTick = w.creatures.population.regrowTicks;
  }
  return { w, rule, chunk };
}

/** The animals of a stock: kind and serial, in order. */
function members(stock: ChunkStock | undefined): string[] {
  return (stock?.members ?? []).map((m) => `${m.creature}#${m.serial}`);
}

describe('M7-17 Elites: Nachwuchs im Bau (aktiv ≡ eingefroren + aufgeholt ≡ a → b → c)', () => {
  const EVENTS = 10;

  it('der Bau bekommt genau einen Elite, der Chunk daneben keinen; zerlegbar und gleich wie aktiv', () => {
    const frozen = eliteWelt();
    expect(frozen.rule.isLair(LAIR.cx, LAIR.cy)).toBe(true);
    expect(frozen.rule.isLair(OTHER.cx, OTHER.cy)).toBe(false);
    const interval = frozen.w.creatures.population.regrowTicks;
    const end = EVENTS * interval + 1;
    frozen.w.creatures.population.catchUp(frozen.chunk(LAIR), 0, end);
    const whole = members(frozen.w.creatures.population.find(0, LAIR.cx, LAIR.cy));
    expect(whole).toHaveLength(BALANCE.spawn.wildlife.maxPerChunk);
    expect(whole.filter((m) => m.startsWith('graufang#'))).toHaveLength(1);
    // The other region's chunk grows hares only.
    frozen.w.creatures.population.catchUp(frozen.chunk(OTHER), 0, end);
    const other = members(frozen.w.creatures.population.find(0, OTHER.cx, OTHER.cy));
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((m) => m.startsWith('hase#'))).toBe(true);

    // a → b → c.
    for (const splits of [[interval, end], [Math.floor(end / 3), Math.floor((2 * end) / 3), end], [interval * 2 + 7, interval * 2 + 7, end]]) {
      const parts = eliteWelt();
      let from = 0;
      for (const to of splits) {
        parts.w.creatures.population.catchUp(parts.chunk(LAIR), from, to);
        from = to;
      }
      expect(members(parts.w.creatures.population.find(0, LAIR.cx, LAIR.cy)), splits.join(' → ')).toEqual(whole);
    }

    // Active: the lair in the zone, every regrowth on the world tick after a jump.
    const active = eliteWelt();
    active.w.zone.list.push(active.chunk(LAIR));
    for (let k = 1; k <= EVENTS; k++) {
      active.w.sim.skipTicks(Math.max(0, k * interval - active.w.sim.tick));
      active.w.run(BALANCE.time.tickHz + 1);
    }
    const home: string[] = [];
    for (let i = 0; i < active.w.creatures.store.size; i++) {
      const s = active.w.creatures.store.valueAt(i);
      if (s.homeCx === LAIR.cx && s.homeCy === LAIR.cy) home.push(`${s.creature}#${s.serial}`);
    }
    expect(home.sort()).toEqual([...whole].sort());
  });

  it('fällt der Elite, wächst im Bau BALANCE.elites.restDays nichts nach; danach wieder', () => {
    const g = eliteWelt();
    g.w.zone.list.push(g.chunk(LAIR));
    const interval = g.w.creatures.population.regrowTicks;
    g.w.sim.skipTicks(interval);
    g.w.run(BALANCE.time.tickHz + 1);
    // Fill the lair until its elite is there.
    let elite = -1;
    for (let k = 2; k <= 40 && elite < 0; k++) {
      g.w.sim.skipTicks(Math.max(0, k * interval - g.w.sim.tick));
      g.w.run(BALANCE.time.tickHz + 1);
      for (let i = 0; i < g.w.creatures.store.size; i++) if (g.w.creatures.store.valueAt(i).creature === 'graufang') elite = i;
    }
    expect(elite).toBeGreaterThanOrEqual(0);
    const e = g.w.creatures.store.entityAt(elite);
    g.w.creatures.targets.applyHit(g.w.sim, e, { ...createHitResult(), attacker: g.w.sim.player, amount: 1e6 });
    g.w.run(2);
    const stock = g.w.creatures.population.find(0, LAIR.cx, LAIR.cy);
    const rest = Math.round(E.restDays * HOURS_PER_DAY * g.w.sim.clock.ticksPerGameHour);
    expect(stock?.regrowTick ?? 0).toBeGreaterThanOrEqual(g.w.sim.tick + rest - 3);
    const count = (): number => {
      let n = 0;
      for (let i = 0; i < g.w.creatures.store.size; i++) {
        const s = g.w.creatures.store.valueAt(i);
        if (s.homeCx === LAIR.cx && s.homeCy === LAIR.cy && s.health > 0) n++;
      }
      return n;
    };
    const before = count();
    expect(before).toBeLessThan(BALANCE.spawn.wildlife.maxPerChunk);
    // A day before the rest ends: still nothing new.
    g.w.sim.skipTicks(rest - g.w.sim.clock.ticksPerDay);
    g.w.run(BALANCE.time.tickHz + 1);
    expect(count()).toBe(before);
    // After it: the lair grows again.
    g.w.sim.skipTicks(2 * g.w.sim.clock.ticksPerDay);
    g.w.run(BALANCE.time.tickHz + 1);
    expect(count()).toBeGreaterThan(before);
  });
});

/** Grünhain at night as the content draws Graufang – with his pack (`gefolge`, M7-109) – or a hare. */
const PACK_TABLE = defineCreatureRecords('spawnTables', spawnTableSchema, [
  {
    id: 'gruenhain',
    tag: [{ kreatur: 'hase', gewicht: 1, gruppe: [1, 1] }],
    nacht: [
      { kreatur: 'graufang', gewicht: 1, gruppe: [1, 1], gefolge: { kreatur: 'wolf', gruppe: [E.packFollowers.min, E.packFollowers.max] } },
      { kreatur: 'hase', gewicht: 1, gruppe: [1, 1] },
    ],
    jahreszeiten: { fruehling: 1, sommer: 1, herbst: 1, winter: 1 },
  },
]);

/** The elite world of the lair tests on the pack table. */
function packWelt(): EliteWelt {
  const catalog = new CreatureCatalog([...CREATURES], [...AI_PROFILES], [...LOOT_TABLES], [...PACK_TABLE], TRAPS);
  const w = kreaturWelt(meadow(96, 64), { x: 4, y: 4 }, SEED, 'probe', catalog);
  w.cheats.god = true;
  w.cenv.phase = 'nacht';
  const rule = new EliteSpawnRule(w.creatures, { seed: SEED, worldSize: 'small', regionAt: REGION });
  w.creatures.addSpawnBlocker(rule.blocker);
  w.creatures.onDeath(rule.onDeath);
  const gruenhain = contentWorldIdTables().biomes.runtimeId('gruenhain');
  const chunk = (c: { cx: number; cy: number }): ChunkData => {
    const d = w.chunks.get(0, c.cx, c.cy);
    if (d === undefined) throw new Error(`no chunk ${c.cx},${c.cy}`);
    d.biome.fill(gruenhain);
    return d;
  };
  const stock = w.creatures.population.stockOf(0, LAIR.cx, LAIR.cy, 0);
  stock.seeded = true;
  stock.regrowTick = w.creatures.population.regrowTicks;
  return { w, rule, chunk };
}

describe('M7-109 Graufang führt ein Rudel (Spawn-Eintrag `gefolge`)', () => {
  it('der Inhalt: Graufangs Nachteintrag bringt BALANCE.elites.packFollowers Wölfe mit, der Alte Hauer ist ein Einzelgänger', () => {
    const night = SPAWN_TABLES.find((t) => t.id === 'gruenhain')?.nacht ?? [];
    expect(night.find((e) => e.kreatur === 'graufang')?.gefolge).toEqual({ kreatur: 'wolf', gruppe: [E.packFollowers.min, E.packFollowers.max] });
    expect(night.find((e) => e.kreatur === 'alter_hauer')?.gefolge).toBeUndefined();
    // Graufang leads: his profile has the pack ring the wolves join.
    expect(AI_PROFILES.find((p) => p.id === 'graufang')?.rudel).toBeDefined();
    // The pack never overfills the lair: leader and pack fit the chunk's room.
    expect(1 + E.packFollowers.max).toBeLessThanOrEqual(BALANCE.spawn.wildlife.maxPerChunk);
  });

  it('Graufang erscheint mit Gefolge – ein Rudel (eine Rudelnummer) – im eingefrorenen Bau wie im aktiven, a → b → c gleich', () => {
    const interval = (w: EliteWelt): number => w.w.creatures.population.regrowTicks;
    const frozen = packWelt();
    const end = 12 * interval(frozen) + 1;
    // Catch up event by event until Graufang is in the stock.
    let at = 0;
    let stock = frozen.w.creatures.population.find(0, LAIR.cx, LAIR.cy);
    while (at < end && !(stock?.members ?? []).some((m) => m.creature === 'graufang')) {
      frozen.w.creatures.population.catchUp(frozen.chunk(LAIR), at, at + interval(frozen));
      at += interval(frozen);
      stock = frozen.w.creatures.population.find(0, LAIR.cx, LAIR.cy);
    }
    const ms = stock?.members ?? [];
    const leader = ms.find((m) => m.creature === 'graufang');
    expect(leader).toBeDefined();
    expect(leader?.pack).toBeGreaterThan(0);
    const pack = ms.filter((m) => m.pack === leader?.pack);
    const wolves = pack.filter((m) => m.creature === 'wolf');
    expect(wolves.length).toBeGreaterThanOrEqual(Math.min(E.packFollowers.min, BALANCE.spawn.wildlife.maxPerChunk - (ms.length - pack.length) - 1));
    expect(wolves.length).toBeLessThanOrEqual(E.packFollowers.max);
    expect(pack).toHaveLength(1 + wolves.length);
    // The wolves stand near their leader (the group's spread).
    for (const wv of wolves) expect(Math.hypot(wv.x - (leader?.x ?? 0), wv.y - (leader?.y ?? 0))).toBeLessThanOrEqual(4 * 16);
    const whole = members(stock);

    // a → b → c: the same stock, the same pack.
    for (const splits of [[Math.floor(at / 2), at], [interval(frozen) * 2 + 5, at - 7, at]]) {
      const parts = packWelt();
      let from = 0;
      for (const to of splits) {
        parts.w.creatures.population.catchUp(parts.chunk(LAIR), from, to);
        from = to;
      }
      expect(members(parts.w.creatures.population.find(0, LAIR.cx, LAIR.cy)), splits.join(' → ')).toEqual(whole);
    }

    // Active: the lair in the zone grows the same animals, Graufang and his wolves sharing one pack.
    const active = packWelt();
    active.w.zone.list.push(active.chunk(LAIR));
    for (let k = 1; k * interval(active) <= at; k++) {
      active.w.sim.skipTicks(Math.max(0, k * interval(active) - active.w.sim.tick));
      active.w.run(BALANCE.time.tickHz + 1);
    }
    const home: CreatureState[] = [];
    for (let i = 0; i < active.w.creatures.store.size; i++) {
      const s = active.w.creatures.store.valueAt(i);
      if (s.homeCx === LAIR.cx && s.homeCy === LAIR.cy) home.push(s);
    }
    expect(home.map((s) => `${s.creature}#${s.serial}`).sort()).toEqual([...whole].sort());
    const boss = home.find((s) => s.creature === 'graufang');
    expect(boss?.pack).toBeGreaterThan(0);
    expect(home.filter((s) => s.pack === boss?.pack && s.creature === 'wolf')).toHaveLength(wolves.length);
  });

  it('die Ruhe-Regel des Baus bleibt: fällt Graufang, wächst im Bau nichts nach – sein Rudel lebt weiter', () => {
    const g = packWelt();
    g.w.zone.list.push(g.chunk(LAIR));
    const interval = g.w.creatures.population.regrowTicks;
    let elite = -1;
    for (let k = 1; k <= 40 && elite < 0; k++) {
      g.w.sim.skipTicks(Math.max(0, k * interval - g.w.sim.tick));
      g.w.run(BALANCE.time.tickHz + 1);
      for (let i = 0; i < g.w.creatures.store.size; i++) if (g.w.creatures.store.valueAt(i).creature === 'graufang') elite = i;
    }
    expect(elite).toBeGreaterThanOrEqual(0);
    const leader = g.w.creatures.store.valueAt(elite);
    const pack = leader.pack;
    const wolvesOf = (): number => {
      let n = 0;
      for (let i = 0; i < g.w.creatures.store.size; i++) {
        const s = g.w.creatures.store.valueAt(i);
        if (s.creature === 'wolf' && s.pack === pack && s.health > 0) n++;
      }
      return n;
    };
    const wolves = wolvesOf();
    expect(wolves).toBeGreaterThan(0);
    g.w.creatures.targets.applyHit(g.w.sim, g.w.creatures.store.entityAt(elite), { ...createHitResult(), attacker: g.w.sim.player, amount: 1e6 });
    g.w.run(2);
    const rest = Math.round(E.restDays * HOURS_PER_DAY * g.w.sim.clock.ticksPerGameHour);
    expect(g.w.creatures.population.find(0, LAIR.cx, LAIR.cy)?.regrowTick ?? 0).toBeGreaterThanOrEqual(g.w.sim.tick + rest - 3);
    expect(wolvesOf()).toBe(wolves);
    // A day before the rest ends: no new Graufang, no new animal in the lair.
    const before = g.w.creatures.store.size;
    g.w.sim.skipTicks(rest - g.w.sim.clock.ticksPerDay);
    g.w.run(BALANCE.time.tickHz + 1);
    let graufang = 0;
    for (let i = 0; i < g.w.creatures.store.size; i++) if (g.w.creatures.store.valueAt(i).creature === 'graufang' && g.w.creatures.store.valueAt(i).health > 0) graufang++;
    expect(graufang).toBe(0);
    expect(g.w.creatures.store.size).toBeLessThanOrEqual(before);
  });
});
