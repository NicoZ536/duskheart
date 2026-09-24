/**
 * Sleep system (MASTERPROMPT §11.5, M3-24).
 *
 * - `sleep.start`: from 19:00 or with exhaustion above 60, not with an enemy within 20 tiles (threat
 *   providers: creatures later, the Nachtmahr's pursuit now), in a bed within reach (sleeping-place
 *   providers: the building system reports placed beds and grass beds) or on a sleeping bag from the bags.
 *   A bed (and a grass bed) sets the respawn point.
 * - While asleep: the player lies still (speed 0, a movement key or a roll wakes), counts as asleep (satiety
 *   ×0,5, no exhaustion gain, fear −5 per game hour) and, in a bed, as resting (health regeneration ×2);
 *   exhaustion falls by 100 in 8 game hours (half on a grass bed or sleeping bag); time runs ×30
 *   (`timeScale`, read by the frame driver).
 * - Waking: at 06:00; after a nap (begun outside the night) when exhaustion is 0; at once when a hit
 *   strikes (§11.5 "Angriffe wecken"), on `sleep.wake`, or at death. A completed sleep in a bed gives
 *   "Ausgeruht" (+10 % max. stamina, +25 % stamina regeneration, +5 % XP) for 8 min + 1 min per comfort
 *   point (×1,5 in a bedroom).
 * Global. Save participant `sleep`.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY, isEntityHandle, type Entity } from '../../engine/ecs';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { CommandOfType } from '../commands';
import type { ConditionsSystem } from '../conditions/system';
import type { PlayerHarm } from '../conditions/harm';
import type { InventorySystem } from '../inventory/system';
import type { SaveParticipant } from '../participant';
import type { PlayerComponents } from '../player/components';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { PlayerModifierSource } from '../survival/modifiers';
import type { MotionSystem } from '../systems/motion';
import type { SleepEnd, SleepRejectReason } from './events';
import { SLEEP_PLACE_KINDS, exhaustionRecoveryPerSecond, isNap, restedSeconds, sleepAllowed, sleepPlaceRules, sleepTimeScale } from './formulas';
import { slumberSchema, type SleepPlace, type Slumber } from './state';

/** Id of the sleep system and its save participant. */
export const SLEEP_SYSTEM_ID = 'sleep';
/** Data version of the `sleep` participant. */
export const SLEEP_SAVE_VERSION = 1;

const S = BALANCE.sleep;
const TICK_HZ = BALANCE.time.tickHz;
const REACH_PX = S.reachTiles * TILE_PX;
const ENEMY_RADIUS_PX = S.enemyRadiusTiles * TILE_PX;

const sleepSnapshotSchema = z
  .object({
    entity: z.number().int().refine((e) => e === NULL_ENTITY || isEntityHandle(e), { message: 'must be an entity handle or -1' }),
    slumber: slumberSchema.nullable(),
  })
  .strict();

/** The sleeping place on tile (tx, ty) of `layer`, or `null` (placed beds: the building system). */
export type SleepPlaceProvider = (sim: Simulation, layer: Layer, tx: number, ty: number) => SleepPlace | null;
/** Whether an enemy is within `radiusPx` of (x, y) on `layer` (creatures, the Nachtmahr). */
export type ThreatProvider = (sim: Simulation, layer: Layer, x: number, y: number, radiusPx: number) => boolean;
/** Called when a sleeping place that sets the respawn point is used (the death system keeps it). */
export type RespawnPointListener = (sim: Simulation, place: SleepPlace) => void;

/** Dependencies of the sleep system. */
export interface SleepSystemDeps {
  readonly components: PlayerComponents;
  readonly motion: MotionSystem;
  readonly conditions: ConditionsSystem;
  readonly harm: PlayerHarm;
  /** The bags (a carried sleeping bag). */
  readonly inventory: InventorySystem;
}

export class SleepSystem implements SimSystem {
  readonly id = SLEEP_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private readonly components: PlayerComponents;
  private readonly motion: MotionSystem;
  private readonly conditions: ConditionsSystem;
  private readonly harm: PlayerHarm;
  private readonly inventory: InventorySystem;
  private readonly places: SleepPlaceProvider[] = [];
  private readonly threats: ThreatProvider[] = [];
  private readonly respawnListeners: RespawnPointListener[] = [];
  private owner: Entity = NULL_ENTITY;
  private slumberValue: Slumber | null = null;
  private readonly pos = { x: 0, y: 0 };

  constructor(deps: SleepSystemDeps) {
    this.components = deps.components;
    this.motion = deps.motion;
    this.conditions = deps.conditions;
    this.harm = deps.harm;
    this.inventory = deps.inventory;
    this.commands = {
      'sleep.start': (sim, cmd, tick) => {
        const reason = this.start(sim, cmd, tick);
        if (reason !== null) sim.events.push('commandRejected', { type: cmd.type, reason, tick });
      },
      'sleep.wake': (sim, cmd, tick) => {
        if (this.playerOf(sim) === NULL_ENTITY) sim.events.push('commandRejected', { type: cmd.type, reason: 'noPlayer', tick });
        else if (this.slumberValue === null) sim.events.push('commandRejected', { type: cmd.type, reason: 'notAsleep', tick });
        else this.wake(sim, 'geweckt');
      },
    };
    this.save = {
      id: SLEEP_SYSTEM_ID,
      version: SLEEP_SAVE_VERSION,
      serialize: () => ({ entity: this.owner, slumber: this.slumberValue === null ? null : { ...this.slumberValue, place: { ...this.slumberValue.place } } }),
      deserialize: (data) => {
        const parsed = sleepSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`sleep snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        const { entity, slumber } = parsed.data;
        if (entity === NULL_ENTITY && slumber !== null) throw new TypeError('sleep snapshot invalid: a sleep without a player');
        this.owner = entity;
        this.slumberValue = slumber === null ? null : { ...slumber, place: { ...slumber.place } };
      },
    };
  }

  /** Whether the player sleeps. */
  get asleep(): boolean {
    return this.slumberValue !== null;
  }

  /** The sleep in progress, or `null`. */
  get slumber(): Readonly<Slumber> | null {
    return this.slumberValue;
  }

  /** Speed of time for the frame driver [factor]: ×30 while asleep (§11.5), else 1. */
  get timeScale(): number {
    return sleepTimeScale(this.slumberValue !== null);
  }

  /** Adds a provider of placed sleeping places (the building system: beds, grass beds). */
  addSleepPlaces(provider: SleepPlaceProvider): void {
    this.places.push(provider);
  }

  /** The sleeping place on tile (tx, ty) of `layer` a provider reports, or `null` (E on a bed, src/game/interaction/uses.ts). */
  placeAt(sim: Simulation, layer: Layer, tx: number, ty: number): SleepPlace | null {
    for (let i = 0; i < this.places.length; i++) {
      const place = (this.places[i] as SleepPlaceProvider)(sim, layer, tx, ty);
      if (place !== null) return place;
    }
    return null;
  }

  /** Adds a provider of threats that forbid sleep (creatures, the Nachtmahr). */
  addThreats(provider: ThreatProvider): void {
    this.threats.push(provider);
  }

  /** Adds a listener for sleeping places that set the respawn point. */
  onRespawnPoint(listener: RespawnPointListener): void {
    this.respawnListeners.push(listener);
  }

  /** Modifier source of the sleeper: asleep, resting in a bed, lying still. */
  modifierSource(): PlayerModifierSource {
    return (_sim, _player, out) => {
      const s = this.slumberValue;
      if (s === null) return;
      out.sleeping = true;
      if (sleepPlaceRules(s.place.kind).resting) out.resting = true;
      out.moveSpeedFactor = 0;
    };
  }

  /** Ends the sleep (death, an attack; `wake` of other systems). */
  wake(sim: Simulation, reason: SleepEnd): void {
    const s = this.slumberValue;
    if (s === null) return;
    this.slumberValue = null;
    const complete = reason === 'morgen' || reason === 'erholt';
    const rested = complete && sleepPlaceRules(s.place.kind).rested;
    if (rested) this.conditions.apply(sim, 'ausgeruht', restedSeconds(s.place.comfort, s.place.bedroom));
    sim.events.push('sleepEnded', { entity: this.owner, reason, rested, tick: sim.eventTick });
  }

  update(sim: Simulation, dt: number): void {
    const e = this.playerOf(sim);
    const s = this.slumberValue;
    if (s === null || e === NULL_ENTITY) return;
    const v = this.components.vitals.get(e);
    const body = this.components.body.get(e);
    if (v === undefined || body === undefined) {
      this.slumberValue = null;
      return;
    }
    if (v.health <= 0) {
      this.wake(sim, 'tod');
      return;
    }
    if (this.harm.hitThisTick(sim)) {
      this.wake(sim, 'angriff');
      return;
    }
    if (body.inputX !== 0 || body.inputY !== 0 || body.rollTicks > 0 || body.transit !== 'none' || body.swimming) {
      this.wake(sim, 'geweckt');
      return;
    }
    const secondsPerGameHour = sim.clock.ticksPerGameHour / TICK_HZ;
    v.exhaustion = Math.max(0, v.exhaustion - exhaustionRecoveryPerSecond(sleepPlaceRules(s.place.kind).recovery, secondsPerGameHour) * dt);
    if (sim.clock.dawns > s.dawns) this.wake(sim, 'morgen');
    else if (s.nap && v.exhaustion <= 0) this.wake(sim, 'erholt');
  }

  // -------------------------------------------------------------------------------------------

  /** Lies down; returns why not, or `null`. */
  private start(sim: Simulation, cmd: CommandOfType<'sleep.start'>, tick: number): SleepRejectReason | 'noPlayer' | 'busy' | null {
    const e = this.playerOf(sim);
    if (e === NULL_ENTITY) return 'noPlayer';
    const v = this.components.vitals.get(e);
    const body = this.components.body.get(e);
    if (v === undefined || body === undefined || !this.position(e)) return 'noPlayer';
    if (v.health <= 0) return 'dead';
    if (this.slumberValue !== null) return 'asleep';
    if (body.swimming || body.transit !== 'none' || body.rollTicks > 0) return 'busy';
    const hour = sim.clock.hour;
    if (!sleepAllowed(hour, v.exhaustion)) return 'tooEarly';
    const layer = body.layer;
    let place: SleepPlace | null = null;
    if (cmd.tx !== undefined && cmd.ty !== undefined) {
      place = this.placeAt(sim, layer, cmd.tx, cmd.ty);
      if (place === null) return 'noSleepPlace';
      const dx = place.x - this.pos.x;
      const dy = place.y - this.pos.y;
      if (place.layer !== layer || dx * dx + dy * dy > REACH_PX * REACH_PX) return 'outOfReach';
    } else {
      const kind = SLEEP_PLACE_KINDS.find((k) => sleepPlaceRules(k).portable && this.inventory.count(k) > 0);
      if (kind === undefined) return 'noSleepPlace';
      place = { kind, x: this.pos.x, y: this.pos.y, layer, comfort: 0, bedroom: false };
    }
    for (const threat of this.threats) if (threat(sim, layer, place.x, place.y, ENEMY_RADIUS_PX)) return 'enemiesNear';
    this.slumberValue = { place, nap: isNap(hour), sinceTick: tick, dawns: sim.clock.dawns };
    sim.events.push('sleepStarted', { entity: e, place: place.kind, x: place.x, y: place.y, layer: place.layer, nap: this.slumberValue.nap, tick });
    if (sleepPlaceRules(place.kind).respawn) for (const l of this.respawnListeners) l(sim, place);
    return null;
  }

  private position(e: Entity): boolean {
    const row = this.motion.position.indexOf(e);
    if (row < 0) return false;
    this.pos.x = this.motion.position.columns.x[row] as number;
    this.pos.y = this.motion.position.columns.y[row] as number;
    return true;
  }

  /** The player; a new player entity is awake. */
  private playerOf(sim: Simulation): Entity {
    const e = sim.player;
    if (e !== this.owner) {
      this.owner = e;
      this.slumberValue = null;
    }
    return e;
  }
}
