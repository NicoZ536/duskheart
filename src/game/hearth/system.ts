/**
 * Hearth system (MASTERPROMPT §16.5 "Herdfeuer (Basiskern)"; docs/SPIEL.md §8 "Herdfeuer (M4-20)"; M4-20).
 *
 * - **The core of a base** stands on the build grid: the item `herdfeuer` placed with `build.place` (a 3 × 3 ring of
 *   stone); the system hears it come and go (`BuildingSystem.addPartListener`). At most three hearths, one per base:
 *   a new one keeps `minSpacingTiles` from the others (`addPlacementRule`: `hearthLimit`, `hearthTooClose`). A lit
 *   hearth or one that holds fuel or cores is not taken down (`addRemovalRule` with the public `removalProblem`, which
 *   the build mode's ghost asks too: `burning`, `notEmpty`).
 * - **Fuel** (`hearth.fuel`, `hearth.take`): logs burn a game hour, charcoal three (§16.5; the Lumen shard follows in
 *   M6-28), a store of 40 pieces. A lit hearth (`hearth.ignite`, `hearth.douse`) takes the next piece the moment the
 *   last one is used up and goes out when the store is empty. Hearths in active chunks burn tick by tick with events;
 *   frozen ones catch up by their timestamp when their chunk activates (`catchUp`, exact in ticks).
 * - **Ember cores** (`hearth.core`, `hearth.uncore`): niche n takes core n (`glutkern_n`, one per beacon, from M7);
 *   the base's radius grows from 12 to 40 tiles (`BALANCE.hearth.radiusByCores`).
 * - **While it burns** (§16.5): no Schattenbrut spawns in its radius (`spawnBlocked`, the spawn rule of M6), the
 *   overview of every chest of the base (`overview`), a respawn point (`respawnSpots`, the death system) and a
 *   fast-travel target (`travelTargets`, M7-37); it gives light (`lightProvider`) and warmth (`heatSources`). When
 *   it goes out, all of that ends.
 * - **The base** (`zoneAt`, `baseAreas`): the radius around a hearth, lit or not – the chests a search runs over
 *   (the storage system's bases) and the ground where felled trees do not grow back (gathering, ADR-0032).
 *
 * A dead or sleeping player works no hearth (every command refused with the reason). Chunk-bound (catch-up registry).
 * Save participant `hearth` (version 1).
 */
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY } from '../../engine/ecs';
import { CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import type { PartDef } from '../../world/structures/catalog';
import { cellRot, rotatedSize } from '../../world/structures/cells';
import type { BuildingSystem } from '../building/system';
import type { CommandOfType, GameCommandType } from '../commands';
import type { SpillItems } from '../crafting/sources';
import type { BeaconSpot } from '../death/system';
import type { BaseAreas } from '../gathering/system';
import { isValidRef, slotAt, withSlot } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import { checkStack, newStack, withCount, type ItemStack } from '../items/stack';
import type { ExtraLightProvider } from '../light/system';
import type { SaveParticipant } from '../participant';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import { storedTotals } from '../storage/formulas';
import type { Chest } from '../storage/state';
import type { StorageSystem } from '../storage/system';
import type { HeatSource, HeatSourceProvider } from '../survival/modifiers';
import type { HearthOutReason, HearthRejectReason } from './events';
import { advanceHearth, coreCount, hearthCentre, hearthFuelTicks, litAt, radiusForCores, storedPieces, takePiece } from './formulas';
import { CORE_NICHES, copyHearthState, createHearthState, hearthSnapshotSchema, type Hearth, type HearthState } from './state';

/** Id of the hearth system and its save participant. */
export const HEARTH_SYSTEM_ID = 'hearth';
/** Data version of the `hearth` participant. */
export const HEARTH_SAVE_VERSION = 1;
/** The item that is a hearth (docs/SPIEL.md §8). */
export const HEARTH_ITEM = 'herdfeuer';
/** Light kind of a hearth in the light source list (not a light of the light system; the renderer reads colour and radius). */
export const HEARTH_LIGHT_KIND = 'herdfeuer';
/** Light ids of hearths start at 2^20 (placed lights count from 1, fires of the fire system far above). */
const LIGHT_ID_BITS = 20;
const LIGHT_ID_BASE = 1 << LIGHT_ID_BITS;

const H = BALANCE.hearth;
const REACH_PX = H.reachTiles * TILE_PX;
const SPACING_PX = H.minSpacingTiles * TILE_PX;
const TICK_HZ = BALANCE.time.tickHz;

/** Whether a chunk is in the active zone (its hearths burn tick by tick; the others catch up). */
export interface HearthEnvironment {
  active(sim: Simulation, layer: Layer, cx: number, cy: number): boolean;
}

/** The environment of the simulation's own world: the active zone. */
export function worldHearthEnvironment(): HearthEnvironment {
  return { active: (sim, layer, cx, cy) => sim.world.materialized && sim.world.zone.isActive(layer, cx, cy) };
}

/** The base around a tile: its hearth, centre [world px] and radius [px]. */
export interface HearthZone {
  readonly hearth: number;
  readonly layer: Layer;
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  /** Whether the hearth burns now. */
  readonly lit: boolean;
}

/** The overview of a lit hearth's base (§16.5 "Lagerübersicht aller Kisten"). */
export interface HearthOverview {
  readonly chests: readonly Readonly<Chest>[];
  /** Pieces per item over those chests, items in id order. */
  readonly totals: ReadonlyMap<string, number>;
}

/** A place to travel to (a burning hearth). */
export interface TravelTarget extends BeaconSpot {
  readonly hearth: number;
}

/** Dependencies of the hearth system. */
export interface HearthSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  /** The build grid: the hearth is its part. */
  readonly building: BuildingSystem;
  /** Where fuel and cores of a destroyed hearth go (the drop system). */
  readonly spill: SpillItems;
  /** The chests of the overview (optional: no overview without). */
  readonly storage?: StorageSystem;
  /** Default: `worldHearthEnvironment()`. */
  readonly environment?: HearthEnvironment;
}

type Refusal = HearthRejectReason | null;

class HeatRecord implements HeatSource {
  x = 0;
  y = 0;
  layer: Layer = 0;
  coreHeatC = H.heat.coreHeatC;
  coreRadiusPx = H.heat.coreRadiusTiles * TILE_PX;
  radiusPx = H.heat.radiusTiles * TILE_PX;
}

export class HearthSystem implements SimSystem {
  readonly id = HEARTH_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;

  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly building: BuildingSystem;
  private readonly spill: SpillItems;
  private readonly storage: StorageSystem | null;
  private readonly env: HearthEnvironment;
  private stateValue: HearthState = createHearthState();
  private ticksPerGameHour = 0;
  private readonly fuelTicks = (item: string): number => hearthFuelTicks(item, this.ticksPerGameHour);
  private readonly heatRecords: HeatRecord[] = [];
  private readonly heatList: HeatRecord[] = [];
  private readonly at = { x: 0, y: 0 };
  private readonly centre = { x: 0, y: 0 };
  // The hearth and simulation of a loud advance (no closure per tick).
  private loudSim: Simulation | null = null;
  private loudHearth: Hearth | null = null;
  private readonly onOut = (tick: number): void => {
    const sim = this.loudSim;
    const h = this.loudHearth;
    if (sim !== null && h !== null) sim.events.push('hearthOut', { ...this.base(h, tick), reason: 'brennstoff' });
  };

  constructor(deps: HearthSystemDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.building = deps.building;
    this.spill = deps.spill;
    this.storage = deps.storage ?? null;
    this.env = deps.environment ?? worldHearthEnvironment();
    this.building.addPartListener({
      placed: (sim, part, layer, tx, ty) => this.attach(sim, part, layer, tx, ty),
      removed: (sim, part, layer, tx, ty) => this.detach(sim, part, layer, tx, ty),
    });
    this.building.addPlacementRule((_sim, part, layer, tx, ty, w, h) => (part.id === HEARTH_ITEM ? this.placementProblem(layer, tx, ty, w, h) : null));
    this.building.addRemovalRule((_sim, part, layer, tx, ty) => this.removalProblem(part, layer, tx, ty));
    this.commands = {
      'hearth.use': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.use(sim, cmd.hearth, tick)),
      'hearth.fuel': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.fuel(sim, cmd, tick)),
      'hearth.take': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.take(sim, cmd, tick)),
      'hearth.ignite': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.ignite(sim, cmd.hearth, tick)),
      'hearth.douse': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.douse(sim, cmd.hearth, tick)),
      'hearth.core': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.core(sim, cmd, tick)),
      'hearth.uncore': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.uncore(sim, cmd, tick)),
    };
    this.save = {
      id: HEARTH_SYSTEM_ID,
      version: HEARTH_SAVE_VERSION,
      // Saves from before the hearth (save version 1, M3) have none.
      migrations: [{ from: 0, migrate: () => ({ hearths: [], nextId: 1 }) }],
      serialize: () => copyHearthState(this.stateValue),
      deserialize: (data) => this.restore(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  /** Every hearth (read-only for callers). */
  get hearths(): readonly Readonly<Hearth>[] {
    return this.stateValue.hearths;
  }

  /** The hearth `id`, or `undefined`. */
  hearth(id: number): Readonly<Hearth> | undefined {
    return this.stateValue.hearths.find((h) => h.id === id);
  }

  /** The hearth covering tile (tx, ty) of `layer`, or `undefined`. */
  hearthAt(layer: Layer, tx: number, ty: number): Readonly<Hearth> | undefined {
    return this.stateValue.hearths.find((h) => h.layer === layer && tx >= h.tx && tx < h.tx + h.w && ty >= h.ty && ty < h.ty + h.h);
  }

  /**
   * Why the part `part` anchored on (tx, ty) of `layer` cannot be taken down or replaced now as far as the hearth is
   * concerned (`build.remove`, `build.upgrade`), or `null`: a lit hearth (`burning`) or one that holds fuel or ember
   * cores (`notEmpty`) stays. Read-only – the building system asks it as a removal rule, the build mode's ghost before the
   * click (M5-36).
   */
  removalProblem(part: Pick<PartDef, 'id'>, layer: Layer, tx: number, ty: number): 'burning' | 'notEmpty' | null {
    const h = part.id === HEARTH_ITEM ? this.anchoredAt(layer, tx, ty) : undefined;
    if (h === undefined) return null;
    if (h.lit) return 'burning';
    return h.vorrat.length > 0 || coreCount(h.kerne) > 0 ? 'notEmpty' : null;
  }

  /** Radius of the base around hearth `h` [tiles] (§16.5: 12, with ember cores up to 40). */
  radiusTiles(h: Pick<Hearth, 'kerne'>): number {
    return radiusForCores(coreCount(h.kerne));
  }

  /** Whether hearth `h` burns now (a frozen one: what it would after catching up). */
  burning(sim: Simulation, h: Readonly<Hearth>): boolean {
    this.ticksPerGameHour = sim.clock.ticksPerGameHour;
    return litAt(h, sim.tick, this.fuelTicks);
  }

  /** Burn time left in hearth `h`: the piece burning now and the store [s]. */
  secondsLeft(sim: Simulation, h: Readonly<Hearth>): number {
    this.ticksPerGameHour = sim.clock.ticksPerGameHour;
    if (!h.lit) return 0;
    let t = h.rest - Math.max(0, sim.tick - h.bis);
    for (const s of h.vorrat) t += s.count * this.fuelTicks(s.item);
    return Math.max(0, t) / TICK_HZ;
  }

  /**
   * The base around tile (tx, ty) of `layer`: the hearth whose radius covers it (the nearest), lit or not, or `null`
   * outside every base.
   */
  zoneAt(sim: Simulation, layer: Layer, tx: number, ty: number): HearthZone | null {
    let best: HearthZone | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    const x = (tx + 1 / 2) * TILE_PX;
    const y = (ty + 1 / 2) * TILE_PX;
    for (const h of this.stateValue.hearths) {
      if (h.layer !== layer) continue;
      hearthCentre(h, this.centre);
      const r = this.radiusTiles(h) * TILE_PX;
      const d = Math.hypot(this.centre.x - x, this.centre.y - y);
      if (d > r || d >= bestD) continue;
      bestD = d;
      best = { hearth: h.id, layer, x: this.centre.x, y: this.centre.y, radiusPx: r, lit: this.burning(sim, h) };
    }
    return best;
  }

  /**
   * Whether no Schattenbrut may spawn at world px (x, y) on `layer` (§16.5 "Solange es brennt: keine
   * Schattenbrut-Spawns im Radius"): a burning hearth's radius covers it. The spawn rule of the creature system (M6).
   */
  spawnBlocked(sim: Simulation, layer: Layer, x: number, y: number): boolean {
    for (const h of this.stateValue.hearths) {
      if (h.layer !== layer) continue;
      hearthCentre(h, this.centre);
      const r = this.radiusTiles(h) * TILE_PX;
      if (Math.hypot(this.centre.x - x, this.centre.y - y) <= r && this.burning(sim, h)) return true;
    }
    return false;
  }

  /** The chests of the base of burning hearth `id` and what they hold, or `null` when it does not burn (§16.5). */
  overview(sim: Simulation, id: number): HearthOverview | null {
    const h = this.hearth(id);
    if (h === undefined || this.storage === null || !this.burning(sim, h)) return null;
    hearthCentre(h, this.centre);
    const chests = this.storage.near(h.layer, this.centre.x, this.centre.y, this.radiusTiles(h) * TILE_PX);
    return { chests, totals: storedTotals(chests) };
  }

  /** Where the player can wake at a burning hearth: in front of each (§16.5 "Wiedereinstiegspunkt"). */
  respawnSpots(sim: Simulation): BeaconSpot[] {
    const out: BeaconSpot[] = [];
    for (const h of this.stateValue.hearths) {
      if (!this.burning(sim, h)) continue;
      out.push({ x: (h.tx + h.w / 2) * TILE_PX, y: (h.ty + h.h + 1 / 2) * TILE_PX, layer: h.layer });
    }
    return out;
  }

  /** The burning hearths as fast-travel targets (§16.5 "Schnellreiseziel"; travelling itself is M7-37): the centre of each. */
  travelTargets(sim: Simulation): TravelTarget[] {
    const out: TravelTarget[] = [];
    for (const h of this.stateValue.hearths) {
      if (!this.burning(sim, h)) continue;
      hearthCentre(h, this.centre);
      out.push({ hearth: h.id, x: this.centre.x, y: this.centre.y, layer: h.layer });
    }
    return out;
  }

  /** Whether tile (tx, ty) of `layer` lies in the radius of a hearth, lit or not. */
  inBase(layer: Layer, tx: number, ty: number): boolean {
    const x = (tx + 1 / 2) * TILE_PX;
    const y = (ty + 1 / 2) * TILE_PX;
    for (const h of this.stateValue.hearths) {
      if (h.layer !== layer) continue;
      hearthCentre(h, this.centre);
      if (Math.hypot(this.centre.x - x, this.centre.y - y) <= this.radiusTiles(h) * TILE_PX) return true;
    }
    return false;
  }

  /** The bases as areas of the gathering system: felled trees do not grow back inside a base (ADR-0032). */
  baseAreas(): BaseAreas {
    return { inBase: (layer, tx, ty) => this.inBase(layer, tx, ty) };
  }

  /** Burning hearths of the active zone as heat sources (§11.2; the player's influences and rooms). */
  heatSources(): HeatSourceProvider {
    return (sim) => {
      this.heatList.length = 0;
      let k = 0;
      for (const h of this.stateValue.hearths) {
        if (!h.lit || !this.env.active(sim, h.layer, h.tx >> CHUNK_SHIFT, h.ty >> CHUNK_SHIFT)) continue;
        let r = this.heatRecords[k];
        if (r === undefined) {
          r = new HeatRecord();
          this.heatRecords.push(r);
        }
        k++;
        hearthCentre(h, r);
        r.layer = h.layer;
        this.heatList.push(r);
      }
      return this.heatList;
    };
  }

  /** Burning hearths of the active zone as lights of the light source list (§12.1). */
  lightProvider(): ExtraLightProvider {
    const L = H.light;
    return (sim, emit) => {
      for (const h of this.stateValue.hearths) {
        if (!h.lit || !this.env.active(sim, h.layer, h.tx >> CHUNK_SHIFT, h.ty >> CHUNK_SHIFT)) continue;
        hearthCentre(h, this.centre);
        emit(LIGHT_ID_BASE + h.id, HEARTH_LIGHT_KIND, L.farbe, h.layer, this.centre.x, this.centre.y, L.flameHeightPx, L.radiusTiles * TILE_PX, L.intensity, L.flicker, this.secondsLeft(sim, h), L.radiusTiles);
      }
    };
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    this.ticksPerGameHour = sim.clock.ticksPerGameHour;
    const to = sim.tick + 1;
    for (const h of this.stateValue.hearths) {
      if (!this.env.active(sim, h.layer, h.tx >> CHUNK_SHIFT, h.ty >> CHUNK_SHIFT)) continue;
      this.loudSim = sim;
      this.loudHearth = h;
      advanceHearth(h, to, this.fuelTicks, this.onOut);
      this.loudSim = null;
      this.loudHearth = null;
    }
  }

  /** A frozen chunk activates: its hearths burn from their timestamp to `toTick` (analytic, no events). */
  catchUp(chunk: { readonly layer: Layer; readonly cx: number; readonly cy: number }, _fromTick: number, toTick: number): void {
    for (const h of this.stateValue.hearths) {
      if (h.layer !== chunk.layer || h.tx >> CHUNK_SHIFT !== chunk.cx || h.ty >> CHUNK_SHIFT !== chunk.cy) continue;
      advanceHearth(h, toTick, this.fuelTicks);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Build grid
  // -------------------------------------------------------------------------------------------

  /** Why a hearth may not stand with its anchor on (tx, ty) (footprint w × h), or `null`. */
  private placementProblem(layer: Layer, tx: number, ty: number, w: number, h: number): 'hearthLimit' | 'hearthTooClose' | null {
    if (this.stateValue.hearths.length >= H.maxBases) return 'hearthLimit';
    const x = (tx + w / 2) * TILE_PX;
    const y = (ty + h / 2) * TILE_PX;
    for (const other of this.stateValue.hearths) {
      if (other.layer !== layer) continue;
      hearthCentre(other, this.centre);
      if (Math.hypot(this.centre.x - x, this.centre.y - y) < SPACING_PX) return 'hearthTooClose';
    }
    return null;
  }

  private attach(sim: Simulation, part: PartDef, layer: Layer, tx: number, ty: number): void {
    if (part.id !== HEARTH_ITEM || this.anchoredAt(layer, tx, ty) !== undefined) return;
    const size = rotatedSize(part.w, part.h, cellRot(this.building.structures.cell(layer, part.layerIndex, tx, ty)));
    const h: Hearth = { id: this.stateValue.nextId++, layer, tx, ty, w: size.w, h: size.h, lit: false, rest: 0, voll: 0, vorrat: [], kerne: new Array<string | null>(CORE_NICHES).fill(null), bis: sim.tick };
    this.stateValue.hearths.push(h);
    sim.events.push('hearthBuilt', { ...this.base(h, sim.eventTick), tx, ty, radiusTiles: this.radiusTiles(h) });
  }

  private detach(sim: Simulation, part: PartDef, layer: Layer, tx: number, ty: number): void {
    if (part.id !== HEARTH_ITEM) return;
    const h = this.anchoredAt(layer, tx, ty);
    if (h === undefined) return;
    this.stateValue.hearths.splice(this.stateValue.hearths.indexOf(h), 1);
    hearthCentre(h, this.centre);
    const x = this.centre.x;
    const y = this.centre.y;
    const catalog = this.inventory.bags.catalog;
    const out: ItemStack[] = [...h.vorrat];
    for (const k of h.kerne) if (k !== null) out.push(newStack(catalog.get(k), 1));
    for (const s of out) this.spill(sim, s, layer, x, y);
    sim.events.push('hearthRemoved', { hearth: h.id, layer, x, y, spilled: out.length, tick: sim.eventTick });
  }

  private anchoredAt(layer: Layer, tx: number, ty: number): Hearth | undefined {
    return this.stateValue.hearths.find((h) => h.layer === layer && h.tx === tx && h.ty === ty);
  }

  // -------------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------------

  private refuse(sim: Simulation, type: GameCommandType, tick: number, reason: Refusal): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  /** The hearth `id` within reach of a player who can act, or the refusal. Fills `this.at`. */
  private reachable(sim: Simulation, id: number): Hearth | HearthRejectReason {
    if (sim.player === NULL_ENTITY || this.player.body(sim) === undefined || !this.player.position(sim, this.at)) return 'noPlayer';
    const unable = this.player.incapacity(sim);
    if (unable !== null) return unable;
    const h = this.stateValue.hearths.find((x) => x.id === id);
    if (h === undefined) return 'unknownHearth';
    if (this.player.body(sim)?.layer !== h.layer || this.distance(h, this.at.x, this.at.y) > REACH_PX) return 'outOfReach';
    this.ticksPerGameHour = sim.clock.ticksPerGameHour;
    return h;
  }

  private use(sim: Simulation, id: number, tick: number): Refusal {
    const h = this.reachable(sim, id);
    if (typeof h === 'string') return h;
    sim.events.push('hearthOpened', this.base(h, tick));
    return null;
  }

  private fuel(sim: Simulation, cmd: CommandOfType<'hearth.fuel'>, tick: number): Refusal {
    const h = this.reachable(sim, cmd.hearth);
    if (typeof h === 'string') return h;
    const bags = this.inventory.state;
    if (!isValidRef(bags, cmd.from)) return 'invalidSlot';
    const stack = slotAt(bags, cmd.from);
    if (stack === null) return 'slotEmpty';
    if (this.fuelTicks(stack.item) <= 0) return 'notFuel';
    const room = H.storePieces - storedPieces(h.vorrat);
    const n = Math.min(cmd.count ?? stack.count, stack.count, room);
    if (n < 1) return 'storeFull';
    const last = h.vorrat[h.vorrat.length - 1];
    if (last !== undefined && last.item === stack.item) h.vorrat[h.vorrat.length - 1] = withCount(last, last.count + n);
    else h.vorrat.push(newStack(this.inventory.bags.catalog.get(stack.item), n));
    this.inventory.bags.replace(withSlot(bags, cmd.from, stack.count > n ? withCount(stack, stack.count - n) : null));
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    sim.events.push('hearthFueled', { ...this.base(h, tick), item: stack.item, count: n, stored: storedPieces(h.vorrat) });
    return null;
  }

  private take(sim: Simulation, cmd: CommandOfType<'hearth.take'>, tick: number): Refusal {
    const h = this.reachable(sim, cmd.hearth);
    if (typeof h === 'string') return h;
    const stack = h.vorrat[cmd.index];
    if (stack === undefined) return 'slotEmpty';
    const want = Math.min(cmd.count ?? stack.count, stack.count);
    const { added } = this.inventory.giveStack(sim, withCount(stack, want));
    if (added < 1) return 'bagsFull';
    if (stack.count > added) h.vorrat[cmd.index] = withCount(stack, stack.count - added);
    else h.vorrat.splice(cmd.index, 1);
    sim.events.push('hearthFuelTaken', { ...this.base(h, tick), item: stack.item, count: added, stored: storedPieces(h.vorrat) });
    return null;
  }

  private ignite(sim: Simulation, id: number, tick: number): Refusal {
    const h = this.reachable(sim, id);
    if (typeof h === 'string') return h;
    if (h.lit) return 'burning';
    if (h.rest === 0 && !takePiece(h, this.fuelTicks)) return 'noFuel';
    h.lit = true;
    sim.events.push('hearthIgnited', { ...this.base(h, tick), radiusTiles: this.radiusTiles(h) });
    return null;
  }

  private douse(sim: Simulation, id: number, tick: number): Refusal {
    const h = this.reachable(sim, id);
    if (typeof h === 'string') return h;
    if (!h.lit) return 'notBurning';
    h.lit = false;
    this.out(sim, h, 'geloescht', tick);
    return null;
  }

  private core(sim: Simulation, cmd: CommandOfType<'hearth.core'>, tick: number): Refusal {
    const h = this.reachable(sim, cmd.hearth);
    if (typeof h === 'string') return h;
    const bags = this.inventory.state;
    if (!isValidRef(bags, cmd.from)) return 'invalidSlot';
    const stack = slotAt(bags, cmd.from);
    if (stack === null) return 'slotEmpty';
    const index = H.coreItems.indexOf(stack.item);
    if (index < 0) return 'notACore';
    if (h.kerne[index] !== null) return 'coreSet';
    h.kerne[index] = stack.item;
    this.inventory.bags.replace(withSlot(bags, cmd.from, stack.count > 1 ? withCount(stack, stack.count - 1) : null));
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    sim.events.push('hearthCoreSet', { ...this.base(h, tick), index, core: stack.item, radiusTiles: this.radiusTiles(h) });
    return null;
  }

  private uncore(sim: Simulation, cmd: CommandOfType<'hearth.uncore'>, tick: number): Refusal {
    const h = this.reachable(sim, cmd.hearth);
    if (typeof h === 'string') return h;
    const core = h.kerne[cmd.index] ?? null;
    if (core === null) return 'noCore';
    const { added } = this.inventory.giveStack(sim, newStack(this.inventory.bags.catalog.get(core), 1));
    if (added < 1) return 'bagsFull';
    h.kerne[cmd.index] = null;
    sim.events.push('hearthCoreTaken', { ...this.base(h, tick), index: cmd.index, core, radiusTiles: this.radiusTiles(h) });
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  private out(sim: Simulation, h: Hearth, reason: HearthOutReason, tick: number): void {
    sim.events.push('hearthOut', { ...this.base(h, tick), reason });
  }

  private base(h: Hearth, tick: number): { hearth: number; layer: number; x: number; y: number; tick: number } {
    hearthCentre(h, this.centre);
    return { hearth: h.id, layer: h.layer, x: this.centre.x, y: this.centre.y, tick };
  }

  /** Distance from world px (x, y) to the footprint of `h` [px] (0 inside). */
  private distance(h: Hearth, x: number, y: number): number {
    const x0 = h.tx * TILE_PX;
    const y0 = h.ty * TILE_PX;
    const x1 = (h.tx + h.w) * TILE_PX;
    const y1 = (h.ty + h.h) * TILE_PX;
    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    return Math.hypot(dx, dy);
  }

  private restore(data: unknown): void {
    const parsed = hearthSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`hearth snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const d = parsed.data;
    const catalog = this.inventory.bags.catalog;
    const ids = new Set<number>();
    if (d.hearths.length > H.maxBases) throw new TypeError(`hearth snapshot invalid: ${d.hearths.length} hearths, at most ${H.maxBases}`);
    for (const h of d.hearths) {
      if (ids.has(h.id) || h.id >= d.nextId) throw new TypeError(`hearth snapshot invalid: hearth ids must be unique and below nextId (${h.id})`);
      ids.add(h.id);
      if (h.rest > h.voll) throw new TypeError(`hearth snapshot invalid: hearth ${h.id} has more fire left (${h.rest}) than its piece gave (${h.voll})`);
      if (storedPieces(h.vorrat) > H.storePieces) throw new TypeError(`hearth snapshot invalid: hearth ${h.id} stores more than ${H.storePieces} pieces`);
      for (const s of h.vorrat) {
        const def = catalog.find(s.item);
        if (def === undefined || H.fuelGameHours[s.item] === undefined) throw new TypeError(`hearth snapshot invalid: hearth ${h.id} stores "${s.item}", which is no hearth fuel`);
        const problem = checkStack(def, s, H.storePieces);
        if (problem !== null) throw new TypeError(`hearth snapshot invalid: hearth ${h.id}: ${problem}`);
      }
      h.kerne.forEach((k, index) => {
        if (k !== null && k !== H.coreItems[index]) throw new TypeError(`hearth snapshot invalid: hearth ${h.id} holds "${k}" in niche ${index}`);
      });
    }
    this.stateValue = copyHearthState({ hearths: d.hearths.map((h) => ({ ...h, layer: h.layer as Layer })), nextId: d.nextId });
  }
}
