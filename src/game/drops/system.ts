/**
 * Dropped items (MASTERPROMPT §11.4 "Aufheben: Kleinteile im Radius 1,5 Tiles automatisch (Magnet),
 * sonst E; volle Taschen → klarer Hinweis", §14 "fliegende Drops mit Magnet"; M3-10).
 *
 * - `spawn`: a stack pops out of a harvested object (or a full hand) and flies to a free spot 0,5–1,25
 *   tiles away on the same height level (random angle and distance from the stream `drops`; without a
 *   free spot it lands at the given fallback, e.g. the player's feet). Landing next to a drop of the same
 *   item joins its stack.
 * - Every tick: flights advance; landed drops settle, then the magnet pulls small items (everything that
 *   stacks) within its radius towards the player – only as many as the bags can take, and not while the
 *   player is dead or asleep – and collects them at the feet. A drop the bags cannot take raises `dropBlocked` once per approach. Untouched drops
 *   disappear after their lifetime.
 * - `pickUp`: E on a drop puts what fits into the bags (the rest stays lying; the inventory raises
 *   `inventoryFull`).
 * - Global (not chunk-bound): drops are entities with their own clock (flight, lifetime); nothing about
 *   them waits for a chunk to tick. Save participant `drops` (the ECS saves the entities themselves).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { isEntityHandle, SparseSet, type Entity } from '../../engine/ecs';
import { BLOCK_ALL, infoLevel } from '../../world/collision/tiles';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { EquipmentSystem } from '../equipment/system';
import type { InventorySystem } from '../inventory/system';
import { canStack, joinedStack, withCount, type ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { PlayerSystem } from '../player/system';
import type { WorldCollision } from '../player/collision';
import type { SimSystem, Simulation } from '../sim';
import { secondsToTicks } from '../gathering/formulas';
import { flightPoint, isSmallItem, landingDistancePx, landingSpot, magnetRadiusPx, magnetStep, type Point } from './formulas';
import { DROP_COMPONENT, dropStateSchema, isFlying, type DropState } from './state';

/** Id of the drop system and its save participant. */
export const DROPS_SYSTEM_ID = 'drops';
/** Data version of the `drops` participant. */
export const DROPS_SAVE_VERSION = 1;
/** Random stream of landing spots. */
export const DROPS_RNG_STREAM = 'drops';
/** Tries to find a free landing spot before the fallback is used (8 directions around the source). */
const LANDING_TRIES = 8;
const FULL_TURN = Math.PI * 2;

const D = BALANCE.interaction.drops;
const I = BALANCE.interaction;

const dropsSnapshotSchema = z
  .object({
    drops: z.array(z.object({ entity: z.number().int().refine(isEntityHandle, { message: 'must be an entity handle' }), drop: dropStateSchema }).strict()),
  })
  .strict();

/** Dependencies of the drop system (built in `createSimulation`). */
export interface DropSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  /** Worn jewellery may widen the magnet (`magnetradius`); absent in tests without equipment. */
  readonly equipment?: EquipmentSystem;
  readonly collision: WorldCollision;
}

/** Outcome of a pick-up. */
export interface PickUpResult {
  readonly added: number;
  readonly rest: number;
}

export class DropSystem implements SimSystem {
  readonly id = DROPS_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly save: SaveParticipant;
  /** The drop components (read by interaction and presentation; written only here). */
  readonly store: SparseSet<DropState>;
  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly equipment: EquipmentSystem | undefined;
  private readonly collision: WorldCollision;
  private readonly flightTicks: number;
  private readonly settleTicks: number;
  private readonly lifetimeTicks: (sim: Simulation) => number;
  private readonly spot: Point = { x: 0, y: 0 };
  private readonly playerPos: Point = { x: 0, y: 0 };
  /** Entities that left this tick (destroyed at the end of the tick). */
  private readonly gone = new Set<Entity>();
  /** Bag revision the blocked drops were last checked against (transient). */
  private checkedRevision = -1;

  constructor(sim: Simulation, deps: DropSystemDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.equipment = deps.equipment;
    this.collision = deps.collision;
    this.store = sim.ecs.registerComponent(DROP_COMPONENT, new SparseSet<DropState>());
    const hz = sim.clock.tickHz;
    this.flightTicks = secondsToTicks(D.flightSeconds, hz);
    this.settleTicks = secondsToTicks(D.settleSeconds, hz);
    this.lifetimeTicks = (s) => Math.round(D.lifetimeGameMinutes * s.clock.ticksPerGameMinute);
    this.save = {
      id: DROPS_SYSTEM_ID,
      version: DROPS_SAVE_VERSION,
      serialize: () => {
        const list: { entity: Entity; drop: DropState }[] = [];
        for (let i = 0; i < this.store.size; i++) list.push({ entity: this.store.entityAt(i), drop: { ...this.store.valueAt(i) } });
        list.sort((a, b) => a.entity - b.entity);
        return { drops: list };
      },
      deserialize: (data) => {
        const parsed = dropsSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`drops snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        const catalog = this.inventory.bags.catalog;
        for (const { drop } of parsed.data.drops) if (!catalog.has(drop.stack.item)) throw new TypeError(`drops snapshot invalid: unknown item "${drop.stack.item}"`);
        this.store.clear();
        for (const { entity, drop } of parsed.data.drops) this.store.add(entity, { ...drop, layer: drop.layer as Layer });
      },
    };
  }

  /** Number of drops in the world. */
  get count(): number {
    return this.store.size;
  }

  /** The drop of entity `e`, if it is one. */
  get(e: Entity): DropState | undefined {
    return this.store.get(e);
  }

  /**
   * A stack pops out of (fromX, fromY) on `layer` and flies to a free spot nearby (fallback: (fallbackX,
   * fallbackY), default the source). Returns the drop entity.
   */
  spawn(sim: Simulation, stack: ItemStack, layer: Layer, fromX: number, fromY: number, fallbackX = fromX, fallbackY = fromY): Entity {
    const rng = sim.rng.stream(DROPS_RNG_STREAM);
    const grid = this.collision.grid;
    const level = infoLevel(grid.tileInfo(layer, Math.floor(fromX / TILE_PX), Math.floor(fromY / TILE_PX)));
    const start = rng.next() * FULL_TURN;
    const distance = landingDistancePx(rng.next());
    let found = false;
    for (let k = 0; k < LANDING_TRIES && !found; k++) {
      landingSpot(fromX, fromY, start + (k * FULL_TURN) / LANDING_TRIES, distance, this.spot);
      const info = grid.tileInfo(layer, Math.floor(this.spot.x / TILE_PX), Math.floor(this.spot.y / TILE_PX));
      found = (info & BLOCK_ALL) === 0 && infoLevel(info) === level;
    }
    if (!found) {
      this.spot.x = fallbackX;
      this.spot.y = fallbackY;
    }
    const e = sim.ecs.create();
    const tick = sim.eventTick;
    this.store.add(e, {
      stack,
      layer,
      x: fromX,
      y: fromY,
      prevX: fromX,
      prevY: fromY,
      fromX,
      fromY,
      toX: this.spot.x,
      toY: this.spot.y,
      flightTicks: 0,
      flightTotal: this.flightTicks,
      settleTicks: this.settleTicks,
      expiresAtTick: tick + this.lifetimeTicks(sim),
      pulled: false,
      blocked: false,
    });
    sim.events.push('entitySpawned', { entity: e, tick });
    sim.events.push('dropSpawned', { entity: e, item: stack.item, count: stack.count, layer, fromX, fromY, x: this.spot.x, y: this.spot.y, tick });
    return e;
  }

  /** Puts as much of drop `e` into the bags as fits; the rest keeps lying. */
  pickUp(sim: Simulation, e: Entity, magnet = false): PickUpResult {
    const d = this.store.get(e);
    if (d === undefined || this.gone.has(e)) return { added: 0, rest: 0 };
    const result = this.inventory.giveStack(sim, d.stack);
    if (result.added > 0) sim.events.push('dropPickedUp', { entity: e, item: d.stack.item, count: result.added, x: d.x, y: d.y, magnet, tick: sim.eventTick });
    if (result.rest === 0) this.remove(sim, e);
    else {
      d.stack = withCount(d.stack, result.rest);
      d.pulled = false;
    }
    return result;
  }

  update(sim: Simulation, dt: number): void {
    this.gone.clear();
    const store = this.store;
    if (store.size === 0) return;
    const tick = sim.eventTick;
    // The magnet pulls only for a player who can act: nothing flies into the bags of a dead or sleeping body.
    const hasPlayer = this.player.position(sim, this.playerPos) && this.player.incapacity(sim) === null;
    const playerLayer = this.player.body(sim)?.layer ?? 0;
    const revision = this.inventory.bags.revision;
    const recheck = revision !== this.checkedRevision;
    this.checkedRevision = revision;
    const radius = magnetRadiusPx(this.equipment?.stats().werte.magnetradius ?? 0);
    const step = I.magnetSpeedTilesPerSecond * TILE_PX * dt;
    const collect = I.collectDistanceTiles * TILE_PX;
    const catalog = this.inventory.bags.catalog;
    for (let i = 0; i < store.size; i++) {
      const e = store.entityAt(i);
      const d = store.valueAt(i);
      if (this.gone.has(e)) continue;
      d.prevX = d.x;
      d.prevY = d.y;
      if (tick >= d.expiresAtTick) {
        sim.events.push('dropExpired', { entity: e, item: d.stack.item, count: d.stack.count, tick });
        this.remove(sim, e);
        continue;
      }
      if (isFlying(d)) {
        d.flightTicks++;
        flightPoint(d.fromX, d.fromY, d.toX, d.toY, d.flightTicks / d.flightTotal, this.spot);
        d.x = this.spot.x;
        d.y = this.spot.y;
        if (!isFlying(d)) {
          sim.events.push('dropLanded', { entity: e, item: d.stack.item, x: d.x, y: d.y, tick });
          this.mergeLanded(sim, e, d);
        }
        continue;
      }
      if (d.settleTicks > 0) {
        d.settleTicks--;
        continue;
      }
      if (!hasPlayer || d.layer !== playerLayer || !isSmallItem(catalog.get(d.stack.item))) continue;
      const dist = Math.hypot(this.playerPos.x - d.x, this.playerPos.y - d.y);
      if (dist > radius && !d.pulled) {
        d.blocked = false;
        continue;
      }
      if (!d.pulled) {
        if (d.blocked && !recheck) continue;
        if (this.inventory.roomFor(d.stack) === 0) {
          if (!d.blocked) sim.events.push('dropBlocked', { entity: e, item: d.stack.item, count: d.stack.count, tick });
          d.blocked = true;
          continue;
        }
        d.blocked = false;
        d.pulled = true;
      }
      this.spot.x = d.x;
      this.spot.y = d.y;
      const left = magnetStep(this.spot, this.playerPos.x, this.playerPos.y, step);
      d.x = this.spot.x;
      d.y = this.spot.y;
      if (left <= collect) this.pickUp(sim, e, true);
    }
  }

  /** A drop that just landed joins a resting drop of the same item within the merge radius. */
  private mergeLanded(sim: Simulation, e: Entity, d: DropState): void {
    const store = this.store;
    const r2 = (D.mergeRadiusTiles * TILE_PX) ** 2;
    const capacity = this.inventory.bags.catalog.get(d.stack.item).stapel;
    for (let j = 0; j < store.size; j++) {
      const other = store.entityAt(j);
      if (other === e || this.gone.has(other)) continue;
      const o = store.valueAt(j);
      if (isFlying(o) || o.layer !== d.layer || !canStack(o.stack, d.stack) || o.stack.count >= capacity) continue;
      if ((o.x - d.x) ** 2 + (o.y - d.y) ** 2 > r2) continue;
      const moved = Math.min(capacity - o.stack.count, d.stack.count);
      o.stack = joinedStack(o.stack, d.stack, moved);
      o.expiresAtTick = Math.max(o.expiresAtTick, d.expiresAtTick);
      if (moved === d.stack.count) {
        this.remove(sim, e);
        return;
      }
      d.stack = withCount(d.stack, d.stack.count - moved);
    }
  }

  private remove(sim: Simulation, e: Entity): void {
    this.gone.add(e);
    sim.ecs.queueDestroy(e);
  }
}
