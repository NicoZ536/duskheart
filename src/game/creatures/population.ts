/**
 * Populations of the wild animals (docs/SPIEL.md §11 "Bestand und Spawn"; MASTERPROMPT §20.1; M6-27): who lives in a
 * chunk, when an animal grows back, and what a frozen chunk's animals and traps did while nobody watched.
 *
 * - **First population:** when a chunk becomes active for the first time, `planSeed` draws its animals from the spawn
 *   table of the biome at the chunk's centre – the day list by day and at dusk, the night list at night (underground at
 *   every hour), entries of the season only – `BALANCE.spawn.wildlife.initialPerChunk` × the table's season factor, in groups of the entries' sizes
 *   (packs share a pack number). The draws come from a generator seeded by world seed, layer and chunk (not the shared
 *   stream): a chunk looks the same whichever way the player reaches it.
 * - **Regrowth:** every `regrowGameHours` a chunk below `maxPerChunk` may gain a group (chance = the season factor,
 *   capped at 1) – with the table of the hour and season of that moment and a generator seeded by chunk and tick. Active
 *   chunks grow on the world tick (the creature system), frozen ones in `catchUp`, event by event at the same ticks, so
 *   a chunk that was frozen from a to c holds what an active one would have grown (minus the wandering).
 * - **Frozen chunks** (`catchUp`): the stock grows back into the chunk's members, and armed traps in it catch
 *   (`TrapDef.fangStunden`, drawn from the trap and the tick of each attempt). Events run in tick order (regrowth
 *   before traps on the same tick, traps by id). Everything depends only on the chunk's stock, its traps and absolute
 *   ticks: catching up a → c equals a → b → c, and `from === to` changes nothing. Members heal when they come back to
 *   life (`storedTick`, `healedHealth`) rather than here, which keeps the arithmetic exact for any split.
 * - Placement: interior tiles of the chunk only (`interiorTile`, M6-16e), on ground the kind may stand on
 *   (`placeable`), live spawns at least `minPlayerDistanceTiles` from the player; a group spreads around its first tile.
 *   An entry with a site (`ort`, M6-27b: ground, water depth, water nearby – frogs by the water, crabs on sand, jellyfish in
 *   shallow water) draws its first tile among the interior tiles that fit it, so a chunk with a single pond still gets its
 *   frogs; a member that would stand off the site shares the first tile. A chunk without such a tile gets none.
 *
 * Shadow brood never enters a stock: it is spawned around the player at night and leaves with its chunk (§12.4).
 */
import { BALANCE } from '../../content/balance';
import type { SpawnEntry, SpawnSite, SpawnTableDef } from '../../content/creatures/schema';
import { Rng, hash3, hashCombine } from '../../engine/rng';
import { WATER_DEPTH_MASK, WATER_DEPTH_DEEP, WATER_DEPTH_SHALLOW, WATER_FROZEN, type ChunkData } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, CHUNK_SIZE, TILE_PX, layerIndex, packChunkId, unpackChunkId, type ChunkCoord, type Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import type { Simulation } from '../sim';
import type { CreatureCatalog, CreatureKind } from './catalog';
import type { CreatureEnvironment, CreatureTime } from './environment';
import { regrowIntervalTicks } from './formulas';
import type { ChunkStock, StoredCreature, savedChunkStockSchema } from './state';
import { INTERIOR_TILES, ZONE_MARGIN_TILES, interiorTile } from './zone';
import type { z } from 'zod';

const W = BALANCE.spawn.wildlife;
/** Salts of the chunk generators: the first population, regrowth, trap attempts. */
const SALT_SEED = 0x5eed;
const SALT_REGROW = 0x9e0;
const SALT_TRAP = 0x7a9;
/** Salts of different layers never meet (salts stay below it). */
const SALT_LAYER_STRIDE = 65536;
/** Tiles a group member may lie from the group's first tile. */
const GROUP_SPREAD = W.groupSpreadTiles;
/** 2^32: the high part of a tick in a seed. */
const U32 = 4294967296;

/** A creature to create (a live entity or a stock member). */
export interface SpawnPlan {
  kind: CreatureKind;
  /** Index of its variant (`varianten`) for the biome, −1 for the base form. */
  variant: number;
  /** Position [px]. */
  x: number;
  y: number;
  /** Group number within one planning call (members of one group share a pack). */
  group: number;
}

/** A trap as the frozen catch-up reads it (src/game/creatures/traps.ts). */
export interface FrozenTrap {
  readonly id: number;
  readonly item: string;
  /** Next attempt in a frozen chunk [tick], −1 none. */
  catchTick: number;
}

/** The traps of the frozen catch-up. */
export interface PopulationTraps {
  /** Armed traps (nothing caught yet) in chunk (cx, cy) of `layer`, by ascending id, into `out`. */
  armedIn(layer: Layer, cx: number, cy: number, out: FrozenTrap[]): FrozenTrap[];
  /** A frozen trap caught `creature` at `tick`. */
  caught(trap: FrozenTrap, creature: string, tick: number): void;
}

/** What the population reads. */
export interface PopulationDeps {
  readonly sim: Simulation;
  readonly catalog: CreatureCatalog;
  readonly environment: CreatureEnvironment;
  /** Whether a body of `kind` may appear on tile (tx, ty) of `layer` (its ground or water, nothing in the way). */
  readonly placeable: (kind: CreatureKind, layer: Layer, tx: number, ty: number) => boolean;
}

/** Where the player stands (live placements keep their distance), or `null`. */
export interface PlayerSpot {
  layer: Layer;
  x: number;
  y: number;
}

/** Seed of a generator from a chunk, a salt and a tick (the tick's high part folded in). */
function chunkSeed(worldSeed: number, layer: Layer, cx: number, cy: number, salt: number, tick: number): number {
  return hash3(cx, cy, layerIndex(layer) * SALT_LAYER_STRIDE + salt, hashCombine(hashCombine(worldSeed, tick >>> 0), Math.floor(tick / U32)));
}

/** The ground and water of tiles as a spawn site reads them (M6-27b). */
export interface SpawnGround {
  /** Terrain id of the ground of tile (tx, ty) of `layer`, or `null` (no ground, no chunk). */
  ground(layer: Layer, tx: number, ty: number): string | null;
  /** The `water` byte of tile (tx, ty) of `layer` (0 where there is no chunk). */
  water(layer: Layer, tx: number, ty: number): number;
}

/** Whether a `water` byte holds unfrozen water. */
function openWater(w: number): boolean {
  return (w & WATER_DEPTH_MASK) !== 0 && (w & WATER_FROZEN) === 0;
}

/**
 * Whether tile (tx, ty) of `layer` fits the spawn site `site` (M6-27b): its dry ground is one of `boden`, its unfrozen water
 * has the depth `wasser`, unfrozen water lies within `wasserNaehe` tiles (Euclidean, the tile itself included).
 */
export function spawnSiteFits(site: SpawnSite, ground: SpawnGround, layer: Layer, tx: number, ty: number): boolean {
  const w = ground.water(layer, tx, ty);
  if (site.boden !== undefined) {
    const g = ground.ground(layer, tx, ty);
    if ((w & WATER_DEPTH_MASK) !== 0 || g === null || !site.boden.includes(g)) return false;
  }
  if (site.wasser !== undefined) {
    const depth = site.wasser === 'flach' ? WATER_DEPTH_SHALLOW : WATER_DEPTH_DEEP;
    if (!openWater(w) || (w & WATER_DEPTH_MASK) !== depth) return false;
  }
  const r = site.wasserNaehe;
  if (r !== undefined) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r && openWater(ground.water(layer, tx + dx, ty + dy))) return true;
      }
    }
    return false;
  }
  return true;
}

/** Biome id of tile index `i` of `chunk`, or `null`. */
function biomeOf(chunk: ChunkData, i: number): string | null {
  const id = chunk.biome[i] as number;
  return id === 0 ? null : contentWorldIdTables().biomes.stringId(id);
}

/** Index of the variant of `kind` for `biome`, −1 for the base form. */
export function variantFor(kind: CreatureKind, biome: string | null): number {
  const list = kind.def.varianten;
  if (list === undefined || biome === null) return -1;
  for (let i = 0; i < list.length; i++) if ((list[i]?.biome ?? []).includes(biome)) return i;
  return -1;
}

/** The stocks of every chunk that was ever active, and their growth. */
export class CreaturePopulation {
  /** Next serial number of a creature. */
  serial = 1;
  /** Next pack number. */
  pack = 1;
  /** Stocks by packed chunk id. */
  readonly stocks = new Map<number, ChunkStock>();
  private readonly rng = new Rng(0);
  private readonly time: CreatureTime = { phase: 'tag', season: 'fruehling' };
  private readonly weights: number[] = [];
  private readonly entries: SpawnEntry[] = [];
  private readonly plans: SpawnPlan[] = [];
  private readonly trapList: FrozenTrap[] = [];
  private readonly coord: ChunkCoord = { layer: 0, cx: 0, cy: 0 };
  private traps: PopulationTraps | null = null;
  /** Interior tiles fitting a spawn site (packed `ty * CHUNK_SIZE + tx` local), held. */
  private readonly sites = new Int32Array(INTERIOR_TILES * INTERIOR_TILES);
  /** The chunk whose tiles `siteGround` reads (planning is chunk by chunk; a site never reaches beyond the interior margin). */
  private siteChunk: ChunkData | null = null;
  private readonly siteGround: SpawnGround = {
    ground: (_layer, tx, ty) => {
      const c = this.siteChunk;
      if (c === null || tx >> CHUNK_SHIFT !== c.cx || ty >> CHUNK_SHIFT !== c.cy) return null;
      const id = c.ground[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number;
      return id === 0 ? null : contentWorldIdTables().terrain.stringId(id);
    },
    water: (_layer, tx, ty) => {
      const c = this.siteChunk;
      if (c === null || tx >> CHUNK_SHIFT !== c.cx || ty >> CHUNK_SHIFT !== c.cy) return 0;
      return c.water[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number;
    },
  };

  constructor(private readonly deps: PopulationDeps) {}

  /** Binds the traps (frozen catches). */
  useTraps(traps: PopulationTraps): void {
    this.traps = traps;
  }

  /** Ticks between two regrowth events. */
  get regrowTicks(): number {
    return regrowIntervalTicks(this.deps.sim.clock.ticksPerGameHour);
  }

  /** The stock of chunk (cx, cy) of `layer`, created unseeded (its clock starting at `tick`) when missing. */
  stockOf(layer: Layer, cx: number, cy: number, tick: number): ChunkStock {
    const id = packChunkId(layer, cx, cy);
    let s = this.stocks.get(id);
    if (s === undefined) {
      s = { seeded: false, regrowTick: tick + this.regrowTicks, members: [] };
      this.stocks.set(id, s);
    }
    return s;
  }

  /** The stock of chunk (cx, cy) of `layer`, or `undefined`. */
  find(layer: Layer, cx: number, cy: number): ChunkStock | undefined {
    return this.stocks.get(packChunkId(layer, cx, cy));
  }

  /** Spawn table of the biome at the centre of `chunk`, or `undefined`. */
  tableOf(chunk: ChunkData): SpawnTableDef | undefined {
    const biome = biomeOf(chunk, (CHUNK_SIZE / 2) * CHUNK_SIZE + CHUNK_SIZE / 2);
    return biome === null ? undefined : this.deps.catalog.spawnTable(biome);
  }

  /** The first population of `chunk`, activated in tick `tick` (see module comment). The plans are held until the next call. */
  planSeed(chunk: ChunkData, tick: number, player: PlayerSpot | null): readonly SpawnPlan[] {
    const plans = this.plans;
    plans.length = 0;
    const table = this.tableOf(chunk);
    if (table === undefined) return plans;
    const time = this.deps.environment.timeAt(this.deps.sim, tick, this.time);
    const target = Math.min(W.maxPerChunk, Math.round(W.initialPerChunk * (table.jahreszeiten[time.season] ?? 0)));
    this.rng.seed(chunkSeed(this.deps.sim.config.seed, chunk.layer, chunk.cx, chunk.cy, SALT_SEED, 0));
    let group = 0;
    // One attempt per animal at most: a group that finds no place leaves room for the next.
    for (let attempt = 0; attempt < target && plans.length < target; attempt++) {
      if (!this.planGroup(chunk, table, time, target - plans.length, group, player)) continue;
      group++;
    }
    return plans;
  }

  /**
   * The regrowth event at tick `tick` of `chunk` holding `count` animals: a group grows back with the chance of the
   * season's factor, up to `maxPerChunk`. The plans are held until the next call.
   */
  planRegrow(chunk: ChunkData, tick: number, count: number, player: PlayerSpot | null): readonly SpawnPlan[] {
    const plans = this.plans;
    plans.length = 0;
    if (count >= W.maxPerChunk) return plans;
    const table = this.tableOf(chunk);
    if (table === undefined) return plans;
    const time = this.deps.environment.timeAt(this.deps.sim, tick, this.time);
    this.rng.seed(chunkSeed(this.deps.sim.config.seed, chunk.layer, chunk.cx, chunk.cy, SALT_REGROW, tick));
    if (this.rng.next() >= Math.min(1, table.jahreszeiten[time.season] ?? 0)) return plans;
    this.planGroup(chunk, table, time, W.maxPerChunk - count, 0, player);
    return plans;
  }

  /** Plans one group of at most `room` animals; false when no entry fits or no place was found. */
  private planGroup(chunk: ChunkData, table: SpawnTableDef, time: CreatureTime, room: number, group: number, player: PlayerSpot | null): boolean {
    const entry = this.pickEntry(table.tag, table.nacht, time, chunk.layer);
    if (entry === null) return false;
    const kind = this.deps.catalog.get(entry.kreatur);
    const size = Math.min(room, entry.gruppe[0] === entry.gruppe[1] ? entry.gruppe[0] : this.rng.int(entry.gruppe[0], entry.gruppe[1] + 1));
    const x0 = (chunk.cx << CHUNK_SHIFT) + ZONE_MARGIN_TILES;
    const y0 = (chunk.cy << CHUNK_SHIFT) + ZONE_MARGIN_TILES;
    const site = entry.ort;
    this.siteChunk = chunk;
    let ftx = -1;
    let fty = -1;
    if (site !== undefined) {
      // A site: one of the interior tiles that fit it (scanned in row order, drawn uniformly).
      let n = 0;
      for (let ly = 0; ly < INTERIOR_TILES; ly++) {
        for (let lx = 0; lx < INTERIOR_TILES; lx++) {
          if (this.fitsSite(kind, site, chunk.layer, x0 + lx, y0 + ly, player)) this.sites[n++] = ly * INTERIOR_TILES + lx;
        }
      }
      if (n > 0) {
        const at = this.sites[this.rng.int(0, n)] as number;
        ftx = x0 + (at % INTERIOR_TILES);
        fty = y0 + Math.floor(at / INTERIOR_TILES);
      }
    } else {
      for (let t = 0; t < W.placeTries; t++) {
        const tx = x0 + this.rng.int(0, INTERIOR_TILES);
        const ty = y0 + this.rng.int(0, INTERIOR_TILES);
        if (!this.fits(kind, chunk.layer, tx, ty, player)) continue;
        ftx = tx;
        fty = ty;
        break;
      }
    }
    if (ftx < 0) return false;
    const variant = variantFor(kind, biomeOf(chunk, (((fty - (chunk.cy << CHUNK_SHIFT)) << CHUNK_SHIFT) | (ftx - (chunk.cx << CHUNK_SHIFT))) >>> 0));
    for (let k = 0; k < size; k++) {
      let tx = ftx;
      let ty = fty;
      if (k > 0) {
        // A member next to the first; where that is blocked it shares the first tile (the separation spreads them).
        const nx = ftx + this.rng.int(-GROUP_SPREAD, GROUP_SPREAD + 1);
        const ny = fty + this.rng.int(-GROUP_SPREAD, GROUP_SPREAD + 1);
        if (nx >> CHUNK_SHIFT === chunk.cx && ny >> CHUNK_SHIFT === chunk.cy && (site === undefined ? this.fits(kind, chunk.layer, nx, ny, player) : this.fitsSite(kind, site, chunk.layer, nx, ny, player))) {
          tx = nx;
          ty = ny;
        }
      }
      this.plans.push({ kind, variant, x: (tx + 1 / 2) * TILE_PX, y: (ty + 1 / 2) * TILE_PX, group });
    }
    return true;
  }

  /** `fits` on the site of an entry (the chunk being planned is `siteChunk`). */
  private fitsSite(kind: CreatureKind, site: SpawnSite, layer: Layer, tx: number, ty: number, player: PlayerSpot | null): boolean {
    return spawnSiteFits(site, this.siteGround, layer, tx, ty) && this.fits(kind, layer, tx, ty, player);
  }

  private fits(kind: CreatureKind, layer: Layer, tx: number, ty: number, player: PlayerSpot | null): boolean {
    if (!interiorTile(tx, ty) || !this.deps.placeable(kind, layer, tx, ty)) return false;
    if (player === null || player.layer !== layer) return true;
    const dx = (tx + 1 / 2) * TILE_PX - player.x;
    const dy = (ty + 1 / 2) * TILE_PX - player.y;
    const min = W.minPlayerDistanceTiles * TILE_PX;
    return dx * dx + dy * dy >= min * min;
  }

  /**
   * A weighted entry of the list of the time (day list by day and at dusk; underground the night list at every hour), of
   * the season, no shadow brood; or `null`.
   */
  private pickEntry(day: readonly SpawnEntry[], night: readonly SpawnEntry[], time: CreatureTime, layer: Layer): SpawnEntry | null {
    const list = time.phase === 'nacht' || layer < 0 ? night : day;
    const entries = this.entries;
    const weights = this.weights;
    entries.length = 0;
    weights.length = 0;
    for (const e of list) {
      if (e.jahreszeiten !== undefined && !e.jahreszeiten.includes(time.season)) continue;
      if (this.deps.catalog.get(e.kreatur).shadow) continue;
      entries.push(e);
      weights.push(e.gewicht);
    }
    if (entries.length === 0) return null;
    return entries[this.rng.weightedIndex(weights)] as SpawnEntry;
  }

  /**
   * Catch-up of a frozen chunk from `from` to `to` (see module comment): regrowth into the stock and the attempts of its
   * armed traps, in tick order.
   */
  catchUp(chunk: ChunkData, from: number, to: number): void {
    const stock = this.stocks.get(packChunkId(chunk.layer, chunk.cx, chunk.cy));
    if (stock === undefined || !stock.seeded || to <= from) return;
    const traps = this.traps === null ? this.trapList : this.traps.armedIn(chunk.layer, chunk.cx, chunk.cy, this.trapList);
    if (this.traps === null) traps.length = 0;
    const interval = this.regrowTicks;
    for (;;) {
      let trap: FrozenTrap | null = null;
      for (const t of traps) if (t.catchTick >= 0 && t.catchTick <= to && (trap === null || t.catchTick < trap.catchTick)) trap = t;
      const regrow = stock.regrowTick <= to;
      if (!regrow && trap === null) return;
      if (regrow && (trap === null || stock.regrowTick <= trap.catchTick)) {
        this.growInto(chunk, stock, stock.regrowTick);
        stock.regrowTick += interval;
        continue;
      }
      this.attempt(chunk, stock, trap as FrozenTrap);
    }
  }

  /** Regrowth event at `tick` of a frozen chunk: the planned group joins its stock. */
  private growInto(chunk: ChunkData, stock: ChunkStock, tick: number): void {
    const plans = this.planRegrow(chunk, tick, stock.members.length, null);
    const pack = plans.length > 1 && plans[0]?.kind.profile.rudel !== undefined ? this.pack++ : 0;
    for (const p of plans) {
      stock.members.push({
        creature: p.kind.id,
        variant: p.variant,
        serial: this.serial++,
        health: maxHealthOf(p.kind, p.variant),
        x: p.x,
        y: p.y,
        homeX: p.x,
        homeY: p.y,
        pack,
        storedTick: tick,
      });
    }
  }

  /** A frozen trap's attempt at its `catchTick`: the first catchable member of the stock may be caught; else it tries again later. */
  private attempt(chunk: ChunkData, stock: ChunkStock, trap: FrozenTrap): void {
    const tick = trap.catchTick;
    const def = this.deps.catalog.trap(trap.item);
    this.rng.seed(chunkSeed(this.deps.sim.config.seed, chunk.layer, chunk.cx, chunk.cy, SALT_TRAP + trap.id, tick));
    const roll = this.rng.next();
    trap.catchTick = def === undefined ? -1 : tick + this.catchDelay(def.fangStunden, this.rng);
    if (def === undefined || roll >= def.chance) return;
    const i = stock.members.findIndex((m) => {
      const k = this.deps.catalog.find(m.creature);
      return k !== undefined && k.def.fangbar && k.def.groesse <= def.groesseMax;
    });
    if (i < 0) return;
    const [m] = stock.members.splice(i, 1);
    trap.catchTick = -1;
    this.traps?.caught(trap, (m as StoredCreature).creature, tick);
  }

  /** Ticks until a frozen trap's next attempt: `fangStunden` drawn from `rng`. */
  catchDelay(hours: readonly [number, number], rng: Rng): number {
    const h = hours[0] === hours[1] ? hours[0] : rng.float(hours[0], hours[1]);
    return Math.max(1, Math.round(h * this.deps.sim.clock.ticksPerGameHour));
  }

  /** Schedules the first frozen attempt of a trap in a chunk that freezes at `tick` (its generator: trap and tick). */
  scheduleTrap(layer: Layer, cx: number, cy: number, trap: FrozenTrap, tick: number): void {
    const def = this.deps.catalog.trap(trap.item);
    if (def === undefined) {
      trap.catchTick = -1;
      return;
    }
    this.rng.seed(chunkSeed(this.deps.sim.config.seed, layer, cx, cy, SALT_TRAP + trap.id, tick));
    trap.catchTick = tick + this.catchDelay(def.fangStunden, this.rng);
  }

  // -------------------------------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------------------------------

  /** The stocks by ascending chunk id. */
  serialize(): z.input<typeof savedChunkStockSchema>[] {
    const out: z.input<typeof savedChunkStockSchema>[] = [];
    const c = this.coord;
    for (const id of [...this.stocks.keys()].sort((a, b) => a - b)) {
      const s = this.stocks.get(id) as ChunkStock;
      unpackChunkId(id, c);
      out.push({ layer: c.layer, cx: c.cx, cy: c.cy, seeded: s.seeded, regrowTick: s.regrowTick, members: s.members.map((m) => ({ ...m })) });
    }
    return out;
  }

  /** Restores parsed stocks (the caller validated them). */
  restore(chunks: readonly z.output<typeof savedChunkStockSchema>[], serial: number, pack: number): void {
    this.stocks.clear();
    for (const c of chunks) {
      const id = packChunkId(c.layer as Layer, c.cx, c.cy);
      if (this.stocks.has(id)) throw new TypeError(`creatures snapshot invalid: chunk ${c.layer}:${c.cx}:${c.cy} twice`);
      for (const m of c.members) if (!this.deps.catalog.has(m.creature)) throw new TypeError(`creatures snapshot invalid: unknown creature "${m.creature}"`);
      this.stocks.set(id, { seeded: c.seeded, regrowTick: c.regrowTick, members: c.members.map((m) => ({ ...m })) });
    }
    this.serial = serial;
    this.pack = pack;
  }
}

/** Maximum health of `kind` in variant `variant` [HP]. */
export function maxHealthOf(kind: CreatureKind, variant: number): number {
  const v = variant >= 0 ? kind.def.varianten?.[variant] : undefined;
  return kind.def.leben * (v?.leben ?? 1);
}
