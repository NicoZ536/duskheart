/**
 * Motion system: integrates positions from velocities (docs/ARCHITEKTUR.md "ECS": hot components
 * as typed array columns) and owns the M0 movement commands.
 *
 * - Components `position` {x, y} [px] and `velocity` {vx, vy} [px/s], both `ColumnStore`s with
 *   f32 columns, registered in the ECS (serialized with the ECS snapshot).
 * - Every tick: `p += v · dt`; an entity that leaves the world rectangle is reflected back inside
 *   and its velocity component flips (elastic bounce). All arithmetic is plain IEEE add/multiply
 *   (no transcendental functions), so results are bit-identical on every platform.
 * - Commands: `spawnDebugMover` (random velocity from the `motion` stream unless given),
 *   `move` (steers the controlled entity at walking speed), `teleport` (debug console `tp`: puts the
 *   controlled entity on another spot and layer, M2-29).
 * - Save participant `motion` (version 2): the controlled entity handle and its world layer
 *   (version 1 had no layer: the surface).
 * - Global (`timeScope`, docs/ARCHITEKTUR.md "Aktive Zone"): the movers of M0 are not bound to
 *   chunks and move everywhere in the world every tick; the controlled entity is the focus of the
 *   active zone until the player entity exists (M3-08).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { ColumnStore, NULL_ENTITY, columnStoreSerializer, isEntityHandle, type Entity } from '../../engine/ecs';
import type { CommandOfType } from '../commands';
import type { Layer } from '../../world/model/coords';
import type { SaveMigration, SaveParticipant } from '../participant';
import type { CommandHandlers, SimConfig, SimSystem, Simulation } from '../sim';

/** ECS component name of positions. */
export const POSITION_COMPONENT = 'position';
/** ECS component name of velocities. */
export const VELOCITY_COMPONENT = 'velocity';
/** Random stream used for debug mover velocities. */
export const MOTION_RNG_STREAM = 'motion';
/** Data version of the `motion` save participant (2: with the layer of the controlled entity). */
export const MOTION_SAVE_VERSION = 2;

const POSITION_SCHEMA = { x: 'f32', y: 'f32' } as const;
const VELOCITY_SCHEMA = { vx: 'f32', vy: 'f32' } as const;

export type PositionStore = ColumnStore<typeof POSITION_SCHEMA>;
export type VelocityStore = ColumnStore<typeof VELOCITY_SCHEMA>;

/** Axis-aligned world rectangle [px]; entities stay inside [min, max]. */
export interface MotionBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** World rectangle of a config: (0, 0) to world size × tile size. */
export function worldBoundsPx(config: SimConfig): MotionBounds {
  const edge = BALANCE.world.sizeTiles[config.worldSize] * BALANCE.world.tilePx;
  return { minX: 0, minY: 0, maxX: edge, maxY: edge };
}

/** Deepest world layer the controlled entity can be on (docs/WORLD.md §1). */
const DEEPEST_LAYER: Layer = -3;

const motionSnapshotSchema = z
  .object({
    controlled: z.number().int().refine((e) => e === NULL_ENTITY || isEntityHandle(e), { message: 'must be an entity handle or -1' }),
    layer: z.number().int().min(DEEPEST_LAYER).max(0),
  })
  .strict();

/** Version 1 → 2: the controlled entity was always on the surface. */
const MOTION_MIGRATIONS: readonly SaveMigration[] = [
  {
    from: 1,
    migrate: (data) => (typeof data === 'object' && data !== null ? { ...(data as Record<string, unknown>), layer: 0 } : data),
  },
];

/** Reflects `v` into [min, max] (a single bounce, then clamped for extreme overshoots). */
function reflect(v: number, min: number, max: number): number {
  let r = v < min ? min + (min - v) : max - (v - max);
  if (r < min) r = min;
  else if (r > max) r = max;
  return r;
}

export class MotionSystem implements SimSystem {
  readonly id = 'motion';
  /** Movers are not bound to chunks (see module comment). */
  readonly timeScope = 'global';
  readonly position: PositionStore;
  readonly velocity: VelocityStore;
  readonly bounds: MotionBounds;
  readonly save: SaveParticipant;
  readonly commands: CommandHandlers;
  private controlledEntity: Entity = NULL_ENTITY;
  /** World layer of the controlled entity (the focus layer of the active zone). */
  private controlledLayerValue: Layer = 0;
  /** Walking speed [px/s]. */
  private readonly walkSpeed: number;
  /** Largest random velocity per axis [px/s]. */
  private readonly moverMaxSpeed: number;

  constructor(sim: Simulation) {
    this.position = sim.ecs.registerComponent(POSITION_COMPONENT, new ColumnStore(POSITION_SCHEMA), columnStoreSerializer<typeof POSITION_SCHEMA>());
    this.velocity = sim.ecs.registerComponent(VELOCITY_COMPONENT, new ColumnStore(VELOCITY_SCHEMA), columnStoreSerializer<typeof VELOCITY_SCHEMA>());
    this.bounds = worldBoundsPx(sim.config);
    this.walkSpeed = BALANCE.motion.walkSpeedTilesPerSecond * BALANCE.world.tilePx;
    this.moverMaxSpeed = BALANCE.motion.debugMoverMaxAxisSpeedTilesPerSecond * BALANCE.world.tilePx;
    sim.ecs.onDestroy((e) => {
      if (e === this.controlledEntity) this.controlledEntity = NULL_ENTITY;
    });
    this.commands = {
      spawnDebugMover: (s, cmd, tick) => this.handleSpawn(s, cmd, tick),
      move: (s, cmd, tick) => this.handleMove(s, cmd, tick),
      teleport: (s, cmd, tick) => this.handleTeleport(s, cmd, tick),
    };
    this.save = {
      id: 'motion',
      version: MOTION_SAVE_VERSION,
      migrations: MOTION_MIGRATIONS,
      serialize: () => ({ controlled: this.controlledEntity, layer: this.controlledLayerValue }),
      deserialize: (data) => {
        const parsed = motionSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`motion snapshot invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
        this.controlledEntity = parsed.data.controlled;
        this.controlledLayerValue = parsed.data.layer as Layer;
      },
    };
  }

  /** The entity steered by `move` commands, or `NULL_ENTITY`. */
  get controlled(): Entity {
    return this.controlledEntity;
  }

  /** World layer of the controlled entity (0 = surface; meaningless while none is controlled). */
  get controlledLayer(): Layer {
    return this.controlledLayerValue;
  }

  /**
   * Writes the position of the controlled entity [px] into `out`. Returns `false` (and leaves `out`)
   * when no live entity is controlled. Does not allocate (called every tick for the active zone).
   */
  controlledPosition(sim: Simulation, out: { x: number; y: number }): boolean {
    const e = this.controlledEntity;
    if (e === NULL_ENTITY || !sim.ecs.alive(e)) return false;
    const row = this.position.indexOf(e);
    if (row < 0) return false;
    out.x = this.position.columns.x[row] as number;
    out.y = this.position.columns.y[row] as number;
    return true;
  }

  /** Creates an entity with position and velocity. Returns its handle. */
  spawnMover(sim: Simulation, x: number, y: number, vx: number, vy: number): Entity {
    const e = sim.ecs.create();
    const p = this.position.add(e);
    this.position.columns.x[p] = x;
    this.position.columns.y[p] = y;
    const v = this.velocity.add(e);
    this.velocity.columns.vx[v] = vx;
    this.velocity.columns.vy[v] = vy;
    sim.events.push('entitySpawned', { entity: e, tick: sim.eventTick });
    return e;
  }

  update(_sim: Simulation, dt: number): void {
    const { minX, minY, maxX, maxY } = this.bounds;
    const vel = this.velocity;
    const pos = this.position;
    const { vx, vy } = vel.columns;
    const { x, y } = pos.columns;
    for (let i = 0; i < vel.size; i++) {
      const row = pos.indexOf(vel.entityAt(i));
      if (row < 0) continue;
      const vxi = vx[i] as number;
      const vyi = vy[i] as number;
      let nx = (x[row] as number) + vxi * dt;
      let ny = (y[row] as number) + vyi * dt;
      if (nx < minX || nx > maxX) {
        nx = reflect(nx, minX, maxX);
        vx[i] = -vxi;
      }
      if (ny < minY || ny > maxY) {
        ny = reflect(ny, minY, maxY);
        vy[i] = -vyi;
      }
      x[row] = nx;
      y[row] = ny;
    }
  }

  private inBounds(x: number, y: number): boolean {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  }

  private handleSpawn(sim: Simulation, cmd: CommandOfType<'spawnDebugMover'>, tick: number): void {
    if (!this.inBounds(cmd.x, cmd.y)) {
      sim.events.push('commandRejected', { type: cmd.type, reason: 'outOfBounds', tick });
      return;
    }
    const controlled = cmd.controlled === true;
    let vx = cmd.vx;
    let vy = cmd.vy;
    if (controlled) {
      vx ??= 0;
      vy ??= 0;
    } else if (vx === undefined || vy === undefined) {
      const rng = sim.rng.stream(MOTION_RNG_STREAM);
      // Always draw both axes in the same order, even if one is given, so the stream advances equally.
      const rx = rng.float(-this.moverMaxSpeed, this.moverMaxSpeed);
      const ry = rng.float(-this.moverMaxSpeed, this.moverMaxSpeed);
      vx ??= rx;
      vy ??= ry;
    }
    const e = this.spawnMover(sim, cmd.x, cmd.y, vx, vy);
    if (controlled) {
      this.controlledEntity = e;
      this.controlledLayerValue = 0;
    }
  }

  /** Puts the controlled entity on (x, y) of `layer`; it keeps its velocity (a held key keeps walking). */
  private handleTeleport(sim: Simulation, cmd: CommandOfType<'teleport'>, tick: number): void {
    const e = this.controlledEntity;
    if (e === NULL_ENTITY || !sim.ecs.alive(e)) {
      sim.events.push('commandRejected', { type: cmd.type, reason: 'noControlledEntity', tick });
      return;
    }
    if (!this.inBounds(cmd.x, cmd.y)) {
      sim.events.push('commandRejected', { type: cmd.type, reason: 'outOfBounds', tick });
      return;
    }
    const row = this.position.add(e);
    this.position.columns.x[row] = cmd.x;
    this.position.columns.y[row] = cmd.y;
    this.controlledLayerValue = cmd.layer as Layer;
  }

  private handleMove(sim: Simulation, cmd: CommandOfType<'move'>, tick: number): void {
    const e = this.controlledEntity;
    if (e === NULL_ENTITY || !sim.ecs.alive(e)) {
      sim.events.push('commandRejected', { type: cmd.type, reason: 'noControlledEntity', tick });
      return;
    }
    let dx = cmd.dx;
    let dy = cmd.dy;
    const len2 = dx * dx + dy * dy;
    if (len2 > 1) {
      const len = Math.sqrt(len2);
      dx /= len;
      dy /= len;
    }
    const row = this.velocity.add(e);
    this.velocity.columns.vx[row] = dx * this.walkSpeed;
    this.velocity.columns.vy[row] = dy * this.walkSpeed;
  }
}
