/**
 * Test support for the field tests (wachstum, klimaprotokoll, farm-qualitaet, gewaechshaus, the `farming` roundtrip): one drawn
 * chunk of Grünhain (layer 0, chunk (4, 4), tiles 128…159, all of weather region 0), the farming system on a bare simulation
 * with the bags, and either the real weather automaton of the seed (`wetter: 'echt'`) or a log fed by hand (`'hand'`).
 *
 * Time moves like in the game: `morgen()` jumps the clock to the next 06:00 with the zone active – the weather heard on the way,
 * the farming system's world tick and its `dailyTick` at the dawn –, `einfrieren()`/`aufwachen()` freeze the chunk and let it
 * catch up (`FarmingSystem.catchUp` over the frozen span, as the catch-up registry does when a chunk comes back).
 */
import { BALANCE } from '../../../src/content/balance';
import { ITEMS } from '../../../src/content/items/index';
import type { WeatherStateId } from '../../../src/content/weather';
import { FarmingSystem, createFarmPlot, type FarmSkills, type FarmSurroundings } from '../../../src/game/farming/index';
import type { FarmPlot } from '../../../src/game/farming/types';
import { PlayerBags } from '../../../src/game/inventory/bags';
import { InventorySystem } from '../../../src/game/inventory/system';
import { ItemCatalog } from '../../../src/game/items/catalog';
import type { ItemStack } from '../../../src/game/items/stack';
import { Simulation } from '../../../src/game/sim';
import { Calendar } from '../../../src/world/calendar';
import { minuteOf } from '../../../src/world/climate/gameTime';
import { WeatherSystem } from '../../../src/world/climate/weather';
import { ChunkData, WATER_DEPTH_SHALLOW, WATER_LAKE } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

/** Seed of the field tests. */
export const FELD_SEED = 20261006;
/** The drawn chunk. */
export const CX = 4;
export const CY = 4;
/** First tile of the drawn chunk. */
export const X0 = CX << CHUNK_SHIFT;
export const Y0 = CY << CHUNK_SHIFT;

/** The game's items. */
export const feldCatalog = new ItemCatalog(ITEMS);

/** Options of a field world. */
export interface FeldOptionen {
  readonly seed?: number;
  /** `echt`: the weather automaton of the seed; `hand`: the test records the weather (`wetter(…)`). */
  readonly wetter?: 'echt' | 'hand';
  /** Biome of every tile (default Grünhain). */
  readonly biom?: string;
  /** The Landwirtschaft level (default 1). */
  readonly stufe?: number;
}

const key = (tx: number, ty: number): string => `${tx},${ty}`;

/** The field world (see module comment). */
export class FeldWelt {
  readonly sim: Simulation;
  readonly calendar: Calendar;
  readonly weather: WeatherSystem | null;
  readonly chunk: ChunkData;
  readonly bags: PlayerBags;
  readonly inventory: InventorySystem;
  readonly farming: FarmingSystem;
  /** Stacks put into the world (earthworms of the hoe, harvests that did not fit). */
  readonly spilled: ItemStack[] = [];
  /** Experience the farming system awarded (source ids). */
  readonly awarded: string[] = [];
  /** Tiles in a greenhouse, inside a fence ring, near a scarecrow (the surroundings the tests draw). */
  readonly greenhouse = new Set<string>();
  readonly enclosed = new Set<string>();
  readonly scarecrows = new Set<string>();
  skillLevel: number;
  /** Whether the chunk is in the active zone. */
  active = true;
  private frozenAt = 0;

  constructor(options: FeldOptionen = {}) {
    const seed = options.seed ?? FELD_SEED;
    this.sim = new Simulation({ seed, dayLengthMinutes: 24 });
    this.calendar = new Calendar(this.sim.clock);
    this.weather = (options.wetter ?? 'echt') === 'echt' ? new WeatherSystem(this.calendar, seed, [options.biom ?? 'gruenhain']) : null;
    this.chunk = new ChunkData(0, CX, CY);
    this.chunk.biome.fill(contentWorldIdTables().biomes.runtimeId(options.biom ?? 'gruenhain'));
    this.skillLevel = options.stufe ?? 1;
    // The weather is a participant before farming, as in the game (its state is restored before the log listens again).
    if (this.weather !== null) this.sim.addSystem(this.weather);
    this.bags = new PlayerBags(feldCatalog);
    this.inventory = this.sim.addSystem(new InventorySystem(this.bags));
    const surroundings: FarmSurroundings = {
      greenhouseAt: (_s, _l, tx, ty) => this.greenhouse.has(key(tx, ty)),
      enclosedAt: (_s, _l, tx, ty) => this.enclosed.has(key(tx, ty)),
      scarecrowNear: (_l, tx, ty, radius) => {
        for (const k of this.scarecrows) {
          const [x, y] = k.split(',').map(Number) as [number, number];
          if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) <= radius) return true;
        }
        return false;
      },
    };
    this.farming = this.sim.addSystem(
      new FarmingSystem(this.sim, {
        world: {
          chunk: (layer, cx, cy) => (layer === 0 && cx === CX && cy === CY ? this.chunk : undefined),
          activeChunks: () => (this.active ? [this.chunk] : []),
          regionAt: () => 0,
          weather: () => this.weather,
        },
        calendar: this.calendar,
        inventory: this.inventory,
        catalog: feldCatalog,
        spill: (_s, stack) => this.spilled.push(stack),
        surroundings,
      }),
    );
    const skills: FarmSkills = { level: () => this.skillLevel, award: (_s, id) => this.awarded.push(id) };
    this.farming.useSkills(skills);
    this.farming.useReach(() => 0);
    this.farming.worldTick(this.sim);
  }

  /** Ticks per game day. */
  get perDay(): number {
    return this.sim.clock.ticksPerDay;
  }

  /** A field at (tx, ty) of the drawn chunk (the hoe's hook). */
  feld(tx: number, ty: number): this {
    this.farming.tilled(this.sim, 0, tx, ty, true);
    return this;
  }

  /** Sows `crop` on the field (tx, ty). */
  saeen(tx: number, ty: number, crop: string): this {
    const def = feldCatalog.get(`saat_${crop}`);
    const problem = this.farming.sowProblem(0, tx, ty, def);
    if (problem !== null) throw new Error(`cannot sow ${crop} at ${tx},${ty}: ${problem}`);
    this.farming.sow(this.sim, 0, tx, ty, def);
    return this;
  }

  /** The plot at (tx, ty) (a fresh record). */
  beet(tx: number, ty: number, layer: Layer = 0): FarmPlot {
    const out = createFarmPlot();
    if (!this.farming.plotAt(layer, tx, ty, out)) throw new Error(`no plot at ${tx},${ty}`);
    return out;
  }

  /** Records a weather period of region 0 by hand (`wetter: 'hand'`), from day `day` `fromHour` for `hours` hours. */
  wetter(state: WeatherStateId, day: number, fromHour: number, hours: number): this {
    const start = minuteOf(day, fromHour);
    this.farming.log.record(0, state, start, start + hours * 60);
    return this;
  }

  /** Jumps to the next 06:00; an active chunk lives the day there (world tick, then the dawn), a frozen one waits. */
  morgen(): this {
    const t = this.sim.clock.tick;
    this.sim.skipTicks(this.perDay - (t % this.perDay));
    this.weather?.worldTick();
    if (this.active) {
      this.farming.worldTick(this.sim);
      this.farming.dailyTick(this.sim, this.sim.clock.day);
    }
    return this;
  }

  /** `n` dawns. */
  tage(n: number): this {
    for (let k = 0; k < n; k++) this.morgen();
    return this;
  }

  /** Jumps `ticks` forward without a dawn of its own (the zone as it is). */
  springe(ticks: number): this {
    this.sim.skipTicks(ticks);
    return this;
  }

  /** The chunk leaves the active zone. */
  einfrieren(): this {
    this.active = false;
    this.frozenAt = this.sim.clock.tick;
    this.chunk.frozenAtTick = this.frozenAt;
    return this;
  }

  /** The chunk comes back and catches up the span it was frozen. */
  aufwachen(): this {
    this.farming.catchUp(this.chunk, this.frozenAt, this.sim.clock.tick);
    this.active = true;
    return this;
  }

  /** Every event of type `type` since the last drain. */
  ereignisse(type: string): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    this.sim.events.drain((t, payload) => {
      if (t === type) out.push(payload as unknown as Record<string, unknown>);
    });
    return out;
  }

  /** Fresh water on tile (tx, ty) (a lake of depth 1). */
  wasser(tx: number, ty: number): this {
    this.chunk.water[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] = WATER_DEPTH_SHALLOW | WATER_LAKE;
    this.farming.surroundingsChanged();
    return this;
  }
}

/** The plots of a world as comparable data (the participant's plots). */
export function beete(w: FeldWelt): unknown {
  return (w.farming.save.serialize() as { plots: unknown }).plots;
}

/** Days of good growth a crop needs from seed to ripe. */
export function reifeTage(crop: { stufen: number; tageJeStufe: number }): number {
  return (crop.stufen - 1) * crop.tageJeStufe;
}

export const F = BALANCE.farming;
