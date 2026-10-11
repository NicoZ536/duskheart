/**
 * Water (MASTERPROMPT §18 "Wasser: Flüsse und Seen ungefiltert (Nebelmoor 50 % Fieberrisiko, sonst 10 %), Abkochen macht sauber,
 * Regensammler, … Trinkschlauch (5 Schlucke), … geschmolzener Schnee, Tees"; docs/SPIEL.md §21 "Wasser", §28; M7-30; system
 * `water`, place 36 of `SYSTEM_ORDER`, chunk-bound).
 *
 * - **Rain collectors** (build part `regensammler`; the building system's part listener): at every 06:00 a collector under the
 *   open sky gains the rain of the farm day that ended (the climate log's `rainMinutes` of its region, ADR-0220), up to its
 *   capacity – collectors of frozen chunks day by day when they wake (`catchUp`), the same function. Whether a roof covers it is
 *   read in the active zone (`sheltered`, every world tick) and kept while frozen (ADR-0207). The climate log keeps the days a
 *   collector still needs (`FarmingSystem.retainClimate`).
 * - **E at a collector** (`water.drink`): a clean sip (no fever), taken from the collector when the sip ends (the drink hook).
 *   **Filling** (`water.fill`): with a water skin, a bucket of boiled water or an empty bucket in the hand at a collector (clean
 *   water; an empty bucket becomes boiled water, five sips) or with the skin at fresh water (unfiltered: its sips keep the fever
 *   risk of that water). Every filling of the skin wears it by one use.
 * - **Drinking from a vessel** (`player.useItem`, the item use `wasser`): a sip from the skin (`schlauch`) or the boiled bucket
 *   (`eimer`) through `ActionsSystem.drinkFrom` – as long as a sip at a bank; the sip leaves the vessel when it ends; the boiled
 *   bucket drunk empty is an empty bucket again.
 * - **Crafting** (`craftWaterSource`): a collector holding a sip within reach is water for recipes with `umgebung: 'wasser'`
 *   (teas, soups); a piece that begins with no open water near takes one sip from the nearest.
 * Save participant `water` (version 1): every collector (place, water, roof, the next farm day it waits for) and the collector
 * of a sip under way.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { RAIN_COLLECTOR } from '../../content/items/wasser';
import type { ItemDef } from '../../content/schema/item';
import { NULL_ENTITY } from '../../engine/ecs';
import type { ChunkData } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, DEEPEST_LAYER, TILE_PX, type Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import type { ActionsSystem } from '../actions/system';
import type { DrinkHook } from '../actions/hooks';
import { drinkable, feverChance, waterSource, type WaterSource } from '../actions/formulas';
import type { CommandOfType, GameCommandType } from '../commands';
import type { CraftWaterSource } from '../crafting/sources';
import { farmDayStart } from '../farming/climateLog';
import type { FarmClimateLog } from '../farming/climateLog';
import { isValidRef, slotAt, withSlot } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import type { ItemCatalog } from '../items/catalog';
import type { SlotRef } from '../items/slots';
import { newStack, type ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, CommandRejectReason, SimSystem, Simulation } from '../sim';
import type { ItemUseContext, ItemUseHandler, ItemUseOutcome } from '../tools/itemUses';
import { BOILED_WATER, collectorSips, EMPTY_BUCKET, filledCollector, isVessel, mixedFever, vesselFever, vesselSips, withWater } from './formulas';
import type { RainCollectorState, WaterApi } from './types';

/** Id of the water system and its save participant. */
export const WATER_SYSTEM_ID = 'water';
/** Data version of the `water` participant. */
export const WATER_SAVE_VERSION = 1;

const W = BALANCE.water;
const REACH_PX = BALANCE.actions.reachTiles * TILE_PX;

/** A rain collector as the water system keeps it. */
export interface RainCollector extends RainCollectorState {
  /** A roof covers it (read in the active zone, kept while frozen): no rain falls in. */
  sheltered: boolean;
  /** The next farm day whose rain it waits for (src/game/farming/climateLog.ts `farmDayStart`). */
  next: number;
}

/** Key of a tile. */
function key(layer: number, tx: number, ty: number): string {
  return `${layer}:${tx}:${ty}`;
}

const snapshotSchema = z
  .object({
    sammler: z.array(z.tuple([z.number().int().min(DEEPEST_LAYER).max(0), z.number().int().min(0), z.number().int().min(0), z.number().int().min(0).max(W.collector.capacityMinutes), z.boolean(), z.number().int().min(1)])),
    schluck: z.tuple([z.number().int().min(DEEPEST_LAYER).max(0), z.number().int().min(0), z.number().int().min(0)]).nullable(),
  })
  .strict();

/** What the water system reads of the world. */
export interface WaterWorld {
  /** Whether chunk (layer, cx, cy) is in the active zone. */
  active(sim: Simulation, layer: Layer, cx: number, cy: number): boolean;
  /** Whether a finished roof covers tile (tx, ty) of `layer`. */
  roofed(layer: Layer, tx: number, ty: number): boolean;
  /** Weather region of a surface tile (−1 at sea). */
  regionAt(tx: number, ty: number): number;
}

/** Dependencies of the water system. */
export interface WaterSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly collision: WorldCollision;
  readonly catalog: ItemCatalog;
  readonly world: WaterWorld;
  /** The climate log of the farming system (rain minutes per farm day and region). */
  readonly climate: FarmClimateLog;
}

type Refusal = CommandRejectReason | null;

export class WaterSystem implements SimSystem, WaterApi {
  readonly id = WATER_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  /** The drink hook the actions system calls (`ActionsSystem.addDrinkHook`). */
  readonly drinkHook: DrinkHook;
  private readonly sim: Simulation;
  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly collision: WorldCollision;
  private readonly catalog: ItemCatalog;
  private readonly world: WaterWorld;
  private readonly climate: FarmClimateLog;
  private actions: ActionsSystem | null = null;
  private readonly collectors = new Map<string, RainCollector>();
  /** The collector a sip under way is taken from. */
  private sip: string | null = null;
  private readonly at = { x: 0, y: 0 };

  constructor(sim: Simulation, deps: WaterSystemDeps) {
    this.sim = sim;
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.collision = deps.collision;
    this.catalog = deps.catalog;
    this.world = deps.world;
    this.climate = deps.climate;
    this.drinkHook = { drunk: (s, source, tick, from) => this.drunk(s, source, tick, from) };
    this.commands = {
      'water.fill': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.fill(s, cmd)),
      'water.drink': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.drinkAt(s, cmd, tick)),
    };
    this.save = {
      id: WATER_SYSTEM_ID,
      version: WATER_SAVE_VERSION,
      // Saves from before the kitchen (versions 1–3) have no rain collectors.
      migrations: [{ from: 0, migrate: () => ({ sammler: [], schluck: null }) }],
      serialize: () => ({
        sammler: [...this.collectors.values()].sort((a, b) => a.layer - b.layer || a.ty - b.ty || a.tx - b.tx).map((c) => [c.layer, c.tx, c.ty, c.fill, c.sheltered, c.next]),
        schluck: this.sip === null ? null : (this.sip.split(':').map(Number) as [number, number, number]),
      }),
      deserialize: (data) => {
        const parsed = snapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`water snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        const next = new Map<string, RainCollector>();
        for (const [layer, tx, ty, fill, sheltered, day] of parsed.data.sammler) {
          const k = key(layer, tx, ty);
          if (next.has(k)) throw new TypeError(`water snapshot invalid: two collectors on ${k}`);
          next.set(k, { layer, tx, ty, fill, sheltered, next: day });
        }
        const s = parsed.data.schluck;
        if (s !== null && !next.has(key(s[0], s[1], s[2]))) throw new TypeError('water snapshot invalid: a sip from a collector that is not there');
        this.collectors.clear();
        for (const [k, c] of next) this.collectors.set(k, c);
        this.sip = s === null ? null : key(s[0], s[1], s[2]);
      },
    };
  }

  /** Connects the actions system (sips from collectors and vessels). */
  useActions(actions: ActionsSystem): void {
    this.actions = actions;
  }

  // -------------------------------------------------------------------------------------------
  // WaterApi and queries
  // -------------------------------------------------------------------------------------------

  collectorAt(layer: number, tx: number, ty: number): Readonly<RainCollector> | undefined {
    return this.collectors.get(key(layer, tx, ty));
  }

  /** Every collector (read-only for callers; tests, presentation). */
  get all(): IterableIterator<Readonly<RainCollector>> {
    return this.collectors.values();
  }

  /** The oldest farm day any collector still waits for (`Infinity`: none) – the climate log keeps it (`retainClimate`). */
  oldestNeededDay(): number {
    let n = Number.POSITIVE_INFINITY;
    for (const c of this.collectors.values()) if (c.layer === 0 && c.next < n) n = c.next;
    return n;
  }

  /** The rain collectors as a water source of crafting (`CraftingSystem.addWaterSource`). */
  craftWaterSource(): CraftWaterSource {
    return {
      near: (_sim, layer, x, y, radiusPx) => this.nearestCollector(layer, x, y, radiusPx) !== null,
      draw: (_sim, layer, x, y, radiusPx) => {
        const c = this.nearestCollector(layer, x, y, radiusPx);
        if (c !== null) c.fill -= W.collector.minutesPerSip;
      },
    };
  }

  /** The nearest collector of `layer` holding a sip whose tile centre lies within `radiusPx` of (x, y), or `null`. */
  private nearestCollector(layer: Layer, x: number, y: number, radiusPx: number): RainCollector | null {
    let best: RainCollector | null = null;
    let bestD = radiusPx * radiusPx;
    for (const c of this.collectors.values()) {
      if (c.layer !== layer || collectorSips(c.fill) < 1) continue;
      const dx = (c.tx + 1 / 2) * TILE_PX - x;
      const dy = (c.ty + 1 / 2) * TILE_PX - y;
      const d = dx * dx + dy * dy;
      // Equally near: the northern, then the western one – never the order of the map (a loaded save keeps another).
      if (d < bestD || (d === bestD && (best === null || c.ty < best.ty || (c.ty === best.ty && c.tx < best.tx)))) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // The build grid
  // -------------------------------------------------------------------------------------------

  /** A rain collector came onto the grid at (tx, ty) of `layer`: empty, waiting for the farm day under way. */
  placed(sim: Simulation, part: string, layer: Layer, tx: number, ty: number): void {
    if (part !== RAIN_COLLECTOR) return;
    const k = key(layer, tx, ty);
    if (this.collectors.has(k)) return;
    const perDay = sim.clock.ticksPerDay;
    this.collectors.set(k, { layer, tx, ty, fill: 0, sheltered: this.world.roofed(layer, tx, ty), next: Math.floor(sim.tick / perDay) + 1 });
    if (layer === 0) this.climate.track(this.world.regionAt(tx, ty));
    sim.events.push('collectorPlaced', { layer, tx, ty, tick: sim.eventTick });
  }

  /** A rain collector left the grid: its water is spilt. */
  removed(sim: Simulation, part: string, layer: Layer, tx: number, ty: number): void {
    if (part !== RAIN_COLLECTOR) return;
    const k = key(layer, tx, ty);
    if (!this.collectors.delete(k)) return;
    if (this.sip === k) this.sip = null;
    sim.events.push('collectorRemoved', { layer, tx, ty, tick: sim.eventTick });
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  /** World tick: the roofs over the collectors of the active zone. */
  worldTick(sim: Simulation): void {
    for (const c of this.collectors.values()) {
      if (this.world.active(sim, c.layer as Layer, c.tx >> CHUNK_SHIFT, c.ty >> CHUNK_SHIFT)) c.sheltered = this.world.roofed(c.layer as Layer, c.tx, c.ty);
    }
  }

  /** The dawn of day `day`: the collectors of the active zone gain the rain of the farm day that ended (`day − 1`). */
  dailyTick(sim: Simulation, day: number): void {
    if (this.collectors.size === 0) return;
    for (const c of this.collectors.values()) {
      if (this.world.active(sim, c.layer as Layer, c.tx >> CHUNK_SHIFT, c.ty >> CHUNK_SHIFT)) this.rainUntil(c, day - 1);
    }
  }

  /** A frozen chunk wakes: its collectors gain the rain of every farm day that ended while it slept, day by day. */
  catchUp(chunk: ChunkData, _fromTick: number, toTick: number): void {
    if (this.collectors.size === 0) return;
    const last = Math.floor(toTick / this.sim.clock.ticksPerDay);
    for (const c of this.collectors.values()) {
      if (c.layer === chunk.layer && c.tx >> CHUNK_SHIFT === chunk.cx && c.ty >> CHUNK_SHIFT === chunk.cy) this.rainUntil(c, last);
    }
  }

  /** The farm days `c.next … last` rain into `c` (surface collectors without a roof). */
  private rainUntil(c: RainCollector, last: number): void {
    if (c.next > last) return;
    if (c.layer === 0 && !c.sheltered) {
      this.climate.advance(farmDayStart(last + 1));
      const region = this.world.regionAt(c.tx, c.ty);
      for (let d = c.next; d <= last; d++) {
        const day = region < 0 ? undefined : this.climate.day(region, d);
        if (day !== undefined && day.rainMinutes > 0) c.fill = filledCollector(c.fill, day.rainMinutes);
      }
    }
    c.next = last + 1;
  }

  // -------------------------------------------------------------------------------------------
  // Drinking and filling
  // -------------------------------------------------------------------------------------------

  /** The item use of vessels: E on a collector or fresh water fills, else (and with the primary button) a sip. */
  itemUse(): ItemUseHandler {
    return {
      id: 'wasser',
      handles: (def) => isVessel(def),
      use: (sim, ctx) => this.useVessel(sim, ctx),
    };
  }

  private useVessel(sim: Simulation, ctx: ItemUseContext): ItemUseOutcome {
    const t = ctx.target;
    if (ctx.named && t !== null && (this.collectors.has(key(t.layer, t.tx, t.ty)) || this.freshWaterAt(t.layer, t.tx, t.ty) !== null)) {
      const r = this.fillAt(sim, ctx.slot, t.layer, t.tx, t.ty);
      return r === null ? 'used' : { reject: r };
    }
    const sips = vesselSips(ctx.stack, ctx.def);
    if (sips <= 0) return ctx.primary ? 'used' : { reject: 'vesselEmpty' };
    const actions = this.requireActions();
    const r = actions.drinkFrom(sim, ctx.def.id === BOILED_WATER ? 'eimer' : 'schlauch', ctx.def.id, ctx.slot, vesselFever(ctx.stack), ctx.tick);
    return r === null ? 'used' : { reject: r };
  }

  /** `water.drink`: a sip of the collector on (tx, ty) within reach. */
  private drinkAt(sim: Simulation, cmd: CommandOfType<'water.drink'>, tick: number): Refusal {
    const where = this.feet(sim);
    if (where === null) return 'noPlayer';
    const k = key(where, cmd.tx, cmd.ty);
    const c = this.collectors.get(k);
    if (c === undefined) return 'notWaterSource';
    if (!this.inReach(cmd.tx, cmd.ty)) return 'outOfReach';
    if (collectorSips(c.fill) < 1) return 'collectorEmpty';
    const r = this.requireActions().drinkFrom(sim, 'regensammler', null, null, 0, tick);
    if (r === null) this.sip = k;
    return r;
  }

  /** `water.fill`: the vessel in the hand at the water or collector of (tx, ty). */
  private fill(sim: Simulation, cmd: CommandOfType<'water.fill'>): Refusal {
    const where = this.feet(sim);
    if (where === null) return 'noPlayer';
    const state = this.inventory.state;
    return this.fillAt(sim, { bereich: 'schnellleiste', index: state.auswahl }, where, cmd.tx, cmd.ty);
  }

  /** Fills the vessel in slot `ref` at the collector or the fresh water of (tx, ty) of `layer`. */
  private fillAt(sim: Simulation, ref: SlotRef, layer: Layer, tx: number, ty: number): Refusal {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const state = this.inventory.state;
    if (!isValidRef(state, ref)) return 'noVessel';
    const stack = slotAt(state, ref);
    if (stack === null) return 'noVessel';
    const def = this.catalog.get(stack.item);
    const empty = def.id === EMPTY_BUCKET;
    if (!isVessel(def) && !empty) return 'noVessel';
    if (!this.inReach(tx, ty)) return 'outOfReach';
    const k = key(layer, tx, ty);
    const c = this.collectors.get(k);
    let next: ItemStack;
    let quelle: string;
    if (c !== undefined) {
      const have = collectorSips(c.fill);
      if (empty) {
        // An empty bucket at a collector: clean water, as good as boiled – five sips.
        if (have < W.collector.sipsPerBucket) return 'collectorEmpty';
        c.fill -= W.collector.sipsPerBucket * W.collector.minutesPerSip;
        next = withWater(this.keepBucket(stack, newStack(this.catalog.get(BOILED_WATER), 1)), W.boiled.sips, 0);
      } else {
        if (def.ladungen?.fuellen.includes('regensammler') !== true) return 'notWaterSource';
        const sips = vesselSips(stack, def);
        const max = def.ladungen.max;
        if (sips >= max) return 'vesselFull';
        if (have < 1) return 'collectorEmpty';
        const take = Math.min(max - sips, have);
        c.fill -= take * W.collector.minutesPerSip;
        next = withWater(this.wear(stack, def), sips + take, mixedFever(sips, vesselFever(stack), 0));
      }
      quelle = 'regensammler';
    } else {
      if (empty || def.ladungen?.fuellen.includes('wasser') !== true) return 'notWaterSource';
      const water = this.freshWaterAt(layer, tx, ty);
      if (water === null) return 'notWaterSource';
      if (water === 'meer') return 'saltWater';
      if (water === 'eis') return 'frozen';
      const sips = vesselSips(stack, def);
      if (sips >= def.ladungen.max) return 'vesselFull';
      const fever = feverChance(water, this.biomeAt(layer, tx, ty));
      next = withWater(this.wear(stack, def), def.ladungen.max, mixedFever(sips, vesselFever(stack), fever));
      quelle = water;
    }
    this.inventory.bags.replace(withSlot(this.inventory.state, ref, next));
    sim.events.push('inventoryChanged', { change: 'add', tick: sim.eventTick });
    if (next.haltbarkeit === 0) sim.events.push('itemBroken', { at: { bereich: ref.bereich, index: ref.index }, item: next.item, tick: sim.eventTick });
    sim.events.push('vesselFilled', { item: next.item, quelle, schlucke: vesselSips(next, this.catalog.get(next.item)), layer, tx, ty, tick: sim.eventTick });
    return null;
  }

  /** A skin worn by one filling (§D "jede Nutzung"); other vessels keep their durability. */
  private wear(stack: ItemStack, def: ItemDef): ItemStack {
    if (def.id === BOILED_WATER || stack.haltbarkeit === undefined) return stack;
    return { ...stack, haltbarkeit: Math.max(0, stack.haltbarkeit - 1) };
  }

  /** `made` as the same bucket as `bucket`: its durability and quality kept. */
  private keepBucket(bucket: ItemStack, made: ItemStack): ItemStack {
    const out: { -readonly [K in keyof ItemStack]: ItemStack[K] } = { ...made };
    if (bucket.haltbarkeit !== undefined) out.haltbarkeit = bucket.haltbarkeit;
    if (bucket.qualitaet !== undefined) out.qualitaet = bucket.qualitaet;
    return out;
  }

  /** The drink hook: a sip that ended takes its water from the collector or the vessel it came from. */
  private drunk(sim: Simulation, source: WaterSource, _tick: number, from: SlotRef | null): void {
    if (source === 'regensammler') {
      const c = this.sip === null ? undefined : this.collectors.get(this.sip);
      if (c !== undefined && c.fill >= W.collector.minutesPerSip) c.fill -= W.collector.minutesPerSip;
      this.sip = null;
      return;
    }
    if ((source !== 'schlauch' && source !== 'eimer') || from === null) return;
    const state = this.inventory.state;
    if (!isValidRef(state, from)) return;
    const stack = slotAt(state, from);
    if (stack === null) return;
    const def = this.catalog.get(stack.item);
    if (!isVessel(def)) return;
    const sips = vesselSips(stack, def);
    if (sips <= 0) return;
    let next: ItemStack;
    if (sips === 1 && def.id === BOILED_WATER) next = this.keepBucket(stack, newStack(this.catalog.get(EMPTY_BUCKET), 1));
    else next = withWater(stack, sips - 1, vesselFever(stack));
    this.inventory.bags.replace(withSlot(state, from, next));
    sim.events.push('inventoryChanged', { change: 'remove', tick: sim.eventTick });
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  /** The fresh-water source of tile (tx, ty) of `layer` (river, lake, spring, sea, ice), or `null` without water. */
  freshWaterAt(layer: Layer, tx: number, ty: number): WaterSource | null {
    this.collision.ensureTiles(layer, tx, ty, tx, ty);
    const chunk = this.collision.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) return null;
    const w = waterSource(chunk.water[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number);
    return w !== null && (drinkable(w) || w === 'meer' || w === 'eis') ? w : null;
  }

  private biomeAt(layer: Layer, tx: number, ty: number): string | null {
    const chunk = this.collision.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) return null;
    const id = chunk.biome[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number;
    return id === 0 ? null : contentWorldIdTables().biomes.stringId(id);
  }

  /** The player's layer with its feet in `this.at`, or `null` without a player. */
  private feet(sim: Simulation): Layer | null {
    if (sim.player === NULL_ENTITY) return null;
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.at)) return null;
    return body.layer;
  }

  private able(sim: Simulation): Refusal {
    if (this.feet(sim) === null) return 'noPlayer';
    return this.player.incapacity(sim);
  }

  private inReach(tx: number, ty: number): boolean {
    const dx = (tx + 1 / 2) * TILE_PX - this.at.x;
    const dy = (ty + 1 / 2) * TILE_PX - this.at.y;
    return dx * dx + dy * dy <= REACH_PX * REACH_PX;
  }

  private requireActions(): ActionsSystem {
    if (this.actions === null) throw new Error('WaterSystem: the actions system is not connected (useActions)');
    return this.actions;
  }

  private refuse(sim: Simulation, type: GameCommandType, tick: number, reason: Refusal): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }
}
