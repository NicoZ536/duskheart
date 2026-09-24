/**
 * Actions of the player (MASTERPROMPT §11.4 "Aktionen", §18; M3-25): eating and drinking (interruptible),
 * drinking from rivers, lakes and springs, sitting on seats, throwing.
 *
 * - **Eating** (`action.eat`, `action.useBelt` for key Q): one piece of a consumable takes 1–2,5 s; the
 *   player may walk on at half speed. A hit, a roll, sprinting, deep water, a jump, falling asleep, death
 *   or `action.cancel` interrupt it – nothing is eaten. At the end the piece leaves its slot: satiety and
 *   thirst change by its nutrition at its freshness, raw or rotten food frightens (+5), rotten food may
 *   poison (Lebensmittelvergiftung).
 * - **Drinking** (`action.drink`): a sip from the water on a tile in reach: 20 thirst; unfiltered river
 *   and lake water may bring a fever (10 %, Nebelmoor 50 %); the sea and ice are refused. A swimmer may
 *   drink the water it swims in (eating is refused in deep water, and deep water interrupts it).
 * - **Sitting** (`action.sit`, `action.stand`): on a seat reported by a seat provider (tree stumps of
 *   the felling system, chairs of the building system). The player sits still; at a fire sitting counts
 *   as resting (health regeneration ×2, §11.1). A movement key, a roll, a hit, sleep or death end it.
 * - **Throwing** (`action.throw`): one piece of a slot flies (an ECS entity with a position) towards the
 *   aimed point – at most 8 tiles, stopped by rocks, trees and walls – and lands there as a dropped item
 *   (`ThrowLanding`: the drop system); in deep water it sinks.
 * Hits are recognised in the running tick (`PlayerHarm`): the systems that deal them run before this one.
 * Global. Save participant `actions`.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import type { ConsumableCategory } from '../../content/balance/actions';
import { NULL_ENTITY, isEntityHandle, type Entity } from '../../engine/ecs';
import { BLOCK_DEEP_WATER, PROJECTILE_RULES } from '../../world/collision/tiles';
import { createSweepHit, sweepCircle } from '../../world/collision/sweep';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import type { CommandOfType, GameCommandType } from '../commands';
import type { ConditionsSystem } from '../conditions/system';
import type { PlayerHarm } from '../conditions/harm';
import type { FearSystem } from '../fear/system';
import { isValidRef, slotAt } from '../inventory/bags';
import { discard, removeItems } from '../inventory/ops';
import type { InventorySystem } from '../inventory/system';
import type { InventoryRejectReason } from '../inventory/events';
import type { ItemStack } from '../items/stack';
import type { SlotRef } from '../items/slots';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import type { PlayerComponents } from '../player/components';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { SleepSystem } from '../sleep/system';
import { STAT_MAX, clampStat } from '../survival/formulas';
import type { PlayerModifierSource } from '../survival/modifiers';
import type { MotionSystem } from '../systems/motion';
import type { ActionInterruption, ActionRejectReason } from './events';
import { THROW_MAX_PX, consumeTicks, dishComfort, drinkable, eatenNutrition, eatingFright, feverChance, foodPoisonChance, freshnessStage, isRawFood, sipTicks, throwFlightTicks, waterSource, type Nutrition } from './formulas';
import { actionsStateSchema, copyActionsState, type ActionsState, type Consumption, type Seat, type Throw } from './state';

/** Id of the actions system and its save participant. */
export const ACTIONS_SYSTEM_ID = 'actions';
/** Data version of the `actions` participant. */
export const ACTIONS_SAVE_VERSION = 1;
/** Random stream of the actions' chances (fever, food poisoning). */
export const ACTIONS_RNG_STREAM = 'actions';

const A = BALANCE.actions;
const REACH_PX = A.reachTiles * TILE_PX;
/** Radius of a thrown piece against rocks and trees [px] (a stone in the hand, not a point). */
const THROW_RADIUS_PX = 2;
/** Areas a piece can be thrown from: the carried bags (not worn equipment or the backpack slot). */
const THROWABLE_AREAS: ReadonlySet<string> = new Set(['inventar', 'schnellleiste', 'rucksackfach', 'guertel']);

const actionsSnapshotSchema = z
  .object({
    entity: z.number().int().refine((e) => e === NULL_ENTITY || isEntityHandle(e), { message: 'must be an entity handle or -1' }),
    actions: actionsStateSchema,
  })
  .strict();

/** A seat on tile (tx, ty) of `layer`, or `null` (tree stumps, chairs). */
export type SeatProvider = (sim: Simulation, layer: Layer, tx: number, ty: number) => Seat | null;
/** Puts a landed throw into the world as a dropped item (the drop system). */
export type ThrowLanding = (sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number) => void;

/** Dependencies of the actions system. */
export interface ActionsSystemDeps {
  readonly components: PlayerComponents;
  readonly motion: MotionSystem;
  readonly collision: WorldCollision;
  readonly inventory: InventorySystem;
  readonly conditions: ConditionsSystem;
  readonly fear: FearSystem;
  readonly sleep: SleepSystem;
  readonly harm: PlayerHarm;
  readonly landing: ThrowLanding;
}

/** Why an action command was refused. */
type Refusal = ActionRejectReason | InventoryRejectReason | 'noPlayer' | 'busy';

export class ActionsSystem implements SimSystem {
  readonly id = ACTIONS_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private readonly components: PlayerComponents;
  private readonly motion: MotionSystem;
  private readonly collision: WorldCollision;
  private readonly inventory: InventorySystem;
  private readonly conditions: ConditionsSystem;
  private readonly fear: FearSystem;
  private readonly sleep: SleepSystem;
  private readonly harm: PlayerHarm;
  private readonly landing: ThrowLanding;
  private readonly seats: SeatProvider[] = [];
  private owner: Entity = NULL_ENTITY;
  private stateValue: ActionsState = { consumption: null, seat: null, throws: [] };
  private readonly pos = { x: 0, y: 0 };
  private readonly nutrition: Nutrition = { satiety: 0, thirst: 0 };
  private readonly sweep = createSweepHit();

  constructor(deps: ActionsSystemDeps) {
    this.components = deps.components;
    this.motion = deps.motion;
    this.collision = deps.collision;
    this.inventory = deps.inventory;
    this.conditions = deps.conditions;
    this.fear = deps.fear;
    this.sleep = deps.sleep;
    this.harm = deps.harm;
    this.landing = deps.landing;
    this.commands = {
      'action.eat': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.startEating(sim, cmd.from, tick)),
      'action.useBelt': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.useBelt(sim, cmd.index, tick)),
      'action.drink': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.startDrinking(sim, cmd, tick)),
      'action.sit': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.sit(sim, cmd, tick)),
      'action.stand': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.stateValue.seat === null ? 'idle' : this.stand(sim, null)),
      'action.throw': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.throwItem(sim, cmd, tick)),
      'action.cancel': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.cancel(sim)),
    };
    this.save = {
      id: ACTIONS_SYSTEM_ID,
      version: ACTIONS_SAVE_VERSION,
      serialize: () => ({ entity: this.owner, actions: copyActionsState(this.stateValue) }),
      deserialize: (data) => {
        const parsed = actionsSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`actions snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        const { entity, actions } = parsed.data;
        const c = actions.consumption;
        if (c !== null && (c.kind === 'essen') !== (c.item !== null && c.from !== null && c.water === null)) throw new TypeError('actions snapshot invalid: eating needs an item and a slot, drinking a water source');
        if (entity === NULL_ENTITY && (c !== null || actions.seat !== null)) throw new TypeError('actions snapshot invalid: an action without a player');
        this.owner = entity;
        this.stateValue = copyActionsState(actions as ActionsState);
      },
    };
  }

  /** What the player does (read-only for callers). */
  get state(): Readonly<ActionsState> {
    return this.stateValue;
  }

  /** Adds a provider of seats (tree stumps, chairs). */
  addSeats(provider: SeatProvider): void {
    this.seats.push(provider);
  }

  /** Stops eating or drinking because of `reason` (other systems: a stun, a knock-back). Returns whether something stopped. */
  interrupt(sim: Simulation, reason: ActionInterruption): boolean {
    const c = this.stateValue.consumption;
    if (c === null) return false;
    this.stateValue.consumption = null;
    sim.events.push('activityInterrupted', { entity: this.owner, action: c.kind, item: c.item, reason, tick: sim.eventTick });
    return true;
  }

  /** Modifier source: half speed while eating or drinking; sitting still, resting at a fire. */
  modifierSource(): PlayerModifierSource {
    return (_sim, player, out) => {
      const s = this.stateValue;
      if (s.consumption !== null) out.moveSpeedFactor *= A.busyMoveFactor;
      if (s.seat !== null) {
        out.moveSpeedFactor = 0;
        const v = this.components.vitals.get(player);
        if (v !== undefined && v.heatC > 0) out.resting = true;
      }
    };
  }

  update(sim: Simulation): void {
    this.flights(sim);
    const e = this.playerOf(sim);
    if (e === NULL_ENTITY) return;
    const v = this.components.vitals.get(e);
    const body = this.components.body.get(e);
    if (v === undefined || body === undefined) return;
    const s = this.stateValue;
    if (s.seat === null && s.consumption === null) return;
    const hit = this.harm.hitThisTick(sim);
    if (s.seat !== null) {
      if (v.health <= 0) this.stand(sim, 'tod');
      else if (this.sleep.asleep) this.stand(sim, 'schlaf');
      else if (hit) this.stand(sim, 'treffer');
      else if (body.inputX !== 0 || body.inputY !== 0 || body.rollTicks > 0 || body.transit !== 'none' || body.swimming) this.stand(sim, null);
    }
    const c = s.consumption;
    if (c === null) return;
    let reason: ActionInterruption | null = null;
    if (v.health <= 0) reason = 'tod';
    else if (this.sleep.asleep) reason = 'schlaf';
    else if (hit) reason = 'treffer';
    else if (body.rollTicks > 0) reason = 'rolle';
    else if (body.state === 'sprint') reason = 'sprint';
    else if (body.swimming && c.kind === 'essen') reason = 'wasser';
    else if (body.transit !== 'none') reason = 'sprung';
    else if (c.item !== null && !this.holds(c.item, c.from)) reason = 'weg';
    if (reason !== null) {
      this.interrupt(sim, reason);
      return;
    }
    c.ticksLeft--;
    if (c.ticksLeft > 0) return;
    s.consumption = null;
    if (c.kind === 'essen') this.finishEating(sim, e, c);
    else this.finishDrinking(sim, e, c);
  }

  // -------------------------------------------------------------------------------------------
  // Eating and drinking
  // -------------------------------------------------------------------------------------------

  /**
   * Why the player cannot begin an action now, or `null`. A swimmer does nothing but swim – except drink:
   * `inWater` allows it (a sip of the fresh water the player swims in).
   */
  private blocked(e: Entity, inWater = false): Refusal | null {
    if (e === NULL_ENTITY) return 'noPlayer';
    const v = this.components.vitals.get(e);
    const body = this.components.body.get(e);
    if (v === undefined || body === undefined) return 'noPlayer';
    if (v.health <= 0) return 'dead';
    if (this.sleep.asleep) return 'asleep';
    if (this.stateValue.consumption !== null || body.rollTicks > 0 || body.transit !== 'none' || (body.swimming && !inWater)) return 'busy';
    return null;
  }

  private startEating(sim: Simulation, from: SlotRef, tick: number): Refusal | null {
    const e = this.playerOf(sim);
    const no = this.blocked(e);
    if (no !== null) return no;
    const bags = this.inventory.state;
    if (!isValidRef(bags, from)) return 'invalidSlot';
    const stack = slotAt(bags, from);
    if (stack === null) return 'slotEmpty';
    const def = this.inventory.bags.catalog.get(stack.item);
    if (def.essbar === undefined) return 'notEdible';
    const ticks = consumeTicks(def.kategorie as ConsumableCategory);
    this.stateValue.consumption = { kind: 'essen', item: stack.item, from: { bereich: from.bereich, index: from.index }, water: null, biome: null, ticksLeft: ticks, totalTicks: ticks };
    sim.events.push('activityStarted', { entity: e, action: 'essen', item: stack.item, ticks, tick });
    return null;
  }

  private useBelt(sim: Simulation, index: number | undefined, tick: number): Refusal | null {
    const belt = this.inventory.state.guertel;
    const at = index ?? belt.findIndex((s) => s !== null);
    if (at < 0) return 'slotEmpty';
    return this.startEating(sim, { bereich: 'guertel', index: at }, tick);
  }

  private startDrinking(sim: Simulation, cmd: CommandOfType<'action.drink'>, tick: number): Refusal | null {
    const e = this.playerOf(sim);
    const no = this.blocked(e, true);
    if (no !== null) return no;
    const body = this.components.body.get(e);
    if (body === undefined || !this.position(e)) return 'noPlayer';
    if (!this.inReach(cmd.tx, cmd.ty)) return 'outOfReach';
    const layer = body.layer;
    this.collision.ensureTiles(layer, cmd.tx, cmd.ty, cmd.tx, cmd.ty);
    const chunk = this.collision.chunks.get(layer, cmd.tx >> CHUNK_SHIFT, cmd.ty >> CHUNK_SHIFT);
    if (chunk === undefined) return 'noWater';
    const i = ((cmd.ty & CHUNK_MASK) << CHUNK_SHIFT) | (cmd.tx & CHUNK_MASK);
    const source = waterSource(chunk.water[i] as number);
    if (source === null) return 'noWater';
    if (source === 'meer') return 'saltWater';
    if (source === 'eis' || !drinkable(source)) return 'frozen';
    const biomeId = chunk.biome[i] as number;
    const biome = biomeId === 0 ? null : contentWorldIdTables().biomes.stringId(biomeId);
    const ticks = sipTicks();
    this.stateValue.consumption = { kind: 'trinken', item: null, from: null, water: source, biome, ticksLeft: ticks, totalTicks: ticks };
    sim.events.push('activityStarted', { entity: e, action: 'trinken', item: null, ticks, tick });
    return null;
  }

  /** The eaten piece leaves the bags and acts (§18, §12.3). */
  private finishEating(sim: Simulation, e: Entity, c: Consumption): void {
    const item = c.item as string;
    const stack = this.takeOne(sim, item, c.from);
    const v = this.components.vitals.get(e);
    if (stack === null || v === undefined) {
      sim.events.push('activityInterrupted', { entity: e, action: 'essen', item, reason: 'weg', tick: sim.eventTick });
      return;
    }
    const def = this.inventory.bags.catalog.get(item);
    const stage = freshnessStage(stack.frische);
    const n = eatenNutrition(def, stage, this.nutrition);
    v.satiety = clampStat(v.satiety + n.satiety, STAT_MAX);
    v.thirst = clampStat(v.thirst + n.thirst, STAT_MAX);
    const chance = foodPoisonChance(stage);
    const poisoned = chance > 0 && sim.rng.stream(ACTIONS_RNG_STREAM).next() < chance;
    sim.events.push('activityFinished', { entity: e, action: 'essen', item, tick: sim.eventTick });
    sim.events.push('itemEaten', { entity: e, item, satiety: n.satiety, thirst: n.thirst, freshness: stage, poisoned, tick: sim.eventTick });
    const fright = eatingFright(isRawFood(def), stage);
    if (fright > 0) this.fear.spike(sim, fright, 'nahrung');
    else if (dishComfort(def) > 0) this.fear.soothe(sim, dishComfort(def), 'wohlfuehlessen');
    if (poisoned) this.conditions.apply(sim, 'lebensmittelvergiftung');
  }

  /** A sip of water (§18). */
  private finishDrinking(sim: Simulation, e: Entity, c: Consumption): void {
    const v = this.components.vitals.get(e);
    if (v === undefined || c.water === null) return;
    const before = v.thirst;
    v.thirst = clampStat(v.thirst + A.sipThirst, STAT_MAX);
    const chance = feverChance(c.water, c.biome);
    const fever = chance > 0 && sim.rng.stream(ACTIONS_RNG_STREAM).next() < chance;
    sim.events.push('activityFinished', { entity: e, action: 'trinken', item: null, tick: sim.eventTick });
    sim.events.push('waterDrunk', { entity: e, source: c.water, thirst: v.thirst - before, fever, tick: sim.eventTick });
    if (fever) this.conditions.apply(sim, 'fieber');
  }

  /** Whether the bags still hold `item`: in slot `from` (also the belt) or anywhere in the carried bags. */
  private holds(item: string, from: SlotRef | null): boolean {
    const state = this.inventory.state;
    if (from !== null && isValidRef(state, from) && slotAt(state, from)?.item === item) return true;
    return this.inventory.count(item) > 0;
  }

  /** Takes one piece of `item`: from `from` while it still holds the item, else from anywhere in the carried bags. */
  private takeOne(sim: Simulation, item: string, from: SlotRef | null): ItemStack | null {
    const state = this.inventory.state;
    const catalog = this.inventory.bags.catalog;
    if (from !== null && isValidRef(state, from) && slotAt(state, from)?.item === item) {
      const r = discard(state, catalog, from, 1);
      if (r.ok) {
        this.inventory.bags.replace(r.state);
        sim.events.push('inventoryChanged', { change: 'remove', tick: sim.eventTick });
        return r.discarded;
      }
    }
    const r = removeItems(state, item, 1);
    if (!r.ok) return null;
    this.inventory.bags.replace(r.state);
    sim.events.push('inventoryChanged', { change: 'remove', tick: sim.eventTick });
    return r.removed[0] ?? null;
  }

  private cancel(sim: Simulation): Refusal | null {
    if (this.interrupt(sim, 'abgebrochen')) return null;
    if (this.stateValue.seat !== null) return this.stand(sim, null);
    return 'idle';
  }

  // -------------------------------------------------------------------------------------------
  // Sitting
  // -------------------------------------------------------------------------------------------

  private sit(sim: Simulation, cmd: CommandOfType<'action.sit'>, tick: number): Refusal | null {
    const e = this.playerOf(sim);
    const no = this.blocked(e);
    if (no !== null) return no;
    const body = this.components.body.get(e);
    if (body === undefined || !this.position(e)) return 'noPlayer';
    if (this.stateValue.seat !== null) return 'busy';
    let seat: Seat | null = null;
    for (let i = 0; i < this.seats.length && seat === null; i++) seat = (this.seats[i] as SeatProvider)(sim, body.layer, cmd.tx, cmd.ty);
    if (seat === null || seat.layer !== body.layer) return 'noSeat';
    const dx = seat.x - this.pos.x;
    const dy = seat.y - this.pos.y;
    if (dx * dx + dy * dy > REACH_PX * REACH_PX) return 'outOfReach';
    this.stateValue.seat = seat;
    sim.events.push('activityStarted', { entity: e, action: 'sitzen', item: null, ticks: 0, tick });
    return null;
  }

  /** Gets up: normally (`null`) or because of an interruption. */
  private stand(sim: Simulation, reason: ActionInterruption | null): null {
    if (this.stateValue.seat === null) return null;
    this.stateValue.seat = null;
    if (reason === null) sim.events.push('activityFinished', { entity: this.owner, action: 'sitzen', item: null, tick: sim.eventTick });
    else sim.events.push('activityInterrupted', { entity: this.owner, action: 'sitzen', item: null, reason, tick: sim.eventTick });
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Throwing
  // -------------------------------------------------------------------------------------------

  private throwItem(sim: Simulation, cmd: CommandOfType<'action.throw'>, tick: number): Refusal | null {
    const e = this.playerOf(sim);
    const no = this.blocked(e);
    if (no !== null) return no;
    const body = this.components.body.get(e);
    if (body === undefined || !this.position(e)) return 'noPlayer';
    if (!THROWABLE_AREAS.has(cmd.from.bereich)) return 'notThrowable';
    const state = this.inventory.state;
    if (!isValidRef(state, cmd.from)) return 'invalidSlot';
    const r = discard(state, this.inventory.bags.catalog, cmd.from, 1);
    if (!r.ok) return r.reason;
    this.stand(sim, null);
    // Aim: at most 8 tiles along the aimed direction, stopped by the first rock, tree or wall.
    let dx = cmd.x - this.pos.x;
    let dy = cmd.y - this.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > THROW_MAX_PX) {
      dx *= THROW_MAX_PX / dist;
      dy *= THROW_MAX_PX / dist;
    }
    const layer = body.layer;
    const x0 = this.pos.x;
    const y0 = this.pos.y;
    this.collision.ensureTiles(layer, Math.floor(Math.min(x0, x0 + dx) / TILE_PX) - 1, Math.floor(Math.min(y0, y0 + dy) / TILE_PX) - 1, Math.floor(Math.max(x0, x0 + dx) / TILE_PX) + 1, Math.floor(Math.max(y0, y0 + dy) / TILE_PX) + 1);
    const hit = sweepCircle(this.collision.grid, layer, x0, y0, x0 + dx, y0 + dy, THROW_RADIUS_PX, PROJECTILE_RULES, body.level, this.sweep);
    const toX = hit.x;
    const toY = hit.y;
    const fx = toX - x0;
    const fy = toY - y0;
    const flight = Math.sqrt(fx * fx + fy * fy);
    const totalTicks = throwFlightTicks(flight);
    this.inventory.bags.replace(r.state);
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    const entity = sim.ecs.create();
    const row = this.motion.position.add(entity);
    this.motion.position.columns.x[row] = x0;
    this.motion.position.columns.y[row] = y0;
    this.stateValue.throws.push({ entity, stack: r.discarded, layer, fromX: x0, fromY: y0, toX, toY, ticks: 0, totalTicks });
    sim.events.push('entitySpawned', { entity, tick });
    sim.events.push('itemThrown', { entity, item: r.discarded.item, fromX: x0, fromY: y0, toX, toY, ticks: totalTicks, tick });
    return null;
  }

  /** Moves the thrown pieces; landed ones become dropped items (or sink). */
  private flights(sim: Simulation): void {
    const throws = this.stateValue.throws;
    const pos = this.motion.position;
    for (let i = 0; i < throws.length; ) {
      const t = throws[i] as Throw;
      t.ticks++;
      const row = pos.indexOf(t.entity);
      const k = t.ticks >= t.totalTicks ? 1 : t.ticks / t.totalTicks;
      const x = t.fromX + (t.toX - t.fromX) * k;
      const y = t.fromY + (t.toY - t.fromY) * k;
      if (row >= 0) {
        pos.columns.x[row] = x;
        pos.columns.y[row] = y;
      }
      if (k < 1) {
        i++;
        continue;
      }
      throws.splice(i, 1);
      if (sim.ecs.alive(t.entity)) sim.ecs.queueDestroy(t.entity);
      const layer = t.layer as Layer;
      const sunk = (this.collision.grid.tileInfo(layer, Math.floor(x / TILE_PX), Math.floor(y / TILE_PX)) & BLOCK_DEEP_WATER) !== 0;
      sim.events.push('thrownItemLanded', { entity: t.entity, item: t.stack.item, x, y, layer, sunk, tick: sim.eventTick });
      if (!sunk) this.landing(sim, t.stack, layer, x, y);
    }
  }

  // -------------------------------------------------------------------------------------------

  private refuse(sim: Simulation, type: GameCommandType, tick: number, reason: Refusal | null): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  /** Whether the centre of tile (tx, ty) lies within reach of the player position in `pos`. */
  private inReach(tx: number, ty: number): boolean {
    const dx = (tx + 1 / 2) * TILE_PX - this.pos.x;
    const dy = (ty + 1 / 2) * TILE_PX - this.pos.y;
    return dx * dx + dy * dy <= REACH_PX * REACH_PX;
  }

  private position(e: Entity): boolean {
    const row = this.motion.position.indexOf(e);
    if (row < 0) return false;
    this.pos.x = this.motion.position.columns.x[row] as number;
    this.pos.y = this.motion.position.columns.y[row] as number;
    return true;
  }

  /** The player; a new player entity starts without actions (thrown pieces keep flying). */
  private playerOf(sim: Simulation): Entity {
    const e = sim.player;
    if (e !== this.owner) {
      this.owner = e;
      this.stateValue.consumption = null;
      this.stateValue.seat = null;
    }
    return e;
  }
}
