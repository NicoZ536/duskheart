/**
 * A running game session: the simulation plus the input chain that feeds it (docs/ARCHITEKTUR.md
 * "Datenfluss"). DOM free — the browser composition root attaches the DOM input adapter to
 * `input` and drives the session from the `FixedStepLoop`:
 *   `beginFrame()` once per frame (gamepads → actions → commands),
 *   `step()` once per 60 Hz tick (commands → systems → events drained for the presentation).
 * Debug tools and E2E tests read `debugState()` and push commands through `command()`, which
 * validates them exactly like a replay file. The presentation (UI bridge, later audio and
 * particles) reads `sampleStatus()` once per frame without allocating and subscribes to the
 * drained simulation events with `onEvent()`.
 *
 * The figure the input steers and the camera follows is the player (M3-08, `sim.player`); without a
 * player it is the controlled debug mover of M2. The game view reads the player with `samplePlayer()`
 * and `sampleFocus()`, interpolated between the last two ticks by the alpha of the rendered frame
 * (`setFrameAlpha`, docs/ARCHITEKTUR.md "Datenfluss": the renderer interpolates, pixel snapping after).
 */
import type { PlayerMoveState } from '../content/balance/player';
import type { TemperatureStage } from '../content/balance/survival';
import { NULL_ENTITY, type Entity } from '../engine/ecs';
import { EventBus } from '../engine/events';
import { DEFAULT_BINDINGS, BindingSet } from '../engine/input/bindings';
import { pollGamepads, type GamepadGetter } from '../engine/input/gamepad';
import { ActionReader } from '../engine/input/reader';
import { InputState } from '../engine/input/state';
import type { Settings } from '../engine/settings';
import { parseGameCommand, type GameCommand } from './commands';
import { InputCommandTranslator } from './input';
import type { Facing, PlayerBody } from './player/state';
import { PlayerSystem } from './player/system';
import type { Vitals } from './survival/state';
import { aggregateEquipmentStats, type EquipmentStats } from './equipment/formulas';
import { EquipmentSystem } from './equipment/system';
import { emptyBags, type BagsState } from './inventory/bags';
import { InventorySystem } from './inventory/system';
import type { FearStage } from '../content/balance/fear';
import { UNTIMED } from './conditions/state';
import { ConditionsSystem } from './conditions/system';
import { FearSystem } from './fear/system';
import { copyFocus, createInteractionFocus, InteractionSystem, type InteractionFocus } from './interaction/system';
import type { SlotRef } from './items/slots';
import { torchBurnRate, torchBurnTicks } from './light/formulas';
import { LightSystem } from './light/system';
import { SleepSystem } from './sleep/system';
import { CheatsSystem } from './cheats/system';
import type { Grave } from './death/state';
import { DeathSystem } from './death/system';
import type { WeatherStateId } from '../content/weather';
import type { Season } from '../world/calendar';
import { createWeatherSample } from '../world/climate/weather';
import type { ChunkData } from '../world/model/chunk';
import { createSimulation, type SimulationOptions } from './setup';
import { SIM_EVENT_TYPES, type SimConfigInput, type SimEventMap, type Simulation } from './sim';
import { MotionSystem } from './systems/motion';
import { NO_WEATHER_REGION } from '../world/climate/temperature';
import { pxToTile, tileLocalIndex, tileToChunk, type Layer } from '../world/model/coords';
import { contentWorldIdTables } from '../world/model/runtimeIds';

/**
 * World seed of the session the browser starts at boot. It is fixed so screenshots and E2E runs
 * see the same world (§31.5 "fester Seed"; any fixed value works, this one is the project's start
 * date); debug mode can override it with `?seed=<n>`.
 */
export const BOOT_SESSION_SEED = 20_260_923;

/** Control settings the session applies to its input chain. */
export type ControlSettings = Settings['controls'];

/** The world as `__dh.state().sim.world` shows it (only parts that are already built are read). */
export interface SessionWorldDebugState {
  /** The generated world is in use (chunk store and active zone exist). */
  readonly ready: boolean;
  /** Focus of the active zone: layer and tile of the controlled entity, or `null`. */
  readonly focus: { readonly layer: number; readonly tx: number; readonly ty: number } | null;
  readonly season: string;
  readonly dayOfSeason: number;
  readonly year: number;
  /** Moon phase of the current night (0 = Finstermond … 4 = full moon). */
  readonly moonPhase: number;
  /** Weather region and state at the focus (surface only; `null` without focus, at sea or before the plan exists). */
  readonly weather: { readonly region: number; readonly state: string } | null;
  /** Temperature at the focus tile [°C] (`null` without focus or before the plan exists). */
  readonly temperatureC: number | null;
  /** Biome of the focus tile (`null` without focus or while its chunk is not resident). */
  readonly biome: string | null;
  /** Active chunks of the zone, resident and loading chunks of the chunk store (0 before `ready`). */
  readonly activeChunks: number;
  readonly residentChunks: number;
  readonly loadingChunks: number;
}

/** Plain, JSON-compatible view of the session for `__dh.state()` and inspectors. */
export interface SessionDebugState {
  readonly seed: number;
  readonly worldSize: string;
  readonly tick: number;
  readonly day: number;
  /** Time of day as `HH:MM`. */
  readonly time: string;
  readonly entities: number;
  /** The figure the input steers (the player; without one the controlled debug mover) and its position [px], or `null`. */
  readonly controlled: { readonly entity: number; readonly x: number; readonly y: number } | null;
  /** The player (M3-08): body and survival values, or `null` before it spawned. */
  readonly player: SessionPlayerDebugState | null;
  /** Commands waiting for the next tick. */
  readonly queuedCommands: number;
  /** Events drained since the session started, per type. */
  readonly events: Readonly<Record<keyof SimEventMap, number>>;
  readonly world: SessionWorldDebugState;
  /** The console's cheats (M3-35, src/game/cheats/system.ts). */
  readonly cheats: { readonly god: boolean; readonly noclip: boolean };
}

/** The player as `__dh.state().sim.player` shows it. */
export interface SessionPlayerDebugState {
  readonly entity: number;
  /** Position [px] after the last tick. */
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly level: number;
  readonly state: PlayerMoveState;
  readonly facing: Facing;
  /** Tick in which the current movement mode began (input takes effect in the tick after the frame that read it). */
  readonly stateSince: number;
  readonly swimming: boolean;
  /** Velocity of the last tick [px/s]. */
  readonly vx: number;
  readonly vy: number;
  readonly health: number;
  readonly stamina: number;
  readonly satiety: number;
  readonly thirst: number;
  readonly wetness: number;
  readonly exhaustion: number;
  readonly coreC: number;
  readonly feltC: number;
  readonly temperatureStage: TemperatureStage;
}

/**
 * The player for the presentation (sprite, camera, HUD), sampled once per frame by `samplePlayer` into
 * a record the caller owns (no allocation).
 */
export interface PlayerSample {
  entity: Entity;
  /** Position [world px], interpolated between the last two ticks with the frame's alpha. */
  x: number;
  y: number;
  layer: Layer;
  /** Height level of the tile under the player. */
  level: number;
  state: PlayerMoveState;
  facing: Facing;
  /** Time in the current movement mode [s] (ticks + frame alpha): the clock of its animation. */
  stateSeconds: number;
  /** Speed of the last tick [px/s]. */
  speed: number;
  swimming: boolean;
  invulnerable: boolean;
  /** Progress 0–1 of a roll, jump or climb in progress (0 otherwise). */
  actionProgress: number;
  /** Height levels a jump or climb starts and ends on (both `level` otherwise). */
  transitFromLevel: number;
  transitToLevel: number;
  /** Noise of the movement relative to walking (§11.4). */
  noise: number;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  satiety: number;
  thirst: number;
  /** 0–100 %. */
  wetness: number;
  exhaustion: number;
  /** Core temperature, felt temperature and its parts, comfort band [°C], core trend [°C/s] (HUD thermometer, §11.2). */
  coreC: number;
  feltC: number;
  ambientC: number;
  heatC: number;
  roomC: number;
  bandLowC: number;
  bandHighC: number;
  coreRateCps: number;
  temperatureStage: TemperatureStage;
  /** Time since the last damage [s] (HUD: how long until health regenerates, §11.1 "5 s kein Schaden"). */
  damageFreeSeconds: number;
}

/** A fresh `PlayerSample` to pass to `GameSession.samplePlayer`. */
export function createPlayerSample(): PlayerSample {
  return {
    entity: NULL_ENTITY,
    x: 0,
    y: 0,
    layer: 0,
    level: 0,
    state: 'idle',
    facing: 'down',
    stateSeconds: 0,
    speed: 0,
    swimming: false,
    invulnerable: false,
    actionProgress: 0,
    transitFromLevel: 0,
    transitToLevel: 0,
    noise: 0,
    health: 0,
    maxHealth: 0,
    stamina: 0,
    maxStamina: 0,
    satiety: 0,
    thirst: 0,
    wetness: 0,
    exhaustion: 0,
    coreC: 0,
    feltC: 0,
    ambientC: 0,
    heatC: 0,
    roomC: 0,
    bandLowC: 0,
    bandHighC: 0,
    coreRateCps: 0,
    temperatureStage: 'normal',
    damageFreeSeconds: 0,
  };
}

/** Where the controlled entity is (see `GameSession.sampleFocus`); owned by the caller. */
export interface SessionFocus {
  /** Position [world px]. */
  x: number;
  y: number;
  layer: Layer;
}

/**
 * Status of the session for the per-frame presentation read (UI bridge). The record is owned by the
 * caller and overwritten in place by `sampleStatus`, so sampling every frame allocates nothing.
 */
export interface SessionStatus {
  /** Completed simulation ticks. */
  tick: number;
  /** Day number (from 1). */
  day: number;
  /** Game minute of the day, 0–1439. */
  minuteOfDay: number;
  /** Live entities. */
  entities: number;
  /** The figure the input steers (the player; without one the controlled debug mover), or `NULL_ENTITY` (then the position is 0, 0). */
  controlled: Entity;
  /** Position of the controlled entity [px]. */
  controlledX: number;
  controlledY: number;
}

/** A fresh `SessionStatus` to pass to `GameSession.sampleStatus`. */
export function createSessionStatus(): SessionStatus {
  return { tick: 0, day: 0, minuteOfDay: 0, entities: 0, controlled: NULL_ENTITY, controlledX: 0, controlledY: 0 };
}

/**
 * The player's bags for the presentation (inventory screen, HUD hotbar), filled by
 * `GameSession.sampleBags` into a record the caller owns (no allocation). The bag state is immutable
 * and replaced on every change, so comparing `revision` (or the state's identity) tells whether
 * anything changed.
 */
export interface BagsSample {
  /** Inventory, hotbar with its selection, backpack slot and compartment, equipment, belt. */
  state: BagsState;
  /** Counts every change of the bags. */
  revision: number;
  /** Aggregated stats of the worn equipment (cached per revision by the equipment system). */
  stats: EquipmentStats;
}

/** A fresh `BagsSample` (empty bags) to pass to `GameSession.sampleBags`. */
export function createBagsSample(): BagsSample {
  return { state: emptyBags(), revision: -1, stats: aggregateEquipmentStats([]) };
}

/** One active condition of the player for the HUD (M3-27): icon `zustand_<id>`, stacks and timer. */
export interface ConditionSample {
  /** Condition id (content src/content/conditions.ts). */
  id: string;
  stacks: number;
  /** Remaining time [s]; −1 for conditions without an end of their own (cured, or held by a survival value). */
  remainingSeconds: number;
}

/**
 * The light the player carries (§12.2, the HUD's off-hand timer): the bag slot of the torch, whether it
 * burns, and its remaining burn time. `slot` is `null` while no light is carried (then the rest is stale).
 */
export interface CarriedLightSample {
  slot: SlotRef | null;
  lit: boolean;
  /** Carried on the belt (two-hander or shield in the other hand: less light, §12.2). */
  belt: boolean;
  /** Remaining burn time [s] at the current burn speed (rain burns faster, §10). */
  restSeconds: number;
  /** Remaining share of a fresh torch's burn time (0–1). */
  share: number;
  /** Burn speed [× normal]: 1 dry, 2 in rain. */
  rate: number;
}

/**
 * What the HUD shows besides the survival values (M3-27): fear (§12.3, the eye from 20), the active
 * conditions (§11.3, content order), the interaction target in focus (§26 "[E] Aufheben: Feuerstein
 * ×3") and the carried light, filled by `GameSession.sampleHud` into a record the caller owns. Only the
 * first `conditionCount` entries of `conditions` are valid; the records are reused (no allocation once
 * the list reached its largest size).
 */
export interface HudSample {
  /** Fear 0–100. */
  fear: number;
  fearStage: FearStage;
  conditions: ConditionSample[];
  conditionCount: number;
  focus: InteractionFocus;
  light: CarriedLightSample;
}

/** A fresh `HudSample` to pass to `GameSession.sampleHud`. */
export function createHudSample(): HudSample {
  return {
    fear: 0,
    fearStage: 'ruhig',
    conditions: [],
    conditionCount: 0,
    focus: createInteractionFocus(),
    light: { slot: null, lit: false, belt: false, restSeconds: 0, share: 0, rate: 1 },
  };
}

/**
 * Sky, calendar and weather for the HUD's map (M3-28: day disc, day, season, weather), filled by
 * `GameSession.sampleSky` into a record the caller owns (no allocation). Day times are hours of the day.
 */
export interface SkySample {
  day: number;
  minuteOfDay: number;
  season: Season;
  dayOfSeason: number;
  /** Moon phase 0–7 (§10). */
  moonPhase: number;
  /** Start of the morning twilight, sunrise, sunset and end of the evening twilight [h] (§10). */
  dawnStart: number;
  sunrise: number;
  sunset: number;
  duskEnd: number;
  /** Weather over the asked surface tile – the state that prevails in a blend – or `null` (underground, no tile asked, no world plan yet). */
  weather: WeatherStateId | null;
}

/** A fresh `SkySample` to pass to `GameSession.sampleSky`. */
export function createSkySample(): SkySample {
  return { day: 0, minuteOfDay: 0, season: 'fruehling', dayOfSeason: 0, moonPhase: 0, dawnStart: 0, sunrise: 0, sunset: 0, duskEnd: 0, weather: null };
}

/** A grave of the player for map markers (§11.6 "auf der Karte markiert"): position [world px] and layer. */
export interface GraveSample {
  x: number;
  y: number;
  layer: Layer;
}

/** Blend share from which the incoming weather state is the one shown (a front half past counts as arrived). */
const WEATHER_SHOWN_FROM_BLEND = 0.5;

/** Handler for one drained simulation event type (see `GameSession.onEvent`). */
export type SessionEventHandler<K extends keyof SimEventMap> = (payload: SimEventMap[K]) => void;

/** Options of `GameSession`. */
export interface GameSessionOptions {
  readonly config: SimConfigInput;
  /** Gamepad source (browser: `() => navigator.getGamepads()`); without it gamepads are not polled. */
  readonly getGamepads?: GamepadGetter;
  /**
   * How the simulation gets its world (src/game/world.ts): the world from the world worker and the
   * chunk job queue with a worker executor and a real clock. Without them the world is generated in
   * this thread when first needed.
   */
  readonly simulation?: SimulationOptions;
}

function twoDigits(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export class GameSession {
  readonly sim: Simulation;
  readonly input = new InputState();
  readonly reader: ActionReader;
  private readonly translator = new InputCommandTranslator();
  private readonly motion: MotionSystem;
  private readonly player: PlayerSystem;
  private readonly sleep: SleepSystem;
  private readonly cheats: CheatsSystem;
  /** Interpolation factor of the rendered frame between the last two ticks (`setFrameAlpha`). */
  private frameAlpha = 0;
  private readonly playerPos = { x: 0, y: 0 };
  private readonly getGamepads: GamepadGetter | undefined;
  private readonly eventCounts: Record<keyof SimEventMap, number>;
  /** Drained events, re-emitted for presentation subscribers (`onEvent`). */
  private readonly drainedEvents = new EventBus<SimEventMap>();
  /** Drain callback created once (no closure per tick). */
  private readonly dispatchEvent: (type: keyof SimEventMap, payload: unknown) => void;
  /** Inventory and equipment system, looked up on the first `sampleBags`. */
  private bagSystems: { readonly inventory: InventorySystem; readonly equipment: EquipmentSystem } | null = null;
  /** The death system (graves), looked up on the first `sampleGraves`. */
  private death: DeathSystem | null = null;
  /** Weather of the map's tile (`sampleSky`), reused. */
  private readonly weatherScratch = createWeatherSample();
  /** Condition, fear and interaction system, looked up on the first `sampleHud`. */
  private hudSystems: { readonly conditions: ConditionsSystem; readonly fear: FearSystem; readonly interaction: InteractionSystem; readonly light: LightSystem } | null = null;

  constructor(options: GameSessionOptions) {
    this.sim = createSimulation(options.config, options.simulation);
    const motion = this.sim.system('motion');
    if (!(motion instanceof MotionSystem)) throw new Error('GameSession: the simulation has no motion system');
    this.motion = motion;
    const player = this.sim.system('player');
    if (!(player instanceof PlayerSystem)) throw new Error('GameSession: the simulation has no player system');
    this.player = player;
    const sleep = this.sim.system('sleep');
    if (!(sleep instanceof SleepSystem)) throw new Error('GameSession: the simulation has no sleep system');
    this.sleep = sleep;
    const cheats = this.sim.system('cheats');
    if (!(cheats instanceof CheatsSystem)) throw new Error('GameSession: the simulation has no cheat system');
    this.cheats = cheats;
    this.reader = new ActionReader(this.input, new BindingSet(DEFAULT_BINDINGS));
    this.getGamepads = options.getGamepads;
    this.eventCounts = Object.fromEntries(SIM_EVENT_TYPES.map((t) => [t, 0])) as Record<keyof SimEventMap, number>;
    // The queue delivers each payload together with its own type, so re-emitting it untyped is sound.
    const emit = this.drainedEvents.emit.bind(this.drainedEvents) as (type: keyof SimEventMap, payload: unknown) => void;
    this.dispatchEvent = (type, payload) => {
      this.eventCounts[type]++;
      emit(type, payload);
    };
  }

  /** Applies binding overrides, hold/toggle modes, sensitivities and the stick deadzone. */
  applyControls(controls: ControlSettings): void {
    this.reader.bindings = new BindingSet(DEFAULT_BINDINGS, controls.bindings);
    this.reader.setMode('sprint', controls.sprintMode);
    this.reader.setMode('sneak', controls.sneakMode);
    this.reader.setMode('block', controls.blockMode);
    this.reader.setSensitivity(controls.mouseSensitivity, controls.stickSensitivity);
    this.input.setDeadzone(controls.stickDeadzone);
  }

  /**
   * Speed of time the simulation asks for [factor] (§11.5 "Zeit läuft ×30" while the player sleeps, else 1).
   * The frame driver multiplies it with the game speed of the settings once per frame
   * (`FixedStepLoop.setTimeScale`); the simulation itself keeps its fixed tick.
   */
  get timeScale(): number {
    return this.sleep.timeScale;
  }

  /** Once per frame before the ticks: poll gamepads, evaluate actions, turn them into commands. */
  beginFrame(): void {
    if (this.getGamepads !== undefined) pollGamepads(this.input, this.getGamepads);
    this.reader.update();
    this.translator.translate(this.reader, this.sim.commands, this.hasPlayer() ? 'player' : 'mover');
    this.input.endFrame();
  }

  /** One simulation tick; its events are drained afterwards and passed to the `onEvent` handlers. */
  step(): void {
    this.sim.step();
    this.sim.events.drain(this.dispatchEvent);
  }

  /**
   * Subscribes to one simulation event type. The handler runs right after the tick that produced
   * the event, in push order; it only reads (changes go through `command`). Returns an
   * unsubscribe function.
   */
  onEvent<K extends keyof SimEventMap>(type: K, handler: SessionEventHandler<K>): () => void {
    return this.drainedEvents.on(type, handler);
  }

  /** Fills `out` with the current status (no allocation; meant for once per rendered frame). Returns `out`. */
  sampleStatus(out: SessionStatus): SessionStatus {
    const clock = this.sim.clock;
    out.tick = this.sim.tick;
    out.day = clock.day;
    out.minuteOfDay = clock.minuteOfDay;
    out.entities = this.sim.ecs.count;
    const e = this.hasPlayer() ? this.sim.player : this.motion.controlled;
    if (this.sim.ecs.alive(e) && this.motion.position.has(e)) {
      out.controlled = e;
      out.controlledX = this.motion.position.get(e, 'x');
      out.controlledY = this.motion.position.get(e, 'y');
    } else {
      out.controlled = NULL_ENTITY;
      out.controlledX = 0;
      out.controlledY = 0;
    }
    return out;
  }

  /**
   * Validates `raw` as a game command and queues it for the next tick (debug API, tests).
   * Throws `TypeError` for malformed commands. Returns the queued command.
   */
  command(raw: unknown): GameCommand {
    const cmd = parseGameCommand(raw);
    this.sim.commands.push(cmd);
    // A newly controlled entity must receive the direction of keys that are already held.
    if (cmd.type === 'spawnDebugMover' && cmd.controlled === true) this.translator.resync();
    return cmd;
  }

  /**
   * Writes position and layer of the figure into `out` (camera and figure of the game view, once per
   * frame; no allocation): the player, interpolated with the frame's alpha, or without a player the
   * controlled debug mover. Returns false – leaving `out` – while there is neither.
   */
  sampleFocus(out: SessionFocus): boolean {
    const body = this.playerBody();
    if (body !== undefined && this.player.position(this.sim, this.playerPos)) {
      out.x = body.prevX + (this.playerPos.x - body.prevX) * this.frameAlpha;
      out.y = body.prevY + (this.playerPos.y - body.prevY) * this.frameAlpha;
      out.layer = body.layer;
      return true;
    }
    if (!this.motion.controlledPosition(this.sim, out)) return false;
    out.layer = this.motion.controlledLayer;
    return true;
  }

  /**
   * Interpolation factor of the frame about to be rendered, in [0, 1] (`FixedStepLoop.render(alpha)`);
   * the samples of the player lie that far between the last two ticks.
   */
  setFrameAlpha(alpha: number): void {
    this.frameAlpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  }

  /**
   * Fills `out` with the player for the presentation (once per frame, no allocation). Returns false –
   * leaving `out` – while there is no player.
   */
  samplePlayer(out: PlayerSample): boolean {
    const body = this.playerBody();
    const v = this.playerVitals();
    if (body === undefined || v === undefined || !this.player.position(this.sim, this.playerPos)) return false;
    const a = this.frameAlpha;
    const tickHz = this.sim.clock.tickHz;
    out.entity = this.sim.player;
    out.x = body.prevX + (this.playerPos.x - body.prevX) * a;
    out.y = body.prevY + (this.playerPos.y - body.prevY) * a;
    out.layer = body.layer;
    out.level = body.level;
    out.state = body.state;
    out.facing = body.facing;
    out.stateSeconds = (body.stateTicks + a) / tickHz;
    out.speed = Math.hypot(body.vx, body.vy);
    out.swimming = body.swimming;
    out.invulnerable = body.invulnerableTicks > 0;
    out.transitFromLevel = body.level;
    out.transitToLevel = body.level;
    if (body.transit !== 'none') {
      out.actionProgress = Math.min(1, (body.transitTicks + a) / body.transitTotal);
      out.transitToLevel = body.transitToLevel;
      out.transitFromLevel = body.transit === 'jump' ? body.transitToLevel + body.transitLevels : body.transitToLevel - body.transitLevels;
    } else if (body.state === 'roll') out.actionProgress = Math.min(1, (body.stateTicks + a) / this.player.rollDurationTicks);
    else out.actionProgress = 0;
    out.noise = body.noise;
    out.health = v.health;
    out.maxHealth = v.maxHealth;
    out.stamina = v.stamina;
    out.maxStamina = v.maxStamina;
    out.satiety = v.satiety;
    out.thirst = v.thirst;
    out.wetness = v.wetness;
    out.exhaustion = v.exhaustion;
    out.coreC = v.coreC;
    out.feltC = v.feltC;
    out.ambientC = v.ambientC;
    out.heatC = v.heatC;
    out.roomC = v.roomC;
    out.bandLowC = v.bandLowC;
    out.bandHighC = v.bandHighC;
    out.coreRateCps = v.coreRateCps;
    out.temperatureStage = v.temperatureStage;
    out.damageFreeSeconds = (v.damageFreeTicks + a) / tickHz;
    return true;
  }

  /**
   * Fills `out` with the player's bags and the aggregated stats of the worn equipment (once per frame
   * for the UI bridge; no allocation). Returns `out`.
   */
  sampleBags(out: BagsSample): BagsSample {
    if (this.bagSystems === null) {
      const inventory = this.sim.system('inventory');
      const equipment = this.sim.system('equipment');
      if (!(inventory instanceof InventorySystem) || !(equipment instanceof EquipmentSystem)) throw new Error('GameSession: the simulation has no inventory or equipment system');
      this.bagSystems = { inventory, equipment };
    }
    const { inventory, equipment } = this.bagSystems;
    out.state = inventory.state;
    out.revision = inventory.bags.revision;
    out.stats = equipment.stats();
    return out;
  }

  /**
   * Fills `out` with fear, the active conditions and the interaction focus of the player (once per frame
   * for the UI bridge's HUD signals; no allocation once the condition list reached its largest size).
   * Returns false – leaving `out` – while there is no player.
   */
  sampleHud(out: HudSample): boolean {
    if (!this.hasPlayer()) return false;
    if (this.hudSystems === null) {
      const conditions = this.sim.system('conditions');
      const fear = this.sim.system('fear');
      const interaction = this.sim.system('interaction');
      const light = this.sim.system('light');
      if (!(conditions instanceof ConditionsSystem) || !(fear instanceof FearSystem) || !(interaction instanceof InteractionSystem) || !(light instanceof LightSystem)) {
        throw new Error('GameSession: the simulation has no condition, fear, interaction or light system');
      }
      this.hudSystems = { conditions, fear, interaction, light };
    }
    const { conditions, fear, interaction, light } = this.hudSystems;
    const f = fear.state;
    out.fear = f.value;
    out.fearStage = f.stage;
    const active = conditions.active();
    const tickHz = this.sim.clock.tickHz;
    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      if (a === undefined) continue;
      let c = out.conditions[i];
      if (c === undefined) {
        c = { id: '', stacks: 0, remainingSeconds: 0 };
        out.conditions.push(c);
      }
      c.id = a.id;
      c.stacks = a.stacks;
      c.remainingSeconds = a.remainingTicks === UNTIMED ? UNTIMED : a.remainingTicks / tickHz;
    }
    out.conditionCount = active.length;
    copyFocus(interaction.focus, out.focus);
    const carried = light.carried;
    const l = out.light;
    if (carried === null) l.slot = null;
    else {
      const b = carried.burn;
      l.slot = carried.ref;
      l.lit = b.lit;
      l.belt = carried.mode === 'guertel';
      l.rate = torchBurnRate(b.rain);
      l.restSeconds = b.rest / l.rate / tickHz;
      l.share = Math.min(1, b.rest / torchBurnTicks(this.sim.clock.ticksPerGameHour));
    }
    return true;
  }

  /**
   * Fills `out` with calendar, day times and – when `layer` is given – the weather over tile (tx, ty) of
   * that layer (the HUD's map, M3-28; once per frame, no allocation). Read-only: it never generates the
   * world plan or the world (without a plan there is no weather yet). Returns `out`.
   */
  sampleSky(out: SkySample, layer: Layer | null = null, tx = 0, ty = 0): SkySample {
    const clock = this.sim.clock;
    const w = this.sim.world;
    const cal = w.calendar;
    out.day = clock.day;
    out.minuteOfDay = clock.minuteOfDay;
    out.season = cal.season;
    out.dayOfSeason = cal.dayOfSeason;
    out.moonPhase = cal.moonPhase;
    const times = cal.dayTimes;
    out.dawnStart = times.dawnStart;
    out.sunrise = times.sunrise;
    out.sunset = times.sunset;
    out.duskEnd = times.duskEnd;
    out.weather = null;
    if (layer === 0 && w.planned) {
      const region = w.regionAt(tx, ty);
      if (region !== NO_WEATHER_REGION) {
        const smp = w.weather.sample(region, this.weatherScratch);
        out.weather = smp.blend >= WEATHER_SHOWN_FROM_BLEND ? smp.state : smp.previous;
      }
    }
    return out;
  }

  /**
   * A resident chunk of the session's world for the map (read-only), or `undefined` – before the world
   * exists or while the chunk is not loaded. Never generates anything.
   */
  mapChunk(layer: Layer, cx: number, cy: number): Readonly<ChunkData> | undefined {
    const w = this.sim.world;
    return w.materialized ? w.chunks.get(layer, cx, cy) : undefined;
  }

  /** Writes the start beach's tile (§8, §11.6) into `out`; false – leaving `out` – before the world exists. */
  startBeach(out: { tx: number; ty: number }): boolean {
    const w = this.sim.world;
    if (!w.materialized) return false;
    const spawn = w.generated.spawn;
    out.tx = spawn.x;
    out.ty = spawn.y;
    return true;
  }

  /**
   * Fills `out` with the player's graves (§11.6 "Grab … auf der Karte markiert, bleibt bis geleert"; the map
   * markers) and returns their count; only the first `count` records are valid, they are reused (no
   * allocation once the list reached its largest size).
   */
  sampleGraves(out: GraveSample[]): number {
    if (this.death === null) {
      const death = this.sim.system('death');
      if (!(death instanceof DeathSystem)) throw new Error('GameSession: the simulation has no death system');
      this.death = death;
    }
    const graves = this.death.state.graves;
    for (let i = 0; i < graves.length; i++) {
      const g = graves[i] as Grave;
      let o = out[i];
      if (o === undefined) {
        o = { x: 0, y: 0, layer: 0 };
        out.push(o);
      }
      o.x = g.x;
      o.y = g.y;
      o.layer = g.layer as Layer;
    }
    return graves.length;
  }

  /** Whether the player exists (the input then steers it). */
  private hasPlayer(): boolean {
    return this.sim.player !== NULL_ENTITY && this.sim.ecs.alive(this.sim.player);
  }

  private playerBody(): PlayerBody | undefined {
    return this.hasPlayer() ? this.player.body(this.sim) : undefined;
  }

  private playerVitals(): Vitals | undefined {
    const e = this.sim.player;
    return this.hasPlayer() ? this.player.vitalsOf(e) : undefined;
  }

  /** Player part of `debugState` (allocates). */
  private playerDebugState(): SessionPlayerDebugState | null {
    const body = this.playerBody();
    const v = this.playerVitals();
    if (body === undefined || v === undefined || !this.player.position(this.sim, this.playerPos)) return null;
    return {
      entity: this.sim.player,
      x: this.playerPos.x,
      y: this.playerPos.y,
      layer: body.layer,
      level: body.level,
      state: body.state,
      facing: body.facing,
      stateSince: this.sim.tick - 1 - body.stateTicks,
      swimming: body.swimming,
      vx: body.vx,
      vy: body.vy,
      health: v.health,
      stamina: v.stamina,
      satiety: v.satiety,
      thirst: v.thirst,
      wetness: v.wetness,
      exhaustion: v.exhaustion,
      coreC: v.coreC,
      feltC: v.feltC,
      temperatureStage: v.temperatureStage,
    };
  }

  /** World part of `debugState` (reads only what is built: never generates the world or its plan). */
  private worldDebugState(focus: SessionFocus | null): SessionWorldDebugState {
    const w = this.sim.world;
    const cal = w.calendar;
    const tile = focus === null ? null : { layer: focus.layer, tx: pxToTile(focus.x), ty: pxToTile(focus.y) };
    let weather: SessionWorldDebugState['weather'] = null;
    let temperatureC: number | null = null;
    if (w.planned && tile !== null) {
      temperatureC = w.temperature.temperatureAt(tile.layer, tile.tx, tile.ty);
      const region = tile.layer === 0 ? w.regionAt(tile.tx, tile.ty) : NO_WEATHER_REGION;
      if (region !== NO_WEATHER_REGION) weather = { region, state: w.weather.state(region) };
    }
    const ready = w.materialized;
    let biome: string | null = null;
    if (ready && tile !== null) {
      const chunk = w.chunks.get(tile.layer, tileToChunk(tile.tx), tileToChunk(tile.ty));
      const id = chunk === undefined ? 0 : (chunk.biome[tileLocalIndex(tile.tx, tile.ty)] as number);
      if (id !== 0) biome = contentWorldIdTables().biomes.stringId(id);
    }
    return {
      ready,
      focus: tile,
      season: cal.season,
      dayOfSeason: cal.dayOfSeason,
      year: cal.year,
      moonPhase: cal.moonPhase,
      weather,
      temperatureC,
      biome,
      activeChunks: ready ? w.zone.size : 0,
      residentChunks: ready ? w.chunks.residentCount : 0,
      loadingChunks: ready ? w.chunks.loadingCount : 0,
    };
  }

  /** Snapshot for debug tools (allocates; not for per-frame use). */
  debugState(): SessionDebugState {
    const clock = this.sim.clock;
    const status = this.sampleStatus(createSessionStatus());
    const focus: SessionFocus = { x: 0, y: 0, layer: 0 };
    return {
      seed: this.sim.config.seed,
      worldSize: this.sim.config.worldSize,
      tick: status.tick,
      day: status.day,
      time: `${twoDigits(clock.hour)}:${twoDigits(clock.minute)}`,
      entities: status.entities,
      controlled: status.controlled === NULL_ENTITY ? null : { entity: status.controlled, x: status.controlledX, y: status.controlledY },
      player: this.playerDebugState(),
      queuedCommands: this.sim.commands.size,
      events: { ...this.eventCounts },
      world: this.worldDebugState(this.sampleFocus(focus) ? focus : null),
      cheats: { god: this.cheats.cheats.god, noclip: this.cheats.cheats.noclip },
    };
  }
}
