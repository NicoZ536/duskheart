/**
 * Spoilage (MASTERPROMPT §18 "Verderb: Frische 100 → 0 über die Haltbarkeit … Faktoren … Stufen: Frisch · Alt · Faulig · 0 →
 * Verdorbenes (Kompost)", §16.4 "Lager … Eiskeller", §16.7 "Vorratsfass"; docs/SPIEL.md §21 "Verderb", §28 "Aufholen"; ADR-0207;
 * M7-29; system `spoilage`, place 35 of `SYSTEM_ORDER`, chunk-bound).
 *
 * - **Hourly pass** (`update`): when the game hour changes, every perishable stack of the bags and of every container in the
 *   active zone (`forEachPerishable` of the sources: bags, chests and pantry barrels, drops, graves) loses `n × loss` freshness –
 *   `n` the hours since its container's stamp (1 normally; more for the bags after a time jump), the loss on the grid 2^-16 with
 *   the factor container × room × surroundings of its place (src/game/spoilage/formulas.ts), split at the season's changes.
 * - **Spoiled**: freshness 0 turns the stack into as many pieces of `verdorbenes` where it lies (`foodSpoiled`).
 * - **Freezing** (`onDeactivate` of the zone): the chunk keeps the hour its containers spoiled to and the place of each container
 *   (container × room factor, hot biome, outdoors – rooms exist only in the active zone).
 * - **Catching up** (`catchUp`): the hours from that stamp to the hour of `toTick`, with the kept places – bit-identical to a
 *   chunk that stayed active (n × loss ≡ n single losses on the grid); the chunk then counts from there (`ahead`).
 * - **Stations**: their slots spoil inside the station system's advance, hour by hour between batches (`stationHook`,
 *   `StationSystem.useSpoilage`), live or frozen alike.
 * - `spoilage.advance {hours}` (debug, the console's `spoil`): every perishable stack in the bags and the active zone spoils
 *   `hours` more hours at once, a command so replays repeat it.
 * Save participant `spoilage` (version 1): the global stamp, the frozen chunks' stamps and places, the chunks caught up ahead.
 */
import { BALANCE } from '../../content/balance';
import type { SeasonId } from '../../content/balance';
import type { ChunkData } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, packChunkId, unpackChunkId, type Layer } from '../../world/model/coords';
import type { ZoneListener } from '../../world/stream/activeZone';
import type { ItemCatalog } from '../items/catalog';
import { SPOILED_FOOD_ITEM } from '../items/slots';
import { newStack, type ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import { containerFactor, hourOfTick, hourStartTick, isHotBiome, lossOver, lossPerHour, roomFactor, spoiledFreshness, type SeasonSource, type SpoilagePlace } from './formulas';
import { spoilageSnapshotSchema, type FrozenSpoilage, type SpoilageSnapshot } from './state';
import type { PerishableContainer, PerishableContainerSource, PerishableSlot, SpoilageApi, StationSlots, StationSpoilage } from './types';

/** Id of the spoilage system and its save participant. */
export const SPOILAGE_SYSTEM_ID = 'spoilage';
/** Data version of the `spoilage` participant. */
export const SPOILAGE_SAVE_VERSION = 1;
/** The item a perishable stack becomes at freshness 0 (src/content/items/kueche.ts; `SPOILED_FOOD_ITEM`, the slots' rule). */
export const SPOILED_ITEM = SPOILED_FOOD_ITEM;

/** The room and the surroundings of a tile of the active zone, as spoilage reads them. */
export interface SpoilageWorld {
  /** Whether chunk (layer, cx, cy) is in the active zone. */
  active(sim: Simulation, layer: Layer, cx: number, cy: number): boolean;
  /** The room type at tile (tx, ty) of `layer` (`null` without a room) and whether the tile is outdoors (no interior). */
  roomAt(sim: Simulation, layer: Layer, tx: number, ty: number, out: { type: string | null; outdoors: boolean }): void;
  /** The resident chunk of tile (tx, ty), or `undefined`. */
  chunkAt(sim: Simulation, layer: Layer, tx: number, ty: number): ChunkData | undefined;
  /** The biome id of a chunk's tile (its runtime id `id`), `null` without one. */
  biomeName(id: number): string | null;
}

/** The stations whose slots spoil (the station system's placed list). */
export interface SpoilageStations {
  readonly placed: readonly { readonly id: number; readonly layer: Layer; readonly tx: number; readonly ty: number; readonly proc: unknown }[];
}

/** Dependencies of the spoilage system. */
export interface SpoilageSystemDeps {
  readonly catalog: ItemCatalog;
  /** Seasons of days (the calendar). */
  readonly seasons: SeasonSource;
  readonly world: SpoilageWorld;
  /** The stations, for their places when a chunk freezes (absent in tests without stations). */
  readonly stations?: SpoilageStations;
}

/** A mutable place record. */
function place(): SpoilagePlace {
  return { base: 1, hot: false, outdoors: true };
}

export class SpoilageSystem implements SimSystem, SpoilageApi {
  readonly id = SPOILAGE_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  /** Hears chunks freeze (register with `SimWorld.addZoneListener`). */
  readonly zoneListener: ZoneListener;
  private readonly sim: Simulation;
  private readonly catalog: ItemCatalog;
  private readonly seasons: SeasonSource;
  private readonly world: SpoilageWorld;
  private readonly stations: SpoilageStations | null;
  private readonly sources: PerishableContainerSource[] = [];
  /** The hour the bags and the active zone have spoiled to; −1 before the first tick. */
  private lastHour = -1;
  /** Frozen chunks with perishable stacks, by packed chunk id. */
  private readonly frozen = new Map<number, FrozenSpoilage>();
  /** Chunks caught up past `lastHour` (packed id → the hour they reached). */
  private readonly ahead = new Map<number, number>();
  private readonly roomRecord = { type: null as string | null, outdoors: true };
  /** Places of the tiles of one pass (key: packed tile; a pass reads each tile's room once). */
  private readonly placeCache = new Map<string, SpoilagePlace>();
  private readonly stationPlace = place();

  constructor(sim: Simulation, deps: SpoilageSystemDeps) {
    this.sim = sim;
    this.catalog = deps.catalog;
    this.seasons = deps.seasons;
    this.world = deps.world;
    this.stations = deps.stations ?? null;
    this.zoneListener = { onDeactivate: (chunk) => this.freeze(chunk) };
    this.commands = {
      'spoilage.advance': (s, cmd) => this.advanceBy(s, cmd.hours),
    };
    this.save = {
      id: SPOILAGE_SYSTEM_ID,
      version: SPOILAGE_SAVE_VERSION,
      // Saves from before the kitchen (versions 1–3) start counting at their first tick (−1): no spoiled past.
      migrations: [{ from: 0, migrate: (): SpoilageSnapshot => ({ lastHour: -1, frozen: [], ahead: [] }) }],
      serialize: () => this.snapshot(),
      deserialize: (data) => this.restore(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // SpoilageApi
  // -------------------------------------------------------------------------------------------

  /** Loss of `item` per game hour at `factor` [freshness points, on the grid]; 0 for items that do not spoil. */
  lossPerHour(item: string, factor: number): number {
    const days = this.catalog.get(item).frische;
    return days === undefined ? 0 : lossPerHour(days, factor);
  }

  /** Adds a source of perishable containers. */
  addSource(source: PerishableContainerSource): void {
    this.sources.push(source);
  }

  /** The hour the bags and the active zone have spoiled to (−1 before the first tick). */
  get stamp(): number {
    return this.lastHour;
  }

  /** The game hour of tick `tick`. */
  hourOf(tick: number): number {
    return hourOfTick(tick, this.sim.clock.ticksPerGameHour);
  }

  /** Whether chunk `id` (packed) is frozen with perishable stacks waiting to catch up. */
  frozenChunk(id: number): Readonly<FrozenSpoilage> | undefined {
    return this.frozen.get(id);
  }

  /** The station system's hook: its slots spoil hour by hour inside its own advance. */
  stationHook(): StationSpoilage {
    return {
      hourOf: (tick) => this.hourOf(tick),
      hourStart: (hour) => hourStartTick(hour, this.sim.clock.ticksPerGameHour),
      spoilStation: (sim, id, layer, tx, ty, slots, hour) => this.spoilStation(sim, id, layer, tx, ty, slots, hour),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    const hour = this.hourOf(sim.tick);
    if (this.lastHour < 0) {
      this.lastHour = hour;
      return;
    }
    if (hour > this.lastHour) this.pass(sim, hour);
    else if (this.ahead.size > 0) this.ahead.clear();
  }

  /** A frozen chunk catches up: its containers spoil from the stamp it froze with to the hour of `toTick`, with their kept places. */
  catchUp(chunk: ChunkData, _fromTick: number, toTick: number): void {
    const entry = this.frozen.get(chunk.id);
    if (entry === undefined) return;
    const to = this.hourOf(toTick);
    this.frozen.delete(chunk.id);
    if (to <= entry.stamp) {
      this.ahead.set(chunk.id, entry.stamp);
      return;
    }
    const fallback = place();
    for (let s = 0; s < this.sources.length; s++) {
      (this.sources[s] as PerishableContainerSource).forEachPerishable(this.sim, chunk, (slot, replace) => {
        const p = entry.places.get(this.containerKey(slot)) ?? this.chunkPlace(chunk, slot, fallback);
        this.spoil(null, slot.container, slot.stack, p, entry.stamp, to, replace);
      });
    }
    this.ahead.set(chunk.id, to);
  }

  // -------------------------------------------------------------------------------------------

  /** The hourly pass: everything of the bags and the active zone spoils up to `hour`. */
  private pass(sim: Simulation, hour: number): void {
    const last = this.lastHour;
    this.placeCache.clear();
    for (let s = 0; s < this.sources.length; s++) {
      (this.sources[s] as PerishableContainerSource).forEachPerishable(sim, null, (slot, replace) => {
        const chunk = packChunkId(slot.layer, slot.tx >> CHUNK_SHIFT, slot.ty >> CHUNK_SHIFT);
        const ahead = this.ahead.get(chunk);
        const from = ahead !== undefined && ahead > last ? ahead : last;
        if (hour <= from) return;
        this.spoil(sim, slot.container, slot.stack, this.livePlace(sim, slot), from, hour, replace);
      });
    }
    this.lastHour = hour;
    this.ahead.clear();
  }

  /** `hours` more hours for the bags and the active zone (debug `spoilage.advance`). */
  private advanceBy(sim: Simulation, hours: number): void {
    if (this.lastHour < 0) this.lastHour = this.hourOf(sim.tick);
    this.placeCache.clear();
    for (let s = 0; s < this.sources.length; s++) {
      (this.sources[s] as PerishableContainerSource).forEachPerishable(sim, null, (slot, replace) => {
        this.spoil(sim, slot.container, slot.stack, this.livePlace(sim, slot), this.lastHour, this.lastHour + hours, replace);
      });
    }
  }

  /** Spoils `stack` over the hours `[from, to)` at `p`; puts the result in place (`replace`) when anything changed. */
  private spoil(sim: Simulation | null, container: PerishableContainer, stack: ItemStack, p: Readonly<SpoilagePlace>, from: number, to: number, replace: (stack: ItemStack) => void): boolean {
    const f = stack.frische;
    const days = this.catalog.find(stack.item)?.frische;
    if (f === undefined || days === undefined || to <= from) return false;
    const next = spoiledFreshness(f, lossOver(days, p, from, to, this.seasons));
    if (next === f) return false;
    if (next > 0) {
      replace({ ...stack, frische: next });
      return false;
    }
    replace(newStack(this.catalog.get(SPOILED_ITEM), stack.count));
    if (sim !== null) sim.events.push('foodSpoiled', { item: stack.item, count: stack.count, behaelter: container, tick: sim.eventTick });
    return true;
  }

  /** The place of a slot in the active zone: container × room factor, hot biome, outdoors (one room look per tile and pass). */
  private livePlace(sim: Simulation, slot: PerishableSlot): SpoilagePlace {
    const key = `${slot.container}|${slot.layer}|${slot.tx}|${slot.ty}`;
    const cached = this.placeCache.get(key);
    if (cached !== undefined) return cached;
    const p = place();
    this.measure(sim, slot.container, slot.layer, slot.tx, slot.ty, p);
    this.placeCache.set(key, p);
    return p;
  }

  /** Measures the place of a container of kind `container` on tile (tx, ty) of `layer` in the active zone into `out`. */
  private measure(sim: Simulation, container: PerishableContainer, layer: Layer, tx: number, ty: number, out: SpoilagePlace): SpoilagePlace {
    const room = this.roomRecord;
    this.world.roomAt(sim, layer, tx, ty, room);
    out.base = containerFactor(container) * roomFactor(room.type);
    out.outdoors = room.outdoors;
    const chunk = this.world.chunkAt(sim, layer, tx, ty);
    out.hot = chunk !== undefined && isHotBiome(this.world.biomeName(chunk.biome[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number));
    return out;
  }

  /** The place of a slot of a frozen chunk that kept none (it arrived while frozen): its container, no room, outdoors, the chunk's biome. */
  private chunkPlace(chunk: ChunkData, slot: PerishableSlot, out: SpoilagePlace): SpoilagePlace {
    out.base = containerFactor(slot.container);
    out.outdoors = true;
    out.hot = isHotBiome(this.world.biomeName(chunk.biome[((slot.ty & CHUNK_MASK) << CHUNK_SHIFT) | (slot.tx & CHUNK_MASK)] as number));
    return out;
  }

  /** The key a container's place is kept under while frozen: one per container (a chest, a drop, a grave), not per slot. */
  private containerKey(slot: PerishableSlot): string {
    const k = slot.key;
    const cut = k.lastIndexOf(':');
    return slot.container === 'drop' || cut < 0 ? k : k.slice(0, cut);
  }

  /** A chunk freezes: it keeps the hour its containers spoiled to and the place of each container. */
  private freeze(chunk: ChunkData): void {
    const sim = this.sim;
    if (this.lastHour < 0) return;
    const places = new Map<string, SpoilagePlace>();
    for (let s = 0; s < this.sources.length; s++) {
      (this.sources[s] as PerishableContainerSource).forEachPerishable(sim, chunk, (slot) => {
        const key = this.containerKey(slot);
        if (!places.has(key)) places.set(key, this.measure(sim, slot.container, slot.layer, slot.tx, slot.ty, place()));
      });
    }
    const stations = this.stations?.placed ?? [];
    for (let i = 0; i < stations.length; i++) {
      const p = stations[i] as SpoilageStations['placed'][number];
      if (p.proc === null || p.layer !== chunk.layer || p.tx >> CHUNK_SHIFT !== chunk.cx || p.ty >> CHUNK_SHIFT !== chunk.cy) continue;
      places.set(`station:${p.id}`, this.measure(sim, 'station', p.layer, p.tx, p.ty, place()));
    }
    if (places.size === 0) return;
    const ahead = this.ahead.get(chunk.id);
    const stamp = ahead !== undefined && ahead > this.lastHour ? ahead : this.lastHour;
    this.frozen.set(chunk.id, { layer: chunk.layer, cx: chunk.cx, cy: chunk.cy, stamp, places });
    this.ahead.delete(chunk.id);
  }

  /** One hour (`hour`) for the slots of station `id`: live (the room now) or frozen (the kept place). */
  private spoilStation(sim: Simulation | null, id: number, layer: Layer, tx: number, ty: number, slots: StationSlots, hour: number): boolean {
    let p: SpoilagePlace;
    if (sim !== null) p = this.measure(sim, 'station', layer, tx, ty, this.stationPlace);
    else {
      const kept = this.frozen.get(packChunkId(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT))?.places.get(`station:${id}`);
      p = kept ?? this.stationPlace;
      if (kept === undefined) {
        p.base = containerFactor('station');
        p.hot = false;
        p.outdoors = true;
      }
    }
    let inputSpoiled = false;
    for (let i = 0; i < slots.eingang.length; i++) {
      const s = slots.eingang[i] ?? null;
      if (s !== null && this.spoil(sim, 'station', s, p, hour, hour + 1, (next) => (slots.eingang[i] = next))) inputSpoiled = true;
    }
    const fuel = slots.brennstoff;
    if (fuel !== null) this.spoil(sim, 'station', fuel, p, hour, hour + 1, (next) => (slots.brennstoff = next));
    for (let i = 0; i < slots.ausgang.length; i++) {
      const s = slots.ausgang[i] ?? null;
      if (s !== null) this.spoil(sim, 'station', s, p, hour, hour + 1, (next) => (slots.ausgang[i] = next));
    }
    return inputSpoiled;
  }

  // -------------------------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------------------------

  private snapshot(): SpoilageSnapshot {
    const frozen = [...this.frozen.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, f]) => ({
        layer: f.layer,
        cx: f.cx,
        cy: f.cy,
        stamp: f.stamp,
        behaelter: [...f.places.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([key, p]): [string, number, boolean, boolean] => [key, p.base, p.hot, p.outdoors]),
      }));
    const c = { layer: 0 as Layer, cx: 0, cy: 0 };
    const ahead = [...this.ahead.entries()].sort((a, b) => a[0] - b[0]).map(([id, h]): [number, number, number, number] => {
      unpackChunkId(id, c);
      return [c.layer, c.cx, c.cy, h];
    });
    return { lastHour: this.lastHour, frozen, ahead };
  }

  private restore(data: unknown): void {
    const parsed = spoilageSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`spoilage snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const d = parsed.data;
    const frozen = new Map<number, FrozenSpoilage>();
    for (const f of d.frozen) {
      const id = packChunkId(f.layer as Layer, f.cx, f.cy);
      if (frozen.has(id)) throw new TypeError(`spoilage snapshot invalid: chunk ${f.layer}:${f.cx}:${f.cy} twice`);
      const places = new Map<string, SpoilagePlace>();
      for (const [key, base, hot, outdoors] of f.behaelter) {
        if (places.has(key)) throw new TypeError(`spoilage snapshot invalid: container "${key}" twice`);
        places.set(key, { base, hot, outdoors });
      }
      frozen.set(id, { layer: f.layer, cx: f.cx, cy: f.cy, stamp: f.stamp, places });
    }
    this.lastHour = d.lastHour;
    this.frozen.clear();
    for (const [id, f] of frozen) this.frozen.set(id, f);
    this.ahead.clear();
    for (const [layer, cx, cy, h] of d.ahead) this.ahead.set(packChunkId(layer as Layer, cx, cy), h);
  }
}

/** The season of a game day (re-exported for callers that only have a calendar). */
export type { SeasonId };
/** The spoilage factor of a container kind (`BALANCE.spoilage.containers`). */
export const CONTAINER_FACTORS = BALANCE.spoilage.containers;
