/**
 * Fast travel (MASTERPROMPT §25 "Schnellreise zwischen entzündeten Leuchtfeuern, Herdfeuern und Wegsteinen (Lumen-Kosten
 * nach Distanz). Option „Logistik-Realismus“: Erze und Barren nicht teleportierbar"; docs/SPIEL.md §22 "Schnellreise";
 * strand F, system `travel`, M7-37).
 *
 * - **Travel points**: the lit beacons (`leuchtfeuer:<n>`, their site), the burning hearth fires (`herdfeuer:<id>`, the
 *   hearth system's `travelTargets`) and the waystones (`wegstein:<n>`: the part `wegstein` of the build grid, heard through
 *   a part listener and kept here with their names – the only travel state of their own).
 * - **E at a point** (`travel.open`, within `BALANCE.travel.reachTiles` of its centre) opens the travel screen
 *   (`travelOpened`); `travel.go { ziel }` takes ⌈distance / `tilesPerLumen`⌉ Lumen shards (at least one) and puts the player
 *   on a free tile in front of the destination (`travelled`).
 * - **Refused** (`commandRejected`): away from a point, to an unknown or the same point, without enough Lumen, within
 *   `combatLockSeconds` of a blow given or taken, while a boss is awake, and – with the world setting "Logistik-Realismus"
 *   (`useLogistics`) – with ores or bars in the bags (`cargoNotTeleportable`).
 * - `travel.rename { wegstein, name }` names a waystone (trimmed, at most `nameMaxLength` characters).
 *
 * Global (`timeScope`): no tick hooks; the points of the other systems are read when asked. Save participant `travel`
 * (version 1): the waystones.
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { ItemDef } from '../../content/schema/item';
import { NULL_ENTITY } from '../../engine/ecs';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { PartDef } from '../../world/structures/catalog';
import type { BeaconsApi } from '../beacons/types';
import type { BeaconSite } from '../beacons/sites';
import type { BossesApi } from '../bosses/types';
import type { PartListener } from '../building/system';
import type { CommandOfType } from '../commands';
import type { InventorySystem } from '../inventory/system';
import { CARRY_AREAS } from '../items/slots';
import type { SaveParticipant } from '../participant';
import { findFreeTile, SPAWN_SEARCH_RADIUS, type FreeTile } from '../player/cliffs';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { TravelRejectReason } from './events';
import { cargoItems, travelCost, waystoneName } from './formulas';
import { copyTravelState, createTravelState, travelSnapshotSchema, type TravelSnapshot, type TravelState } from './state';
import type { TravelApi, TravelPoint, TravelPointKind, TravelSample } from './types';

/** Id of the travel system and its save participant. */
export const TRAVEL_SYSTEM_ID = 'travel';
/** Data version of the `travel` participant. */
export const TRAVEL_SAVE_VERSION = 1;
/** The build part that is a waystone (src/content/items/leuchtfeuer.ts). */
export const WAYSTONE_PART = 'wegstein';

const T = BALANCE.travel;
const COMBAT_LOCK_TICKS = Math.round(T.combatLockSeconds * BALANCE.time.tickHz);
/**
 * Half the footprint a point's reach is measured beyond [tiles]: the beacon stands 3 × 3, a hearth 2 × 2 – E from a
 * neighbouring tile of its rim must reach it like E at a waystone.
 */
const FOOTPRINT_HALF = 1;

/** A burning hearth as a travel target (the hearth system's `travelTargets`). */
export interface HearthTravelTarget {
  readonly hearth: number;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
}

/** What the travel system reads of the beacons. */
export interface TravelBeacons extends Pick<BeaconsApi, 'state'> {
  readonly defs: readonly unknown[];
  site(sim: Simulation, nummer: number): BeaconSite | null;
}

/** Dependencies of the travel system. */
export interface TravelSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: Pick<InventorySystem, 'count' | 'take' | 'state'>;
  readonly collision: WorldCollision;
  /** The fight's record of the player's last blow given or taken. */
  readonly combat: { readonly state: { readonly player: { readonly lastFightTick: number } } };
  readonly bosses: Pick<BossesApi, 'awake'>;
  readonly beacons: TravelBeacons;
  /** The burning hearths (the hearth system's `travelTargets`). */
  readonly hearths: (sim: Simulation) => readonly HearthTravelTarget[];
  /** Puts the player at world px (x, y) on `layer` (the player system's teleport). */
  readonly teleport: (sim: Simulation, x: number, y: number, layer: Layer) => void;
}

/** What the travel system reads of the player's life (bound after `addPlayerLifeSystems`). */
export interface TravelLife {
  dead(): boolean;
}

/** A point of the held list (mutable inside the system, read only outside). */
interface PointRecord {
  id: string;
  kind: TravelPointKind;
  name: string;
  layer: Layer;
  tx: number;
  ty: number;
}

export class TravelSystem implements SimSystem, TravelApi {
  readonly id = TRAVEL_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private readonly deps: TravelSystemDeps;
  private stateValue: TravelState = createTravelState();
  private life: TravelLife | null = null;
  private logistics: () => boolean = () => false;
  /** Items logistics realism keeps back (ores and bars of the content). */
  private readonly cargo: ReadonlySet<string>;
  /** The held point list (`points`): records reused from call to call. */
  private readonly pool: PointRecord[] = [];
  private readonly list: PointRecord[] = [];
  private readonly pos = { x: 0, y: 0 };
  private readonly free: FreeTile = { tx: 0, ty: 0, level: 0 };

  constructor(deps: TravelSystemDeps) {
    this.deps = deps;
    this.cargo = cargoItems(CONTENT.collection('items').values() as Iterable<ItemDef>, CONTENT.collection('ores').values());
    this.commands = {
      'travel.open': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.open(s)),
      'travel.go': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.go(s, cmd.ziel, tick)),
      'travel.rename': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.rename(s, cmd, tick)),
    };
    this.save = {
      id: TRAVEL_SYSTEM_ID,
      version: TRAVEL_SAVE_VERSION,
      // Saves before M7 know no waystones.
      migrations: [{ from: 0, migrate: (): TravelSnapshot => createTravelState() }],
      serialize: (): TravelSnapshot => copyTravelState(this.stateValue),
      deserialize: (data) => {
        const parsed = travelSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`travel snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        this.stateValue = copyTravelState(parsed.data);
      },
    };
  }

  // -------------------------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------------------------

  /** Binds the player's life (a dead player travels nowhere). */
  useLife(life: TravelLife): void {
    this.life = life;
  }

  /** Binds the world setting "Logistik-Realismus" (`WorldSettingsApi.logisticsRealism`). */
  useLogistics(enabled: () => boolean): void {
    this.logistics = enabled;
  }

  /** The waystones of the build grid: placed ones become travel points, torn down ones leave the list. */
  partListener(): PartListener {
    return {
      placed: (_s, part: PartDef, layer, tx, ty) => {
        if (part.id !== WAYSTONE_PART) return;
        const s = this.stateValue;
        if (s.waystones.some((w) => w.layer === layer && w.tx === tx && w.ty === ty)) return;
        s.waystones.push({ id: s.nextWaystone++, layer, tx, ty, name: '' });
      },
      removed: (_s, part: PartDef, layer, tx, ty) => {
        if (part.id !== WAYSTONE_PART) return;
        const list = this.stateValue.waystones;
        const i = list.findIndex((w) => w.layer === layer && w.tx === tx && w.ty === ty);
        if (i >= 0) list.splice(i, 1);
      },
    };
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  /** The travel state (read only: the waystones and their names). */
  get state(): Readonly<TravelState> {
    return this.stateValue;
  }

  cost(from: TravelPoint, to: TravelPoint): number {
    return travelCost(to.tx - from.tx, to.ty - from.ty);
  }

  /**
   * Every travel point now: lit beacons, burning hearths, waystones (in that order). The list and its records are held
   * by the system and valid until the next call.
   */
  points(sim: Simulation): readonly TravelPoint[] {
    const list = this.list;
    list.length = 0;
    const b = this.deps.beacons;
    for (let n = 1; n <= b.defs.length; n++) {
      if (b.state(n).state !== 'entzuendet') continue;
      const site = b.site(sim, n);
      if (site !== null) this.push('leuchtfeuer', n, '', site.layer, site.tx, site.ty);
    }
    for (const h of this.deps.hearths(sim)) this.push('herdfeuer', h.hearth, '', h.layer as Layer, Math.floor(h.x / TILE_PX), Math.floor(h.y / TILE_PX));
    for (const w of this.stateValue.waystones) this.push('wegstein', w.id, w.name, w.layer as Layer, w.tx, w.ty);
    return list;
  }

  /** The travel point the player stands at (within reach of its centre), or null. */
  pointAtPlayer(sim: Simulation): TravelPoint | null {
    const body = this.deps.player.body(sim);
    if (body === undefined || !this.deps.player.position(sim, this.pos)) return null;
    const reach = T.reachTiles + FOOTPRINT_HALF;
    let best: TravelPoint | null = null;
    let bestD = reach * reach;
    for (const p of this.points(sim)) {
      if (p.layer !== body.layer) continue;
      const dx = this.pos.x / TILE_PX - (p.tx + 1 / 2);
      const dy = this.pos.y / TILE_PX - (p.ty + 1 / 2);
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD) {
        bestD = d2;
        best = p;
      }
    }
    return best;
  }

  /** Why no trip can start now whatever the destination (boss, fight, cargo), or null. */
  blocked(sim: Simulation): TravelRejectReason | null {
    if (this.deps.bosses.awake() !== null) return 'bossAwake';
    const last = this.deps.combat.state.player.lastFightTick;
    if (last >= 0 && sim.tick - last <= COMBAT_LOCK_TICKS) return 'inFight';
    if (this.logistics() && this.carriesCargo()) return 'cargoNotTeleportable';
    return null;
  }

  /**
   * Fills `out` for the travel screen: the point the player stands at, every other point with its price, and what blocks
   * travel now. Reuses `out`'s arrays.
   */
  sample(sim: Simulation, out: TravelSample): TravelSample {
    const from = this.pointAtPlayer(sim);
    out.from = from?.id ?? '';
    out.fromName = from?.name ?? '';
    out.blocked = from === null ? 'notAtPoint' : this.blocked(sim);
    out.points.length = 0;
    out.costs.length = 0;
    if (from === null) return out;
    for (const p of this.list) {
      if (p.id === from.id) continue;
      out.points.push({ id: p.id, kind: p.kind, name: p.name, layer: p.layer, tx: p.tx, ty: p.ty });
      out.costs.push(this.cost(from, p));
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------------

  private open(sim: Simulation): TravelRejectReason | 'noPlayer' | 'dead' | null {
    if (sim.player === NULL_ENTITY || this.deps.player.body(sim) === undefined) return 'noPlayer';
    if (this.life?.dead() === true) return 'dead';
    const from = this.pointAtPlayer(sim);
    if (from === null) return 'notAtPoint';
    sim.events.push('travelOpened', { von: from.id, kind: from.kind, tick: sim.eventTick });
    return null;
  }

  private go(sim: Simulation, ziel: string, tick: number): TravelRejectReason | 'noPlayer' | 'dead' | 'noFreeTile' | null {
    if (sim.player === NULL_ENTITY || this.deps.player.body(sim) === undefined) return 'noPlayer';
    if (this.life?.dead() === true) return 'dead';
    const from = this.pointAtPlayer(sim);
    if (from === null) return 'notAtPoint';
    const fromId = from.id;
    const to = this.list.find((p) => p.id === ziel);
    if (to === undefined) return 'unknownPoint';
    if (to.id === fromId) return 'samePoint';
    const block = this.blocked(sim);
    if (block !== null) return block;
    const cost = this.cost(from, to);
    if (this.deps.inventory.count(T.currency) < cost) return 'notEnoughLumen';
    const c = this.deps.collision;
    const ax = to.tx;
    const ay = to.ty + T.arrivalOffsetTiles;
    c.ensureTiles(to.layer, ax - SPAWN_SEARCH_RADIUS - 1, ay - SPAWN_SEARCH_RADIUS - 1, ax + SPAWN_SEARCH_RADIUS + 1, ay + SPAWN_SEARCH_RADIUS + 1);
    if (!findFreeTile(c.grid, to.layer, ax, ay, SPAWN_SEARCH_RADIUS, this.free)) return 'noFreeTile';
    if (this.deps.inventory.take(sim, T.currency, cost) === null) return 'notEnoughLumen';
    const x = (this.free.tx + 1 / 2) * TILE_PX;
    const y = (this.free.ty + 1 / 2) * TILE_PX;
    const nach = to.id;
    const kind = to.kind;
    const layer = to.layer;
    this.deps.teleport(sim, x, y, layer);
    sim.events.push('travelled', { von: fromId, nach, kind, kosten: cost, x, y, layer, tick });
    return null;
  }

  private rename(sim: Simulation, cmd: CommandOfType<'travel.rename'>, tick: number): TravelRejectReason | null {
    const w = this.stateValue.waystones.find((x) => x.id === cmd.wegstein);
    if (w === undefined) return 'unknownWaystone';
    const name = waystoneName(cmd.name);
    if (name === null) return 'nameInvalid';
    w.name = name;
    sim.events.push('travelPointRenamed', { wegstein: w.id, name, tick });
    return null;
  }

  private refuse(sim: Simulation, type: 'travel.open' | 'travel.go' | 'travel.rename', tick: number, reason: TravelRejectReason | 'noPlayer' | 'dead' | 'noFreeTile' | null): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  // -------------------------------------------------------------------------------------------

  private push(kind: TravelPointKind, n: number, name: string, layer: Layer, tx: number, ty: number): void {
    const i = this.list.length;
    let r = this.pool[i];
    if (r === undefined) {
      r = { id: '', kind, name, layer, tx, ty };
      this.pool.push(r);
    }
    r.id = `${kind}:${n}`;
    r.kind = kind;
    r.name = name;
    r.layer = layer;
    r.tx = tx;
    r.ty = ty;
    this.list.push(r);
  }

  /** Whether the carried bags hold an ore or a bar (logistics realism). */
  private carriesCargo(): boolean {
    const s = this.deps.inventory.state;
    for (const area of CARRY_AREAS) for (const slot of s[area]) if (slot !== null && this.cargo.has(slot.item)) return true;
    return false;
  }
}
