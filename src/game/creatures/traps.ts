/**
 * Traps (MASTERPROMPT §14 "Fallen (Schlinge, Kastenfalle)"; docs/SPIEL.md §11 "Beute, Jagen, Fallen"; M6-30).
 *
 * - `trap.place {from, tx, ty}`: the trap item in bag slot `from` is set up on a free tile of open ground within
 *   `BALANCE.creatures.traps.reachTiles` of the player (`trapPlaced`). Refused: no player (`noPlayer`), dead (`dead`),
 *   an empty slot (`noItem`), an item that is no trap (`notATrap`), too far (`tooFar`), a blocked tile or another trap
 *   there (`blocked`).
 * - Catching (src/game/creatures/system.ts): a catchable creature (`fangbar`, its size up to the trap's `groesseMax`)
 *   walking onto an armed trap is caught with the trap's `chance` – once per entry of the tile (`trapSprung`); the
 *   creature is gone, the trap holds it. In a frozen chunk the trap tries at intervals drawn from `fangStunden`
 *   (src/game/creatures/population.ts) on the chunk's stock.
 * - `trap.take {trap}` (E on the trap): the trap comes back into the bags; what it caught stays as a carcass on its
 *   tile, to carve with a knife (`trapTaken`). Refused: no trap (`noTrap`), too far (`tooFar`), full bags (`bagsFull`).
 * Traps have no clock of their own (the creature system and the population drive them). Save participant `traps`
 * (version 1): every trap with its catch and its next frozen attempt.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY } from '../../engine/ecs';
import { BLOCK_ALL } from '../../world/collision/tiles';
import { CHUNK_SHIFT, TILE_PX, isLayer, layerIndex, type Layer } from '../../world/model/coords';
import type { CommandOfType, GameCommandType } from '../commands';
import { isValidRef, slotAt, withSlot } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import { newStack, withCount } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import { contentCreatureCatalog, type CreatureCatalog } from './catalog';
import type { CreatureRejectReason } from './events';
import type { FrozenTrap } from './population';
import type { CreatureSystem, CreatureTrapHost } from './system';

/** Id of the trap system and its save participant. */
export const TRAPS_SYSTEM_ID = 'traps';
/** Data version of the `traps` participant. */
export const TRAPS_SAVE_VERSION = 1;

const REACH_PX = BALANCE.creatures.traps.reachTiles * TILE_PX;
/** Tiles per row of a tile key (worlds have at most 2048 tiles per edge, §9.1). */
const KEY_ROW = 4096;

/** A trap set up in the world. */
export interface TrapState extends FrozenTrap {
  readonly id: number;
  /** The trap item (content `traps`). */
  readonly item: string;
  readonly layer: Layer;
  readonly tx: number;
  readonly ty: number;
  readonly placedTick: number;
  /** The creature it holds, or `null` (armed). */
  caught: string | null;
  /** Tick it caught it, −1 none. */
  caughtTick: number;
  /** Next attempt while its chunk is frozen [tick], −1 none. */
  catchTick: number;
}

const safeInt = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const trapsSnapshotSchema = z
  .object({
    nextId: safeInt.positive(),
    traps: z.array(
      z
        .object({
          id: safeInt.positive(),
          item: z.string().min(1),
          layer: z.number().int().refine(isLayer, { message: 'unknown layer' }),
          tx: safeInt.min(0),
          ty: safeInt.min(0),
          placedTick: safeInt.min(0),
          caught: z.string().min(1).nullable(),
          caughtTick: safeInt.min(-1),
          catchTick: safeInt.min(-1),
        })
        .strict(),
    ),
  })
  .strict();

/** Map key of a tile. */
function tileKey(layer: Layer, tx: number, ty: number): number {
  return (layerIndex(layer) * KEY_ROW + ty) * KEY_ROW + tx;
}

/** Dependencies of the trap system. */
export interface TrapSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly collision: WorldCollision;
  /** The creatures: a caught animal taken out of a trap is left as their carcass. */
  readonly creatures: Pick<CreatureSystem, 'leaveCarcass'>;
  /** Default: the content's. */
  readonly catalog?: CreatureCatalog;
}

/** The trap system (see module comment). */
export class TrapSystem implements SimSystem, CreatureTrapHost {
  readonly id = TRAPS_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly collision: WorldCollision;
  private readonly creatures: Pick<CreatureSystem, 'leaveCarcass'>;
  private readonly catalog: CreatureCatalog;
  /** Traps by ascending id. */
  private readonly list: TrapState[] = [];
  private readonly byTile = new Map<number, TrapState>();
  private nextId = 1;
  private readonly at = { x: 0, y: 0 };

  constructor(deps: TrapSystemDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.collision = deps.collision;
    this.creatures = deps.creatures;
    this.catalog = deps.catalog ?? contentCreatureCatalog();
    this.commands = {
      'trap.place': (s, cmd, tick) => this.handlePlace(s, cmd, tick),
      'trap.take': (s, cmd, tick) => this.handleTake(s, cmd, tick),
    };
    this.save = {
      id: TRAPS_SYSTEM_ID,
      version: TRAPS_SAVE_VERSION,
      // A save from before M6 has no traps.
      migrations: [{ from: 0, migrate: () => ({ nextId: 1, traps: [] }) }],
      serialize: () => ({ nextId: this.nextId, traps: this.list.map((t) => ({ ...t })) }),
      deserialize: (data) => this.restore(data),
    };
  }

  /** Every trap, by ascending id (read-only for callers: presentation, tests). */
  get traps(): readonly Readonly<TrapState>[] {
    return this.list;
  }

  /** The trap `id`, or `undefined`. */
  trap(id: number): Readonly<TrapState> | undefined {
    return this.list.find((t) => t.id === id);
  }

  /** The trap on tile (tx, ty) of `layer`, or `undefined`. */
  trapAt(layer: Layer, tx: number, ty: number): Readonly<TrapState> | undefined {
    return this.byTile.get(tileKey(layer, tx, ty));
  }

  /** Whether the bags have room for trap `id`'s item (E's hint: take it, or the bags are full). */
  roomFor(id: number): boolean {
    const t = this.trap(id);
    return t !== undefined && this.inventory.roomFor(newStack(this.inventory.bags.catalog.get(t.item), 1)) >= 1;
  }

  // CreatureTrapHost -----------------------------------------------------------------------------

  armedAt(layer: Layer, tx: number, ty: number): { readonly id: number; readonly item: string } | null {
    const t = this.byTile.get(tileKey(layer, tx, ty));
    return t === undefined || t.caught !== null ? null : t;
  }

  spring(sim: Simulation, id: number, creature: string, tick: number): void {
    const t = this.list.find((x) => x.id === id);
    if (t === undefined || t.caught !== null) return;
    t.caught = creature;
    t.caughtTick = tick;
    t.catchTick = -1;
    sim.events.push('trapSprung', { trap: t.id, item: t.item, creature, layer: t.layer, tx: t.tx, ty: t.ty, tick });
  }

  armedIn(layer: Layer, cx: number, cy: number, out: FrozenTrap[]): FrozenTrap[] {
    out.length = 0;
    for (const t of this.list) if (t.caught === null && t.layer === layer && t.tx >> CHUNK_SHIFT === cx && t.ty >> CHUNK_SHIFT === cy) out.push(t);
    return out;
  }

  caught(trap: FrozenTrap, creature: string, tick: number): void {
    const t = trap as TrapState;
    t.caught = creature;
    t.caughtTick = tick;
    t.catchTick = -1;
  }

  // Commands ---------------------------------------------------------------------------------------

  private reject(sim: Simulation, type: GameCommandType, reason: CreatureRejectReason, tick: number): void {
    sim.events.push('commandRejected', { type, reason, tick });
  }

  /** The player's layer when it can act, else the reason it cannot. */
  private actor(sim: Simulation): Layer | CreatureRejectReason {
    if (sim.player === NULL_ENTITY) return 'noPlayer';
    const body = this.player.body(sim);
    const v = this.player.vitalsOf(sim.player);
    if (body === undefined || v === undefined || !this.player.position(sim, this.at)) return 'noPlayer';
    if (v.health <= 0) return 'dead';
    return body.layer;
  }

  private inReach(tx: number, ty: number): boolean {
    const dx = (tx + 1 / 2) * TILE_PX - this.at.x;
    const dy = (ty + 1 / 2) * TILE_PX - this.at.y;
    return dx * dx + dy * dy <= REACH_PX * REACH_PX;
  }

  private handlePlace(sim: Simulation, cmd: CommandOfType<'trap.place'>, tick: number): void {
    const layer = this.actor(sim);
    if (typeof layer === 'string') {
      this.reject(sim, cmd.type, layer, tick);
      return;
    }
    const state = this.inventory.state;
    const slot = isValidRef(state, cmd.from) ? slotAt(state, cmd.from) : null;
    if (slot === null) {
      this.reject(sim, cmd.type, 'noItem', tick);
      return;
    }
    if (this.catalog.trap(slot.item) === undefined) {
      this.reject(sim, cmd.type, 'notATrap', tick);
      return;
    }
    if (!this.inReach(cmd.tx, cmd.ty)) {
      this.reject(sim, cmd.type, 'tooFar', tick);
      return;
    }
    const grid = this.collision.grid;
    grid.beginQuery();
    if ((grid.info(layer, cmd.tx, cmd.ty) & BLOCK_ALL) !== 0 || this.byTile.has(tileKey(layer, cmd.tx, cmd.ty))) {
      this.reject(sim, cmd.type, 'blocked', tick);
      return;
    }
    this.inventory.bags.replace(withSlot(state, cmd.from, slot.count > 1 ? withCount(slot, slot.count - 1) : null));
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    const t: TrapState = { id: this.nextId++, item: slot.item, layer, tx: cmd.tx, ty: cmd.ty, placedTick: tick, caught: null, caughtTick: -1, catchTick: -1 };
    this.list.push(t);
    this.byTile.set(tileKey(layer, t.tx, t.ty), t);
    sim.events.push('trapPlaced', { trap: t.id, item: t.item, layer, tx: t.tx, ty: t.ty, tick });
  }

  private handleTake(sim: Simulation, cmd: CommandOfType<'trap.take'>, tick: number): void {
    const layer = this.actor(sim);
    if (typeof layer === 'string') {
      this.reject(sim, cmd.type, layer, tick);
      return;
    }
    const i = this.list.findIndex((x) => x.id === cmd.trap);
    const t = this.list[i];
    if (t === undefined || t.layer !== layer) {
      this.reject(sim, cmd.type, 'noTrap', tick);
      return;
    }
    if (!this.inReach(t.tx, t.ty)) {
      this.reject(sim, cmd.type, 'tooFar', tick);
      return;
    }
    if (!this.roomFor(t.id)) {
      this.reject(sim, cmd.type, 'bagsFull', tick);
      return;
    }
    this.inventory.give(sim, t.item, 1);
    if (t.caught !== null) {
      const kind = this.catalog.find(t.caught);
      if (kind?.carcass === true) this.creatures.leaveCarcass(sim, t.caught, t.layer, (t.tx + 1 / 2) * TILE_PX, (t.ty + 1 / 2) * TILE_PX, Math.PI / 2, kind.def.stufe);
    }
    this.list.splice(i, 1);
    this.byTile.delete(tileKey(t.layer, t.tx, t.ty));
    sim.events.push('trapTaken', { trap: t.id, item: t.item, caught: t.caught, layer: t.layer, tx: t.tx, ty: t.ty, tick });
  }

  // Saving -----------------------------------------------------------------------------------------

  private restore(data: unknown): void {
    const parsed = trapsSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`traps snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const d = parsed.data;
    const seen = new Set<number>();
    let last = 0;
    for (const t of d.traps) {
      if (this.catalog.trap(t.item) === undefined) throw new TypeError(`traps snapshot invalid: "${t.item}" is no trap`);
      if (t.caught !== null && !this.catalog.has(t.caught)) throw new TypeError(`traps snapshot invalid: unknown creature "${t.caught}"`);
      if (t.id <= last || t.id >= d.nextId) throw new TypeError('traps snapshot invalid: ids must ascend below nextId');
      last = t.id;
      const key = tileKey(t.layer as Layer, t.tx, t.ty);
      if (seen.has(key)) throw new TypeError(`traps snapshot invalid: two traps on tile ${t.layer}:${t.tx}:${t.ty}`);
      seen.add(key);
    }
    this.list.length = 0;
    this.byTile.clear();
    for (const raw of d.traps) {
      const t: TrapState = { ...raw, layer: raw.layer as Layer };
      this.list.push(t);
      this.byTile.set(tileKey(t.layer, t.tx, t.ty), t);
    }
    this.nextId = d.nextId;
  }
}
