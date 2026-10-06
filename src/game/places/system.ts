/**
 * The places at runtime (MASTERPROMPT §21 "Weitere Orte", "Jeder Ort: Name, Kartensymbol, Entdeckungs-Stinger,
 * Chronik-Eintrag; Zustand (geplündert, gereinigt) wird gespeichert. Gegner in Orten kehren nach 7 Tagen teilweise zurück,
 * Truhen nicht"; docs/SPIEL.md §18; M7-07 … M7-09). System `places`, global (it keeps no time in frozen chunks: every
 * deadline is an absolute tick), save participant `places`.
 *
 * - **Places** are the slots of the generated world that got a layout (`GeneratedWorld.placeLayouts`) – their location type
 *   (`PlaceDef`, collection `locationTypes`) names everything else. Slots without a layout are no places.
 * - **Discovery:** the player on the surface within the discovery radius of a place's centre (`discoveryRadius`) discovers it
 *   once (`placeDiscovered`): music stinger (A), chronicle and statistics (G), map marker, "Entdeckt: …". Checked when the
 *   player's tile changes, over the places of the 3 × 3 chunks around (no allocation). `reveal` (map table, quests, trader)
 *   marks a place on the map without a visit (`placeRevealed`).
 * - **Guards** (`PlaceDef.waechter`): spawned on discovery at the marks `waechter` as owned creatures (`ort:<slot>`,
 *   `CreatureSystem.spawnOwned`, leash `leineTiles` or `BALANCE.places.guardLeashTiles`); they live in their chunk's stock like
 *   every creature. When the last one falls (`onOwnedDeath`) the place is **cleansed** (`placeCleansed`); after
 *   `BALANCE.places.returnDays` part of them come back (`returningGuards`, `placeGuardsReturned`) and the place is no longer
 *   cleansed – fällig ist fällig: at the first world tick from the return tick, into the stock of a frozen chunk if need be.
 * - **Chests** (marks `truhe`, objects `ort_truhe_<stufe>`): E opens one (`place.use`) – its loot comes from `placeLoot`
 *   `ort_<ortstyp>_<stufe>` drawn with `hash(seed, place, chest)` (`drawPlaceLoot`), the object becomes `ort_truhe_offen` (a
 *   chunk change, saved with the chunk diffs), its bit is kept (`placeChestOpened`). The last chest makes the place
 *   **plundered** (`placeLooted`); chests never come back.
 * - **Effects** (`PlaceDef.wirkung`): `aussicht` – E at the mark `aussicht` climbs the tower (`towerClimbed`; the map reveals
 *   `aussichtTiles` around it); `segen` – E at the mark `altar` gives the condition for its seconds, again after `abklingTage`
 *   (`shrineBlessed`); `tafel` – E at the mark `tafel` reads the place's note (`placeNoteRead`) or, once strand C registers a
 *   reader (`addTabletReader`), the Builder tablet the mark names; `buddeln` – the shovel on the mark `buddel` brings up the
 *   cache `ort_<ortstyp>_<stufe>` once (`GatheringSystem.addDigFinds`, `placeDugUp`); `krater`, `leuchtfeuer`, `gewoelbe`,
 *   `arena`, `keine` – nothing at runtime here (ore nodes are objects; beacons, vaults and arenas belong to their systems).
 * - **Table spawns** stay out of a place's rectangle (a spawn blocker): its creatures are its guards.
 *
 * The world comes in through `PlaceWorld` (the simulation's generated world; the tests draw their own).
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { PlaceDef, PlaceLootDef, PlaceMark } from '../../content/places/schema';
import { NULL_ENTITY } from '../../engine/ecs';
import type { LocationSlot } from '../../world/gen/locations';
import type { PlaceMarker, PlacePlacement } from '../../world/gen/places/types';
import type { ChunkData } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import type { GameCommandType } from '../commands';
import type { ConditionsSystem } from '../conditions/system';
import type { CreatureOwner, OwnedCreaturesApi } from '../creatures/owned';
import type { DigFindProvider } from '../gathering/system';
import type { RolledDrop } from '../gathering/formulas';
import type { ItemCatalog } from '../items/catalog';
import { newStack, type ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { PlaceRejectReason } from './events';
import { discoveryRadius, drawPlaceLoot, lootRng, markTier, placeLootId, returningGuards, returnTickOf, type PlaceLootDrop } from './formulas';
import { copyPlaceState, newPlaceState, NOT_YET, placesSnapshotSchema, type PlacesSnapshot } from './state';
import type { PlaceRevealSource, PlacesApi, PlaceState } from './types';

/** Id of the places system and its save participant. */
export const PLACES_SYSTEM_ID = 'places';
/** Data version of the `places` participant. */
export const PLACES_SAVE_VERSION = 1;
/** Object a place's chest becomes once opened (docs/SPIEL.md §29). */
export const OPEN_CHEST_OBJECT = 'ort_truhe_offen';
/** Prefix of the owner of a place's guards. */
const OWNER_PREFIX = 'ort:';

const P = BALANCE.places;
/** The surface: places lie on layer 0. */
const SURFACE: Layer = 0;
/** Packs a surface tile into a map key (wider than any world, WORLD.md §1). */
const TILE_KEY_STRIDE = 65_536;
function tileKey(tx: number, ty: number): number {
  return ty * TILE_KEY_STRIDE + tx;
}

/** The world the places live in (the generated world of the simulation; tests draw their own). */
export interface PlaceWorld {
  /** The location slots (`GeneratedWorld.locations`); slot id = index. */
  slots(sim: Simulation): readonly LocationSlot[];
  /** The places' layouts (`GeneratedWorld.placeLayouts`). */
  placements(sim: Simulation): readonly PlacePlacement[];
  /** The resident chunk (cx, cy) of `layer`, or undefined. */
  chunk(sim: Simulation, layer: Layer, cx: number, cy: number): ChunkData | undefined;
  /** Runtime id of a world object (`WorldIdTables.objects`). */
  objectRuntimeId(id: string): number;
}

/** The world of the simulation: its generated world, chunks and id tables. */
export function worldPlaceWorld(objectRuntimeId: (id: string) => number): PlaceWorld {
  return {
    slots: (sim) => sim.world.generated.locations,
    placements: (sim) => sim.world.generated.placeLayouts,
    chunk: (sim, layer, cx, cy) => sim.world.chunks.get(layer, cx, cy),
    objectRuntimeId,
  };
}

/** Reads a Builder tablet the mark `tafel` names (strand C, wave 2): true when it took the reading. */
export type TabletReader = (sim: Simulation, tablet: string, place: number, tick: number) => boolean;

/** Dependencies of the places system (the systems registered before it). */
export interface PlacesSystemDeps {
  readonly player: PlayerSystem;
  readonly creatures: OwnedCreaturesApi;
  readonly collision: WorldCollision;
  readonly catalog: ItemCatalog;
  /** Spawns a stack as a drop at (x, y) [px] (the drop system). */
  readonly spill: (sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number) => void;
  readonly world: PlaceWorld;
}

/** One place of the world (a slot with a layout) and what the runtime needs of it. */
interface PlaceEntry {
  readonly slot: LocationSlot;
  readonly placement: PlacePlacement;
  readonly def: PlaceDef;
  readonly discoverR2: number;
  /** Chest number per marker (−1: no chest). */
  readonly chestOf: Int8Array;
  readonly chests: number;
  /** Guards in all (Σ `anzahl`). */
  readonly guards: number;
}

/** The places of one world, indexed (built on first use). */
interface PlaceIndex {
  /** By slot id (undefined: no place). */
  readonly bySlot: readonly (PlaceEntry | undefined)[];
  /** Places by the 32-tile chunk of their centre (discovery, spawn blocker). */
  readonly byChunk: ReadonlyMap<number, readonly PlaceEntry[]>;
  /** Marker on a surface tile: `slot × 256 + marker index`. */
  readonly markerAt: ReadonlyMap<number, number>;
  readonly all: readonly PlaceEntry[];
}

/** Markers per place at most (the marker index packs into a byte). */
const MAX_MARKERS = 256;

function chunkKeyOf(cx: number, cy: number): number {
  return cy * TILE_KEY_STRIDE + cx;
}

export class PlacesSystem implements SimSystem, PlacesApi {
  readonly id = PLACES_SYSTEM_ID;
  readonly timeScope = 'global' as const;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private readonly states = new Map<number, PlaceState>();
  private index: PlaceIndex | null = null;
  private conditions: ConditionsSystem | null = null;
  private readonly tabletReaders: TabletReader[] = [];
  /** The player's last checked tile (discovery runs when it changes). */
  private lastTx = Number.NaN;
  private lastTy = Number.NaN;
  private readonly at = { x: 0, y: 0 };
  private readonly loot: PlaceLootDrop[] = [];

  constructor(
    private readonly sim: Simulation,
    private readonly deps: PlacesSystemDeps,
  ) {
    this.commands = {
      'place.use': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.use(s, cmd.place, cmd.marker, tick)),
      'place.discover': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.debugDiscover(s, cmd.place, tick)),
    };
    this.save = {
      id: PLACES_SYSTEM_ID,
      version: PLACES_SAVE_VERSION,
      migrations: [{ from: 0, migrate: () => ({ places: [] }) }],
      serialize: () => this.snapshot(),
      deserialize: (data) => this.restore(data),
    };
    deps.creatures.onOwnedDeath((s, owner) => this.guardFell(s, owner));
    deps.creatures.addSpawnBlocker((s, layer, tx, ty) => layer === SURFACE && this.insidePlace(s, tx, ty));
  }

  /** Connects the conditions (a shrine's blessing, registered after this system). */
  useConditions(conditions: ConditionsSystem): void {
    this.conditions = conditions;
  }

  /** Adds a reader of Builder tablets named by a mark `tafel` (strand C). */
  addTabletReader(reader: TabletReader): void {
    this.tabletReaders.push(reader);
  }

  // -------------------------------------------------------------------------------------------
  // Index
  // -------------------------------------------------------------------------------------------

  private places(sim: Simulation): PlaceIndex {
    if (this.index !== null) return this.index;
    const slots = this.deps.world.slots(sim);
    const defs = CONTENT.collection('locationTypes');
    const bySlot: (PlaceEntry | undefined)[] = new Array<PlaceEntry | undefined>(slots.length);
    const byChunk = new Map<number, PlaceEntry[]>();
    const markerAt = new Map<number, number>();
    const all: PlaceEntry[] = [];
    for (const p of this.deps.world.placements(sim)) {
      const slot = slots[p.slot];
      const def = defs.find(p.type) as PlaceDef | undefined;
      if (slot === undefined || def === undefined) continue;
      if (p.markers.length > MAX_MARKERS) throw new RangeError(`Place ${p.slot}: more than ${MAX_MARKERS} marks`);
      const chestOf = new Int8Array(p.markers.length).fill(-1);
      let chests = 0;
      p.markers.forEach((m, k) => {
        if (m.mark === 'truhe') chestOf[k] = chests++;
        markerAt.set(tileKey(m.tx, m.ty), p.slot * MAX_MARKERS + k);
      });
      const r = discoveryRadius(def.entdeckungTiles, slot.radius);
      const entry: PlaceEntry = { slot, placement: p, def, discoverR2: r * r, chestOf, chests, guards: def.waechter.reduce((n, g) => n + g.anzahl, 0) };
      bySlot[p.slot] = entry;
      all.push(entry);
      const key = chunkKeyOf(slot.x >> CHUNK_SHIFT, slot.y >> CHUNK_SHIFT);
      const list = byChunk.get(key);
      if (list === undefined) byChunk.set(key, [entry]);
      else list.push(entry);
    }
    this.index = { bySlot, byChunk, markerAt, all };
    return this.index;
  }

  private entry(sim: Simulation, slot: number): PlaceEntry | undefined {
    return this.places(sim).bySlot[slot];
  }

  /** Whether surface tile (tx, ty) lies in the rectangle of a place (table spawns stay out). */
  private insidePlace(sim: Simulation, tx: number, ty: number): boolean {
    const idx = this.places(sim);
    const cx = tx >> CHUNK_SHIFT;
    const cy = ty >> CHUNK_SHIFT;
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        const list = idx.byChunk.get(chunkKeyOf(x, y));
        if (list === undefined) continue;
        for (let i = 0; i < list.length; i++) {
          const p = (list[i] as PlaceEntry).placement;
          if (tx >= p.x0 && ty >= p.y0 && tx < p.x0 + p.width && ty < p.y0 + p.height) return true;
        }
      }
    }
    return false;
  }

  /** The state of a slot, created on first touch. */
  private touch(slot: number): PlaceState {
    let s = this.states.get(slot);
    if (s === undefined) {
      s = newPlaceState(slot);
      this.states.set(slot, s);
    }
    return s;
  }

  // -------------------------------------------------------------------------------------------
  // PlacesApi
  // -------------------------------------------------------------------------------------------

  state(slot: number): Readonly<PlaceState> | undefined {
    return this.states.get(slot);
  }

  isDiscovered(slot: number): boolean {
    return (this.states.get(slot)?.discoveredTick ?? NOT_YET) !== NOT_YET;
  }

  /** Whether the place is on the map: discovered or revealed. */
  isKnown(slot: number): boolean {
    const s = this.states.get(slot);
    return s !== undefined && (s.discoveredTick !== NOT_YET || s.revealedBy !== null);
  }

  reveal(sim: Simulation, slot: number, source: PlaceRevealSource): boolean {
    const e = this.entry(sim, slot);
    if (e === undefined || source === 'entdeckt' || this.isKnown(slot)) return false;
    this.touch(slot).revealedBy = source;
    sim.events.push('placeRevealed', { place: slot, ortstyp: e.def.id, quelle: source, tick: sim.eventTick });
    return true;
  }

  nearestHidden(type: string, layer: Layer, tx: number, ty: number): number {
    if (layer !== SURFACE) return -1;
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (const e of this.places(this.sim).all) {
      if (e.def.id !== type || this.isKnown(e.slot.id)) continue;
      const dx = e.slot.x - tx;
      const dy = e.slot.y - ty;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = e.slot.id;
      }
    }
    return best;
  }

  placementOf(slot: number): PlacePlacement | undefined {
    return this.entry(this.sim, slot)?.placement;
  }

  markerOf(slot: number, mark: string, out: { tx: number; ty: number; data: string }): boolean {
    const p = this.placementOf(slot);
    if (p === undefined) return false;
    for (const m of p.markers) {
      if (m.mark !== mark) continue;
      out.tx = m.tx;
      out.ty = m.ty;
      out.data = m.data;
      return true;
    }
    return false;
  }

  forEachKnown(visit: (slot: number, state: Readonly<PlaceState>) => void): void {
    for (const s of this.states.values()) if (s.discoveredTick !== NOT_YET || s.revealedBy !== null) visit(s.slot, s);
  }

  /** The location type of the place in `slot`, or undefined. */
  defOf(slot: number): PlaceDef | undefined {
    return this.entry(this.sim, slot)?.def;
  }

  /** The location slot of the place in `slot`, or undefined (no place there). */
  slotOf(slot: number): LocationSlot | undefined {
    return this.entry(this.sim, slot)?.slot;
  }

  /** Every place of the world (slots with a layout), in slot order. */
  forEachPlace(visit: (slot: LocationSlot, def: PlaceDef, placement: PlacePlacement) => void): void {
    for (const e of this.places(this.sim).all) visit(e.slot, e.def, e.placement);
  }

  /** Whether every chest of the place is open (plundered; false for a place without chests). */
  isLooted(slot: number): boolean {
    const e = this.entry(this.sim, slot);
    const s = this.states.get(slot);
    return e !== undefined && s !== undefined && e.chests > 0 && s.chestsOpened === (1 << e.chests) - 1;
  }

  /** Whether the place is cleansed now (its guards fell and have not come back). */
  isCleansed(slot: number): boolean {
    return (this.states.get(slot)?.cleansedTick ?? NOT_YET) !== NOT_YET;
  }

  /** The marker on surface tile (tx, ty): place slot and marker index into `out`; false when none. */
  markerAtTile(sim: Simulation, tx: number, ty: number, out: { place: number; marker: number }): boolean {
    const v = this.places(sim).markerAt.get(tileKey(tx, ty));
    if (v === undefined) return false;
    out.place = Math.floor(v / MAX_MARKERS);
    out.marker = v % MAX_MARKERS;
    return true;
  }

  /** The marker `marker` of the place in `slot`, or undefined. */
  marker(slot: number, marker: number): PlaceMarker | undefined {
    return this.placementOf(slot)?.markers[marker];
  }

  /** Whether the chest at marker `marker` of the place is open. */
  chestOpen(slot: number, marker: number): boolean {
    const e = this.entry(this.sim, slot);
    const c = e?.chestOf[marker] ?? -1;
    return c >= 0 && ((this.states.get(slot)?.chestsOpened ?? 0) & (1 << c)) !== 0;
  }

  /** Whether a shrine's blessing is ready at `tick`. */
  blessingReady(slot: number, tick: number): boolean {
    return tick >= (this.states.get(slot)?.blessingReadyTick ?? 0);
  }

  // -------------------------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    const body = this.deps.player.body(sim);
    if (body === undefined || body.layer !== SURFACE || !this.deps.player.position(sim, this.at)) return;
    const tx = Math.floor(this.at.x / TILE_PX);
    const ty = Math.floor(this.at.y / TILE_PX);
    if (tx === this.lastTx && ty === this.lastTy) return;
    this.lastTx = tx;
    this.lastTy = ty;
    const idx = this.places(sim);
    const cx = tx >> CHUNK_SHIFT;
    const cy = ty >> CHUNK_SHIFT;
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        const list = idx.byChunk.get(chunkKeyOf(x, y));
        if (list === undefined) continue;
        for (let i = 0; i < list.length; i++) {
          const e = list[i] as PlaceEntry;
          if (this.isDiscovered(e.slot.id)) continue;
          const dx = e.slot.x - tx;
          const dy = e.slot.y - ty;
          if (dx * dx + dy * dy <= e.discoverR2) this.discover(sim, e, sim.eventTick);
        }
      }
    }
  }

  /** Guards come back when their day has come (absolute ticks: nothing to catch up). */
  worldTick(sim: Simulation): void {
    const tick = sim.tick;
    for (const s of this.states.values()) {
      if (s.returnTick === NOT_YET || tick < s.returnTick) continue;
      const e = this.entry(sim, s.slot);
      s.returnTick = NOT_YET;
      s.cleansedTick = NOT_YET;
      if (e === undefined) continue;
      const n = this.spawnGuards(sim, e, returningGuards(e.guards));
      s.guardsAlive = n;
      sim.events.push('placeGuardsReturned', { place: s.slot, ortstyp: e.def.id, anzahl: n, tick: sim.eventTick });
    }
  }

  private discover(sim: Simulation, e: PlaceEntry, tick: number): void {
    const s = this.touch(e.slot.id);
    s.discoveredTick = tick;
    if (s.revealedBy === null) s.revealedBy = 'entdeckt';
    sim.events.push('placeDiscovered', { place: e.slot.id, ortstyp: e.def.id, variante: e.slot.variant, biome: e.slot.biome, x: e.slot.x, y: e.slot.y, layer: SURFACE, tick });
    if (e.guards > 0) s.guardsAlive = this.spawnGuards(sim, e, e.guards);
  }

  /** Spawns the first `count` guards of the place at its guard marks (round robin, spread around a shared mark); returns how many. */
  private spawnGuards(sim: Simulation, e: PlaceEntry, count: number): number {
    const marks = e.placement.markers.filter((m) => m.mark === 'waechter');
    const owner: CreatureOwner = `ort:${e.slot.id}`;
    let n = 0;
    for (const g of e.def.waechter) {
      for (let k = 0; k < g.anzahl && n < count; k++) {
        const m = marks[n % Math.max(1, marks.length)];
        const ring = marks.length === 0 ? n + 1 : Math.floor(n / marks.length);
        const baseX = m === undefined ? e.slot.x : m.tx;
        const baseY = m === undefined ? e.slot.y : m.ty;
        // Guards sharing a mark stand around it (the four neighbours, then farther out).
        const dir = ring % 4;
        const off = ring === 0 ? 0 : Math.ceil(ring / 4) * P.guardSpreadTiles;
        const ox = dir === 1 ? off : dir === 3 ? -off : 0;
        const oy = dir === 2 ? off : dir === 0 && ring > 0 ? -off : 0;
        this.deps.creatures.spawnOwned(sim, {
          creature: g.creature,
          ...(g.variante === undefined ? {} : { variant: g.variante }),
          layer: SURFACE,
          x: (baseX + ox + 0.5) * TILE_PX,
          y: (baseY + oy + 0.5) * TILE_PX,
          owner,
          leashTiles: g.leineTiles ?? P.guardLeashTiles,
        });
        n++;
      }
    }
    return n;
  }

  private guardFell(sim: Simulation, owner: CreatureOwner): void {
    if (!owner.startsWith(OWNER_PREFIX)) return;
    const slot = Number(owner.slice(OWNER_PREFIX.length));
    const s = this.states.get(slot);
    const e = this.entry(sim, slot);
    if (s === undefined || e === undefined || s.guardsAlive <= 0) return;
    s.guardsAlive--;
    if (s.guardsAlive > 0) return;
    s.cleansedTick = sim.eventTick;
    s.returnTick = returnTickOf(s.cleansedTick, sim.clock.ticksPerDay);
    sim.events.push('placeCleansed', { place: slot, ortstyp: e.def.id, tick: sim.eventTick });
  }

  // -------------------------------------------------------------------------------------------
  // Uses
  // -------------------------------------------------------------------------------------------

  private refuse(sim: Simulation, type: GameCommandType, tick: number, reason: PlaceRejectReason | null): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  /** Whether mark `m` of a place has a use (and which mark it is). */
  private usable(e: PlaceEntry | undefined, m: PlaceMarker | undefined): m is PlaceMarker {
    if (e === undefined || m === undefined) return false;
    return USE_MARKS.has(m.mark) && markUse(e.def, m.mark);
  }

  private use(sim: Simulation, slot: number, marker: number, tick: number): PlaceRejectReason | null {
    const { player } = this.deps;
    if (sim.player === NULL_ENTITY || player.body(sim) === undefined || !player.position(sim, this.at)) return 'noPlayer';
    const unable = player.incapacity(sim);
    if (unable !== null) return unable;
    const e = this.entry(sim, slot);
    if (e === undefined) return 'unknownPlace';
    const m = e.placement.markers[marker];
    if (m === undefined) return 'unknownMark';
    if (player.body(sim)?.layer !== SURFACE) return 'outOfReach';
    const dx = this.at.x - (m.tx + 0.5) * TILE_PX;
    const dy = this.at.y - (m.ty + 0.5) * TILE_PX;
    const reach = P.useReachTiles * TILE_PX;
    if (dx * dx + dy * dy > reach * reach) return 'outOfReach';
    if (!this.usable(e, m)) return 'nothingThere';
    // Using a place's mark discovers it (a revealed place visited through its chest, say).
    if (!this.isDiscovered(slot)) this.discover(sim, e, tick);
    switch (m.mark) {
      case 'truhe':
        return this.openChest(sim, e, marker, m, tick);
      case 'aussicht':
        return this.climb(sim, e, m, tick);
      case 'altar':
        return this.pray(sim, e, tick);
      case 'tafel':
        return this.read(sim, e, m, tick);
      default:
        return 'nothingThere';
    }
  }

  private openChest(sim: Simulation, e: PlaceEntry, marker: number, m: PlaceMarker, tick: number): PlaceRejectReason | null {
    const c = e.chestOf[marker] ?? -1;
    if (c < 0) return 'nothingThere';
    const s = this.touch(e.slot.id);
    if ((s.chestsOpened & (1 << c)) !== 0) return 'chestOpen';
    s.chestsOpened |= 1 << c;
    const stufe = markTier(m.data);
    this.setObject(sim, m.tx, m.ty, OPEN_CHEST_OBJECT);
    this.spillLoot(sim, placeLootId(e.def.id, stufe), e.slot.id, c, m);
    sim.events.push('placeChestOpened', { place: e.slot.id, ortstyp: e.def.id, chest: c, stufe, tx: m.tx, ty: m.ty, tick });
    if (s.chestsOpened === (1 << e.chests) - 1) sim.events.push('placeLooted', { place: e.slot.id, ortstyp: e.def.id, tick });
    return null;
  }

  /** Drops the loot of table `table` drawn for (place, key) at mark `m`. */
  private spillLoot(sim: Simulation, table: string, place: number, key: number, m: PlaceMarker): void {
    const def = CONTENT.collection('placeLoot').find(table) as PlaceLootDef | undefined;
    if (def === undefined) return;
    this.loot.length = 0;
    drawPlaceLoot(def, lootRng(sim.config.seed, place, key), this.loot);
    for (const d of this.loot) {
      const item = this.deps.catalog.find(d.item);
      if (item !== undefined) this.deps.spill(sim, newStack(item, d.count), SURFACE, (m.tx + 0.5) * TILE_PX, (m.ty + 0.5) * TILE_PX);
    }
  }

  /** Writes object `id` on surface tile (tx, ty) (a resident chunk: the player stands at it). */
  private setObject(sim: Simulation, tx: number, ty: number, id: string): void {
    const chunk = this.deps.world.chunk(sim, SURFACE, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) return;
    chunk.setObject(((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK), this.deps.world.objectRuntimeId(id));
    this.deps.collision.invalidateTile(SURFACE, tx, ty);
  }

  private climb(sim: Simulation, e: PlaceEntry, m: PlaceMarker, tick: number): PlaceRejectReason | null {
    const radius = e.def.aussichtTiles;
    if (radius === undefined) return 'nothingThere';
    this.touch(e.slot.id).used = true;
    sim.events.push('towerClimbed', { place: e.slot.id, ortstyp: e.def.id, radiusTiles: radius, x: m.tx, y: m.ty, layer: SURFACE, tick });
    return null;
  }

  private pray(sim: Simulation, e: PlaceEntry, tick: number): PlaceRejectReason | null {
    const segen = e.def.segen;
    if (segen === undefined) return 'nothingThere';
    const s = this.touch(e.slot.id);
    if (tick < s.blessingReadyTick) return 'blessingCooling';
    s.blessingReadyTick = tick + Math.round(segen.abklingTage * sim.clock.ticksPerDay);
    this.conditions?.apply(sim, segen.zustand, segen.sekunden);
    sim.events.push('shrineBlessed', { place: e.slot.id, ortstyp: e.def.id, zustand: segen.zustand, sekunden: segen.sekunden, tick });
    return null;
  }

  private read(sim: Simulation, e: PlaceEntry, m: PlaceMarker, tick: number): PlaceRejectReason | null {
    this.touch(e.slot.id).used = true;
    if (m.data !== '') for (const r of this.tabletReaders) if (r(sim, m.data, e.slot.id, tick)) return null;
    sim.events.push('placeNoteRead', { place: e.slot.id, ortstyp: e.def.id, tick });
    return null;
  }

  /** The dig sites' caches as finds of the shovel (`GatheringSystem.addDigFinds`). */
  digFinds(): DigFindProvider {
    const hit = { place: 0, marker: 0 };
    return {
      claims: (layer, tx, ty) => {
        if (layer !== SURFACE || !this.markerAtTile(this.sim, tx, ty, hit)) return false;
        const e = this.entry(this.sim, hit.place);
        const m = e?.placement.markers[hit.marker];
        return e !== undefined && m !== undefined && m.mark === 'buddel' && e.def.wirkung === 'buddeln' && !(this.states.get(hit.place)?.used ?? false);
      },
      dig: (sim, layer, tx, ty, out: RolledDrop[]) => {
        if (layer !== SURFACE || !this.markerAtTile(sim, tx, ty, hit)) return;
        const e = this.entry(sim, hit.place);
        const m = e?.placement.markers[hit.marker];
        if (e === undefined || m === undefined || m.mark !== 'buddel' || e.def.wirkung !== 'buddeln') return;
        const s = this.touch(hit.place);
        if (s.used) return;
        s.used = true;
        if (!this.isDiscovered(hit.place)) this.discover(sim, e, sim.eventTick);
        const def = CONTENT.collection('placeLoot').find(placeLootId(e.def.id, markTier(m.data))) as PlaceLootDef | undefined;
        if (def !== undefined) {
          this.loot.length = 0;
          drawPlaceLoot(def, lootRng(sim.config.seed, hit.place, DIG_KEY), this.loot);
          for (const d of this.loot) out.push({ item: d.item, count: d.count });
        }
        sim.events.push('placeDugUp', { place: hit.place, ortstyp: e.def.id, tx, ty, tick: sim.eventTick });
      },
    };
  }

  private debugDiscover(sim: Simulation, slot: number, tick: number): PlaceRejectReason | null {
    const e = this.entry(sim, slot);
    if (e === undefined) return 'unknownPlace';
    if (!this.isDiscovered(slot)) this.discover(sim, e, tick);
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------------------------

  private snapshot(): PlacesSnapshot {
    return { places: [...this.states.values()].sort((a, b) => a.slot - b.slot).map(copyPlaceState) };
  }

  private restore(data: unknown): void {
    const parsed = placesSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`places snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    const seen = new Set<number>();
    for (const p of parsed.data.places) {
      if (seen.has(p.slot)) throw new TypeError(`places snapshot invalid: slot ${p.slot} twice`);
      seen.add(p.slot);
    }
    this.states.clear();
    for (const p of parsed.data.places) this.states.set(p.slot, copyPlaceState(p));
    this.lastTx = Number.NaN;
    this.lastTy = Number.NaN;
  }
}

/** Key of the dig site's cache in the loot draw (chests use their number 0 …; far from any chest count). */
const DIG_KEY = 1_000;

/** The marks a player uses with E. */
const USE_MARKS: ReadonlySet<PlaceMark> = new Set(['truhe', 'aussicht', 'altar', 'tafel']);

/** Whether a location type uses mark `mark` (a chest everywhere; the others only with their effect). */
function markUse(def: PlaceDef, mark: PlaceMark): boolean {
  switch (mark) {
    case 'truhe':
      return true;
    case 'aussicht':
      return def.wirkung === 'aussicht';
    case 'altar':
      return def.wirkung === 'segen';
    case 'tafel':
      return def.wirkung === 'tafel';
    default:
      return false;
  }
}
