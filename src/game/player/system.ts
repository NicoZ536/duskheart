/**
 * Player system (docs/SPIEL.md §3; MASTERPROMPT §11.4; M3-08, M3-09): the one player entity – spawn,
 * steering, collision with the world, sprint, sneak, dodge roll, swimming, cliffs.
 *
 * - **Entity:** `sim.player`, with the shared `position` component of the motion system (world px, the
 *   centre of the feet), the `player` body (`state.ts`) and the `vitals` (src/game/survival). The body
 *   keeps the position at the start of the tick, so the presentation interpolates between two ticks.
 * - **Every tick** (before the vitals system): refresh the modifiers of equipment and conditions, then
 *   one of three movements –
 *   - *transit*: a jump down a cliff face or a ladder climb in progress (scripted, no collision);
 *   - *roll*: 3 tiles in 0,4 s along the roll direction, invulnerable for the first 0,25 s;
 *   - *steered*: the mode (`steeredMode`: swim in deep water, sneak, sprint while stamina lasts, walk,
 *     idle) sets the speed, `moveCircle` moves the collision circle through the tile grid
 *     (`PLAYER_RULES`: swims through deep water, steps down ledges, climbs only ramps and stairs).
 *     A step down reports the drop (`playerLanded`, fall damage from 2 levels, fracture risk from 3);
 *     pushing 0,2 s against a cliff face from its edge jumps down, against a placed ladder climbs up.
 *   Sprint (12/s) and swimming (5/s) spend stamina; an emptied sprint locks until 25 stamina are back.
 * - **Commands:** `player.spawn` (start beach: the free tile nearest to the beach centre), `player.move`,
 *   `player.sprint`, `player.sneak`, `player.roll`, `player.teleport` (debug).
 * - **Feedback events:** `playerSpawned`, `playerStateChanged`, `playerRolled`, `playerLanded`,
 *   `playerClimbed`, `playerStep` (every 1,5 tiles, with ground and noise).
 * - **Hooks** for later systems: `addClimbAids` (placed ladders, M4), `onFracture` (the condition
 *   „Knochenbruch", M3-19); movement factors and armour weight come through `PlayerInfluences`.
 * Global (not chunk-bound): the active zone follows the player. Save participant `player`.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import type { PlayerMoveState } from '../../content/balance/player';
import { NULL_ENTITY, isEntityHandle, type Entity } from '../../engine/ecs';
import { BLOCK_DEEP_WATER, PLAYER_RULES, infoLevel } from '../../world/collision/tiles';
import { createMoveResult, moveCircle } from '../../world/collision/move';
import { WATER_DEPTH_DEEP, WATER_DEPTH_MASK, WATER_DEPTH_SHALLOW, WATER_FROZEN } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import type { CommandOfType, GameCommandType } from '../commands';
import { createDebugCheats, type DebugCheats } from '../cheats/state';
import type { SaveParticipant } from '../participant';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { MotionSystem } from '../systems/motion';
import { rollAllowed, sprintAllowed } from '../survival/formulas';
import type { PlayerInfluences, PlayerModifiers } from '../survival/modifiers';
import { createVitals, type Vitals } from '../survival/state';
import { spendStamina, type VitalsSystem } from '../survival/system';
import { SPAWN_SEARCH_RADIUS, createCliffMove, findFreeTile, findJumpDown, findLadderClimb, type ClimbAids, type FreeTile } from './cliffs';
import type { WorldCollision } from './collision';
import type { PlayerComponents } from './components';
import type { PlayerRejectReason, WaterContact } from './events';
import { clampInput, climbTicks, facingFor, facingVector, fallOutcome, fractureChance, jumpTicks, moveSpeedTilesPerSecond, movementNoise, rollSpeedTilesPerSecond, secondsToTicks, steeredMode } from './formulas';
import { createPlayerBody, playerBodySchema, type PlayerBody } from './state';

/** Id of the player system and its save participant. */
export const PLAYER_SYSTEM_ID = 'player';
/** Data version of the `player` participant. */
export const PLAYER_SAVE_VERSION = 1;
/** Random stream of the player's chances (bone fractures). */
export const PLAYER_RNG_STREAM = 'player';

const MOVE = BALANCE.player.movement;
const ROLL = BALANCE.player.roll;
const CLIFF = BALANCE.player.cliffs;
const STAMINA = BALANCE.survival.stamina;
const RADIUS = MOVE.colliderRadiusPx;
const ROLL_TICKS = secondsToTicks(ROLL.durationSeconds);
const INVULNERABLE_TICKS = secondsToTicks(ROLL.invulnerableSeconds);
const PUSH_TICKS = secondsToTicks(CLIFF.jumpHoldSeconds);
const STEP_PX = MOVE.stepLengthTiles * TILE_PX;
const ROLL_SPEED_PX = rollSpeedTilesPerSecond() * TILE_PX;
/** Offset of a tile's centre from its corner [px]. */
const HALF_TILE = TILE_PX / 2;

/** Called when a landing broke a bone (the condition „Knochenbruch" of M3-19 attaches here). */
export type FractureListener = (sim: Simulation, player: Entity) => void;

/** Why the player cannot act (harvest, use, set up or feed lights, craft): dead (§11.6) or asleep (§11.5). */
export type PlayerIncapacity = 'dead' | 'asleep';
/** Reports a reason owned by a later system (the sleep system: asleep), or `null`. */
export type IncapacityProvider = (sim: Simulation) => PlayerIncapacity | null;

const playerSnapshotSchema = z
  .object({
    entity: z.number().int().refine((e) => e === NULL_ENTITY || isEntityHandle(e), { message: 'must be an entity handle or -1' }),
    body: playerBodySchema.nullable(),
  })
  .strict();

/** Dependencies of the player system (built in `createSimulation`). */
export interface PlayerSystemDeps {
  readonly motion: MotionSystem;
  readonly collision: WorldCollision;
  readonly components: PlayerComponents;
  readonly influences: PlayerInfluences;
  readonly vitals: VitalsSystem;
  /** Debug cheats (`noclip`: movement through everything; src/game/cheats/state.ts); absent = every cheat off. */
  readonly cheats?: Readonly<DebugCheats>;
}

export class PlayerSystem implements SimSystem {
  readonly id = PLAYER_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private readonly motion: MotionSystem;
  private readonly collision: WorldCollision;
  private readonly cheats: Readonly<DebugCheats>;
  private readonly components: PlayerComponents;
  /** Modifier sources and heat sources of equipment, conditions, rooms and fires (register them in `createSimulation`). */
  readonly influences: PlayerInfluences;
  private readonly vitals: VitalsSystem;
  private readonly climbSources: ClimbAids[] = [];
  private readonly fractureListeners: FractureListener[] = [];
  private readonly incapacities: IncapacityProvider[] = [];
  /** Ladders of every registered source (the building system, M4). */
  private readonly aids: ClimbAids = { ladderAt: (layer, tx, ty) => this.climbSources.some((s) => s.ladderAt(layer, tx, ty)) };
  private readonly moved = createMoveResult();
  private readonly cliff = createCliffMove();
  private readonly free: FreeTile = { tx: 0, ty: 0, level: 0 };
  private readonly dir = { x: 0, y: 0 };
  private readonly fall = { damage: 0, fracture: false };

  constructor(sim: Simulation, deps: PlayerSystemDeps) {
    this.motion = deps.motion;
    this.collision = deps.collision;
    this.components = deps.components;
    this.influences = deps.influences;
    this.vitals = deps.vitals;
    this.cheats = deps.cheats ?? createDebugCheats();
    sim.ecs.onDestroy((e) => {
      if (e === sim.player) sim.setPlayer(NULL_ENTITY);
    });
    this.commands = {
      'player.spawn': (s, cmd, tick) => this.handleSpawn(s, cmd, tick),
      'player.move': (s, cmd, tick) => {
        const b = this.bodyOrReject(s, cmd.type, tick);
        if (b === undefined) return;
        clampInput(cmd.dx, cmd.dy, this.dir);
        b.inputX = this.dir.x;
        b.inputY = this.dir.y;
      },
      'player.sprint': (s, cmd, tick) => {
        const b = this.bodyOrReject(s, cmd.type, tick);
        if (b !== undefined) b.sprintHeld = cmd.on;
      },
      'player.sneak': (s, cmd, tick) => {
        const b = this.bodyOrReject(s, cmd.type, tick);
        if (b !== undefined) b.sneakHeld = cmd.on;
      },
      'player.roll': (s, cmd, tick) => this.handleRoll(s, cmd, tick),
      'player.teleport': (s, cmd, tick) => this.handleTeleport(s, cmd, tick),
    };
    this.save = {
      id: PLAYER_SYSTEM_ID,
      version: PLAYER_SAVE_VERSION,
      // The store holds at most the player's body (exactly one player, docs/SPIEL.md §3).
      serialize: () => {
        const store = this.components.body;
        return store.size === 0 ? { entity: NULL_ENTITY, body: null } : { entity: store.entityAt(0), body: { ...store.valueAt(0) } };
      },
      deserialize: (data) => {
        const parsed = playerSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`player snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        const { entity, body } = parsed.data;
        if ((entity === NULL_ENTITY) !== (body === null)) throw new TypeError('player snapshot: entity and body must be given together');
        this.components.body.clear();
        if (body !== null) this.components.body.add(entity, { ...body, layer: body.layer as Layer });
        sim.setPlayer(entity);
      },
    };
  }

  /** The body of the player, if there is one. */
  body(sim: Simulation): PlayerBody | undefined {
    const e = sim.player;
    return e === NULL_ENTITY ? undefined : this.components.body.get(e);
  }

  /** Writes the player's position [px] into `out`; false (leaving `out`) without a player. No allocation. */
  position(sim: Simulation, out: { x: number; y: number }): boolean {
    const e = sim.player;
    if (e === NULL_ENTITY) return false;
    const row = this.motion.position.indexOf(e);
    if (row < 0) return false;
    out.x = this.motion.position.columns.x[row] as number;
    out.y = this.motion.position.columns.y[row] as number;
    return true;
  }

  /** The vitals of the player (`undefined` without one). */
  vitalsOf(e: Entity): Vitals | undefined {
    return e === NULL_ENTITY ? undefined : this.components.vitals.get(e);
  }

  /** Duration of a whole roll [ticks] (§11.4). */
  get rollDurationTicks(): number {
    return ROLL_TICKS;
  }

  /** Whether the player is invulnerable (the first 0,25 s of a roll, §11.4); attacks ask this. */
  isInvulnerable(sim: Simulation): boolean {
    const b = this.body(sim);
    return b !== undefined && b.invulnerableTicks > 0;
  }

  /** Adds a source of placed ladders (the building system, M4). */
  addClimbAids(source: ClimbAids): void {
    this.climbSources.push(source);
  }

  /** Adds a listener for broken bones (the conditions system, M3-19). */
  onFracture(listener: FractureListener): void {
    this.fractureListeners.push(listener);
  }

  /** Adds a reason the player cannot act that a later system owns (the sleep system, src/game/death/life.ts). */
  addIncapacity(provider: IncapacityProvider): void {
    this.incapacities.push(provider);
  }

  /**
   * Why the player cannot act now – `dead` at 0 health (§11.6: the body lies while the death screen shows),
   * else the first reason a provider reports (`asleep`, §11.5) – or `null`. The systems of the player's own
   * deeds ask it: the interaction (E), using items, the light commands, crafting and the drop magnet.
   */
  incapacity(sim: Simulation): PlayerIncapacity | null {
    const v = this.vitalsOf(sim.player);
    if (v !== undefined && v.health <= 0) return 'dead';
    for (let i = 0; i < this.incapacities.length; i++) {
      const reason = (this.incapacities[i] as IncapacityProvider)(sim);
      if (reason !== null) return reason;
    }
    return null;
  }

  update(sim: Simulation, dt: number): void {
    const e = sim.player;
    if (e === NULL_ENTITY) return;
    const body = this.components.body.get(e);
    const v = this.components.vitals.get(e);
    const row = this.motion.position.indexOf(e);
    if (body === undefined || v === undefined || row < 0) return;
    const pos = this.motion.position.columns;
    const x0 = pos.x[row] as number;
    const y0 = pos.y[row] as number;
    body.prevX = x0;
    body.prevY = y0;
    const mods = this.influences.refresh(sim, e);
    let next: PlayerMoveState;
    if (body.transit !== 'none') next = this.stepTransit(sim, e, body, row);
    else if (body.rollTicks > 0) next = this.stepRoll(sim, e, body, row, dt);
    else next = this.stepSteered(sim, e, body, v, mods, row, dt);
    if (body.invulnerableTicks > 0) body.invulnerableTicks--;
    const x1 = pos.x[row] as number;
    const y1 = pos.y[row] as number;
    body.vx = (x1 - x0) / dt;
    body.vy = (y1 - y0) / dt;
    this.setState(sim, e, body, next);
    body.noise = movementNoise(body.state);
    this.footsteps(sim, e, body, x1, y1, Math.hypot(x1 - x0, y1 - y0));
  }

  // -------------------------------------------------------------------------------------------
  // Movements
  // -------------------------------------------------------------------------------------------

  /** Steered movement of one tick; returns the movement mode. */
  private stepSteered(sim: Simulation, e: Entity, body: PlayerBody, v: Vitals, mods: PlayerModifiers, row: number, dt: number): PlayerMoveState {
    if (this.cheats.noclip) return this.stepNoclip(body, v, mods, row, dt);
    const grid = this.collision.grid;
    const pos = this.motion.position.columns;
    const x = pos.x[row] as number;
    const y = pos.y[row] as number;
    const layer = body.layer;
    const swimming = (grid.tileInfo(layer, Math.floor(x / TILE_PX), Math.floor(y / TILE_PX)) & BLOCK_DEEP_WATER) !== 0;
    const moving = body.inputX !== 0 || body.inputY !== 0;
    const mode = steeredMode(moving, swimming, body.sneakHeld, body.sprintHeld, sprintAllowed(v.stamina, v.sprintLocked));
    let nx = x;
    let ny = y;
    if (moving) {
      const speed = moveSpeedTilesPerSecond(mode, mods.armorWeight, mods.moveSpeedFactor) * TILE_PX * dt;
      const r = moveCircle(grid, layer, x, y, RADIUS, body.inputX * speed, body.inputY * speed, PLAYER_RULES, this.moved);
      nx = r.x;
      ny = r.y;
      pos.x[row] = nx;
      pos.y[row] = ny;
      body.level = r.level;
      body.facing = facingFor(body.inputX, body.inputY, body.facing);
      if (r.dropped > 0) this.land(sim, e, r.dropped, (grid.tileInfo(layer, Math.floor(nx / TILE_PX), Math.floor(ny / TILE_PX)) & BLOCK_DEEP_WATER) !== 0);
      if (r.hit && layer === 0 && this.pushAgainstCliff(body, nx, ny, r.normalX, r.normalY)) return body.transit === 'jump' ? 'jump' : 'climb';
    } else body.pushTicks = 0;
    // Stamina of this tick (§11.1): sprinting while moving, treading deep water always.
    if (mode === 'sprint') {
      spendStamina(v, STAMINA.sprintPerSecond * dt);
      if (v.stamina <= 0) v.sprintLocked = true;
    }
    if (swimming) spendStamina(v, STAMINA.swimPerSecond * dt);
    body.swimming = (grid.tileInfo(layer, Math.floor(nx / TILE_PX), Math.floor(ny / TILE_PX)) & BLOCK_DEEP_WATER) !== 0;
    return body.swimming === swimming ? mode : steeredMode(moving, body.swimming, body.sneakHeld, body.sprintHeld, sprintAllowed(v.stamina, v.sprintLocked));
  }

  /**
   * Steered movement of one tick with the debug cheat `noclip`: walking, sneaking or sprinting (stamina as
   * usual) straight through walls, cliffs, trees and deep water – never swimming, no jumps, no falls –, kept
   * inside the world; the height level follows the tile under the feet. Returns the movement mode.
   */
  private stepNoclip(body: PlayerBody, v: Vitals, mods: PlayerModifiers, row: number, dt: number): PlayerMoveState {
    const moving = body.inputX !== 0 || body.inputY !== 0;
    const mode = steeredMode(moving, false, body.sneakHeld, body.sprintHeld, sprintAllowed(v.stamina, v.sprintLocked));
    body.swimming = false;
    body.pushTicks = 0;
    if (!moving) return mode;
    const speed = moveSpeedTilesPerSecond(mode, mods.armorWeight, mods.moveSpeedFactor) * TILE_PX * dt;
    this.moveFreely(body, row, body.inputX * speed, body.inputY * speed);
    body.facing = facingFor(body.inputX, body.inputY, body.facing);
    if (mode === 'sprint') {
      spendStamina(v, STAMINA.sprintPerSecond * dt);
      if (v.stamina <= 0) v.sprintLocked = true;
    }
    return mode;
  }

  /** Moves the body by (dx, dy) [px] without collision (noclip), inside the world; the level follows the tile. */
  private moveFreely(body: PlayerBody, row: number, dx: number, dy: number): void {
    const pos = this.motion.position.columns;
    const edge = this.collision.worldTiles * TILE_PX - RADIUS;
    const x = Math.min(edge, Math.max(RADIUS, (pos.x[row] as number) + dx));
    const y = Math.min(edge, Math.max(RADIUS, (pos.y[row] as number) + dy));
    pos.x[row] = x;
    pos.y[row] = y;
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor(y / TILE_PX);
    this.collision.ensureTiles(body.layer, tx, ty, tx, ty);
    body.level = infoLevel(this.collision.grid.tileInfo(body.layer, tx, ty));
  }

  /** One tick of a dodge roll; returns 'roll' (the last roll tick included). */
  private stepRoll(sim: Simulation, e: Entity, body: PlayerBody, row: number, dt: number): PlayerMoveState {
    const grid = this.collision.grid;
    const pos = this.motion.position.columns;
    const step = ROLL_SPEED_PX * dt;
    if (this.cheats.noclip) {
      this.moveFreely(body, row, body.rollDx * step, body.rollDy * step);
      body.rollTicks--;
      body.pushTicks = 0;
      body.swimming = false;
      return 'roll';
    }
    const r = moveCircle(grid, body.layer, pos.x[row] as number, pos.y[row] as number, RADIUS, body.rollDx * step, body.rollDy * step, PLAYER_RULES, this.moved);
    pos.x[row] = r.x;
    pos.y[row] = r.y;
    body.level = r.level;
    body.rollTicks--;
    body.pushTicks = 0;
    const water = (grid.tileInfo(body.layer, Math.floor(r.x / TILE_PX), Math.floor(r.y / TILE_PX)) & BLOCK_DEEP_WATER) !== 0;
    if (r.dropped > 0) this.land(sim, e, r.dropped, water);
    body.swimming = water;
    return 'roll';
  }

  /** One tick of a jump or climb; returns its mode, and the mode after landing on its last tick. */
  private stepTransit(sim: Simulation, e: Entity, body: PlayerBody, row: number): PlayerMoveState {
    const pos = this.motion.position.columns;
    body.transitTicks++;
    const kind = body.transit;
    if (body.transitTicks < body.transitTotal) {
      const t = body.transitTicks / body.transitTotal;
      pos.x[row] = body.transitFromX + (body.transitToX - body.transitFromX) * t;
      pos.y[row] = body.transitFromY + (body.transitToY - body.transitFromY) * t;
      return kind === 'jump' ? 'jump' : 'climb';
    }
    // Arrived: settle the circle clear of neighbouring obstacles on the new level.
    const r = moveCircle(this.collision.grid, body.layer, body.transitToX, body.transitToY, RADIUS, 0, 0, PLAYER_RULES, this.moved);
    pos.x[row] = r.x;
    pos.y[row] = r.y;
    body.level = r.level;
    body.transit = 'none';
    body.swimming = body.transitIntoWater;
    if (kind === 'jump') this.land(sim, e, body.transitLevels, body.transitIntoWater);
    else sim.events.push('playerClimbed', { entity: e, levels: body.transitLevels, tick: sim.eventTick });
    return body.swimming ? 'swim' : 'idle';
  }

  /**
   * The body was stopped by the tile grid at (x, y) with contact normal (nx, ny): pushing on against a
   * cliff face from its top edge jumps down, against a placed ladder climbs up – after `jumpHoldSeconds`
   * of pushing. Returns whether a jump or climb started.
   */
  private pushAgainstCliff(body: PlayerBody, x: number, y: number, nx: number, ny: number): boolean {
    const grid = this.collision.grid;
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor(y / TILE_PX);
    const ix = body.inputX;
    const iy = body.inputY;
    let found = false;
    let jump = false;
    if (iy >= CLIFF.pushInputMin && ny < 0 && findJumpDown(grid, body.layer, tx, ty, body.level, this.cliff)) {
      found = true;
      jump = true;
    } else if (this.climbSources.length > 0) {
      const horizontal = Math.abs(ix) >= Math.abs(iy);
      const dirX = horizontal ? Math.sign(ix) : 0;
      const dirY = horizontal ? 0 : Math.sign(iy);
      const push = horizontal ? Math.abs(ix) : Math.abs(iy);
      const opposes = dirX * nx + dirY * ny < 0;
      found = push >= CLIFF.pushInputMin && opposes && findLadderClimb(grid, body.layer, tx, ty, dirX, dirY, body.level, this.aids, this.cliff);
    }
    if (!found) {
      body.pushTicks = 0;
      return false;
    }
    body.pushTicks++;
    if (body.pushTicks < PUSH_TICKS) return false;
    body.pushTicks = 0;
    this.startTransit(body, x, y, jump);
    return true;
  }

  /** Starts the jump or climb to `this.cliff` from (x, y). */
  private startTransit(body: PlayerBody, x: number, y: number, jump: boolean): void {
    const c = this.cliff;
    body.transit = jump ? 'jump' : 'climb';
    body.transitFromX = x;
    body.transitFromY = y;
    // Along the edge the body keeps its place; across it the move ends on the target tile's centre line.
    const sameColumn = c.tx === Math.floor(x / TILE_PX);
    body.transitToX = sameColumn ? x : c.tx * TILE_PX + HALF_TILE;
    body.transitToY = sameColumn ? c.ty * TILE_PX + HALF_TILE : y;
    body.transitTicks = 0;
    body.transitTotal = jump ? jumpTicks(c.levels) : climbTicks(c.levels);
    body.transitLevels = c.levels;
    body.transitToLevel = c.toLevel;
    body.transitIntoWater = c.water;
    body.rollTicks = 0;
  }

  /** A landing after a drop over `levels` levels (§11.4): damage, fracture chance, event. */
  private land(sim: Simulation, e: Entity, levels: number, intoWater: boolean): void {
    const risky = !intoWater && fractureChance(levels) > 0;
    const roll = risky ? sim.rng.stream(PLAYER_RNG_STREAM).next() : 1;
    const outcome = fallOutcome(levels, intoWater, roll, this.fall);
    const damage = outcome.damage > 0 ? this.vitals.damage(sim, outcome.damage, 'sturz') : 0;
    sim.events.push('playerLanded', { entity: e, levels, damage, fracture: outcome.fracture, water: intoWater, tick: sim.eventTick });
    if (outcome.fracture) for (const l of this.fractureListeners) l(sim, e);
  }

  // -------------------------------------------------------------------------------------------
  // State, footsteps
  // -------------------------------------------------------------------------------------------

  private setState(sim: Simulation, e: Entity, body: PlayerBody, next: PlayerMoveState): void {
    if (next === body.state) {
      body.stateTicks++;
      return;
    }
    sim.events.push('playerStateChanged', { entity: e, state: next, previous: body.state, tick: sim.eventTick });
    body.state = next;
    body.stateTicks = 0;
  }

  /** Footsteps and swim strokes every `stepLengthTiles` of walked, sprinted, sneaked or swum distance. */
  private footsteps(sim: Simulation, e: Entity, body: PlayerBody, x: number, y: number, distance: number): void {
    const s = body.state;
    if (s !== 'walk' && s !== 'sprint' && s !== 'sneak' && s !== 'swim') {
      body.stepDistancePx = 0;
      return;
    }
    body.stepDistancePx += distance;
    if (body.stepDistancePx < STEP_PX) return;
    body.stepDistancePx -= STEP_PX;
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor(y / TILE_PX);
    const chunk = this.collision.chunks.get(body.layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) return;
    const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
    const ground = chunk.ground[i] as number;
    if (ground === 0) return;
    const water = chunk.water[i] as number;
    const depth = (water & WATER_FROZEN) !== 0 ? 0 : water & WATER_DEPTH_MASK;
    const contact: WaterContact = depth === WATER_DEPTH_DEEP ? 'deep' : depth === WATER_DEPTH_SHALLOW ? 'shallow' : 'none';
    sim.events.push('playerStep', { entity: e, terrain: contentWorldIdTables().terrain.stringId(ground), water: contact, noise: body.noise, tick: sim.eventTick });
  }

  // -------------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------------

  private reject(sim: Simulation, type: GameCommandType, reason: PlayerRejectReason, tick: number): void {
    sim.events.push('commandRejected', { type, reason, tick });
  }

  /** The player's body, or `undefined` after rejecting the command (`noPlayer`). */
  private bodyOrReject(sim: Simulation, type: GameCommandType, tick: number): PlayerBody | undefined {
    const b = this.body(sim);
    if (b === undefined) this.reject(sim, type, 'noPlayer', tick);
    return b;
  }

  private handleSpawn(sim: Simulation, cmd: CommandOfType<'player.spawn'>, tick: number): void {
    if (sim.player !== NULL_ENTITY && sim.ecs.alive(sim.player)) {
      this.reject(sim, cmd.type, 'playerExists', tick);
      return;
    }
    const layer = (cmd.layer ?? 0) as Layer;
    let tx: number;
    let ty: number;
    if (cmd.tx !== undefined && cmd.ty !== undefined) {
      tx = cmd.tx;
      ty = cmd.ty;
    } else {
      const spawn = sim.world.generated.spawn;
      tx = spawn.x;
      ty = spawn.y;
    }
    const tiles = this.collision.worldTiles;
    if (tx < 0 || ty < 0 || tx >= tiles || ty >= tiles) {
      sim.events.push('commandRejected', { type: cmd.type, reason: 'outOfBounds', tick });
      return;
    }
    const radius = SPAWN_SEARCH_RADIUS;
    this.collision.ensureTiles(layer, tx - radius - 1, ty - radius - 1, tx + radius + 1, ty + radius + 1);
    if (!findFreeTile(this.collision.grid, layer, tx, ty, radius, this.free)) {
      this.reject(sim, cmd.type, 'noFreeTile', tick);
      return;
    }
    const x = this.free.tx * TILE_PX + HALF_TILE;
    const y = this.free.ty * TILE_PX + HALF_TILE;
    const e = sim.ecs.create();
    const p = this.motion.position.add(e);
    this.motion.position.columns.x[p] = x;
    this.motion.position.columns.y[p] = y;
    this.components.body.add(e, createPlayerBody(x, y, layer, this.free.level));
    this.components.vitals.add(e, createVitals());
    sim.setPlayer(e);
    sim.events.push('entitySpawned', { entity: e, tick });
    sim.events.push('playerSpawned', { entity: e, x, y, layer, tick });
  }

  private handleRoll(sim: Simulation, cmd: CommandOfType<'player.roll'>, tick: number): void {
    const body = this.bodyOrReject(sim, cmd.type, tick);
    if (body === undefined) return;
    const v = this.components.vitals.get(sim.player);
    if (v === undefined) return;
    if (body.transit !== 'none' || body.rollTicks > 0 || body.swimming) {
      this.reject(sim, cmd.type, 'busy', tick);
      return;
    }
    if (!rollAllowed(v.stamina)) {
      this.reject(sim, cmd.type, 'noStamina', tick);
      return;
    }
    clampInput(cmd.dx, cmd.dy, this.dir);
    const len = Math.hypot(this.dir.x, this.dir.y);
    if (len > 0) {
      this.dir.x /= len;
      this.dir.y /= len;
    } else facingVector(body.facing, this.dir);
    body.rollDx = this.dir.x;
    body.rollDy = this.dir.y;
    body.rollTicks = ROLL_TICKS;
    body.invulnerableTicks = INVULNERABLE_TICKS;
    body.facing = facingFor(this.dir.x, this.dir.y, body.facing);
    spendStamina(v, STAMINA.rollCost);
    sim.events.push('playerRolled', { entity: sim.player, dx: body.rollDx, dy: body.rollDy, tick });
  }

  private handleTeleport(sim: Simulation, cmd: CommandOfType<'player.teleport'>, tick: number): void {
    const body = this.bodyOrReject(sim, cmd.type, tick);
    if (body === undefined) return;
    const edge = this.collision.worldTiles * TILE_PX;
    if (!(cmd.x >= 0 && cmd.y >= 0 && cmd.x < edge && cmd.y < edge)) {
      sim.events.push('commandRejected', { type: cmd.type, reason: 'outOfBounds', tick });
      return;
    }
    const layer = cmd.layer as Layer;
    const tx = Math.floor(cmd.x / TILE_PX);
    const ty = Math.floor(cmd.y / TILE_PX);
    this.collision.ensureTiles(layer, tx - 1, ty - 1, tx + 1, ty + 1);
    const info = this.collision.grid.tileInfo(layer, tx, ty);
    const row = this.motion.position.add(sim.player);
    this.motion.position.columns.x[row] = cmd.x;
    this.motion.position.columns.y[row] = cmd.y;
    body.layer = layer;
    body.level = infoLevel(info);
    body.prevX = cmd.x;
    body.prevY = cmd.y;
    body.transit = 'none';
    body.rollTicks = 0;
    body.pushTicks = 0;
    body.swimming = (info & BLOCK_DEEP_WATER) !== 0;
  }
}
