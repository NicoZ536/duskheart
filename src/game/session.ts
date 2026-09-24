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
 */
import { NULL_ENTITY, type Entity } from '../engine/ecs';
import { EventBus } from '../engine/events';
import { DEFAULT_BINDINGS, BindingSet } from '../engine/input/bindings';
import { pollGamepads, type GamepadGetter } from '../engine/input/gamepad';
import { ActionReader } from '../engine/input/reader';
import { InputState } from '../engine/input/state';
import type { Settings } from '../engine/settings';
import { parseGameCommand, type GameCommand } from './commands';
import { InputCommandTranslator } from './input';
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
  /** The entity steered by `move` commands and its position [px], or `null`. */
  readonly controlled: { readonly entity: number; readonly x: number; readonly y: number } | null;
  /** Commands waiting for the next tick. */
  readonly queuedCommands: number;
  /** Events drained since the session started, per type. */
  readonly events: Readonly<Record<keyof SimEventMap, number>>;
  readonly world: SessionWorldDebugState;
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
  /** The entity steered by `move` commands, or `NULL_ENTITY` (then the position is 0, 0). */
  controlled: Entity;
  /** Position of the controlled entity [px]. */
  controlledX: number;
  controlledY: number;
}

/** A fresh `SessionStatus` to pass to `GameSession.sampleStatus`. */
export function createSessionStatus(): SessionStatus {
  return { tick: 0, day: 0, minuteOfDay: 0, entities: 0, controlled: NULL_ENTITY, controlledX: 0, controlledY: 0 };
}

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
  private readonly getGamepads: GamepadGetter | undefined;
  private readonly eventCounts: Record<keyof SimEventMap, number>;
  /** Drained events, re-emitted for presentation subscribers (`onEvent`). */
  private readonly drainedEvents = new EventBus<SimEventMap>();
  /** Drain callback created once (no closure per tick). */
  private readonly dispatchEvent: (type: keyof SimEventMap, payload: unknown) => void;

  constructor(options: GameSessionOptions) {
    this.sim = createSimulation(options.config, options.simulation);
    const motion = this.sim.system('motion');
    if (!(motion instanceof MotionSystem)) throw new Error('GameSession: the simulation has no motion system');
    this.motion = motion;
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

  /** Once per frame before the ticks: poll gamepads, evaluate actions, turn them into commands. */
  beginFrame(): void {
    if (this.getGamepads !== undefined) pollGamepads(this.input, this.getGamepads);
    this.reader.update();
    this.translator.translate(this.reader, this.sim.commands);
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
    const e = this.motion.controlled;
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
   * Writes position and layer of the controlled entity into `out` (camera and figure of the game
   * view, once per frame; no allocation). Returns false – leaving `out` – while nothing is controlled.
   */
  sampleFocus(out: SessionFocus): boolean {
    if (!this.motion.controlledPosition(this.sim, out)) return false;
    out.layer = this.motion.controlledLayer;
    return true;
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
      queuedCommands: this.sim.commands.size,
      events: { ...this.eventCounts },
      world: this.worldDebugState(this.sampleFocus(focus) ? focus : null),
    };
  }
}
