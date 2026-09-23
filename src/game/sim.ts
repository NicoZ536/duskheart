/**
 * The headless simulation (docs/ARCHITEKTUR.md "Simulation", MASTERPROMPT §3.3).
 *
 * `Simulation` owns the complete game state: `config`, named random streams, the ECS, the game
 * clock, the per-tick event queue, the command queue and an ordered list of systems.
 * `step()` runs exactly one 60 Hz tick:
 *   1. drain the command queue and apply every command through the handler registry,
 *   2. `update` every system in order,
 *   3. advance the clock; every 60 ticks `worldTick` (1 Hz),
 *   4. when 06:00 is reached `dailyTick`,
 *   5. `ecs.flushDestroyed()`.
 * Nothing here touches wall-clock time, `Math.random` or presentation modules, so identical
 * config + identical command stream ⇒ identical `hashState()`.
 *
 * Events: systems push into `sim.events`; the owner of the simulation (frame driver, headless
 * runner, tests) drains the queue after every `step()`.
 */
import { z } from 'zod';
import { BALANCE, type WorldSizePreset } from '../content/balance';
import { CommandQueue } from '../engine/commands';
import { Ecs, type Entity } from '../engine/ecs';
import { EventQueue } from '../engine/events';
import { RngStreams, U32_MAX, normalizeSeed } from '../engine/rng';
import { DAY_LENGTH_OPTIONS, GameClock, type DayLengthMinutes } from '../engine/time';
import { stableHash64 } from './canonical';
import { GAME_COMMAND_TYPES, type CommandOfType, type GameCommand, type GameCommandType } from './commands';
import { assertValidParticipant, type SaveParticipant } from './participant';

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

/** World size presets (§9.1). */
export const WORLD_SIZES = ['small', 'medium', 'large'] as const satisfies readonly WorldSizePreset[];

/** Validated, immutable world configuration (saved with the world meta). */
export const simConfigSchema = z
  .object({
    /** World seed (u32). */
    seed: z.number().int().min(0).max(U32_MAX),
    worldSize: z.enum(WORLD_SIZES),
    /** Real minutes per game day. */
    dayLengthMinutes: z.literal(DAY_LENGTH_OPTIONS),
  })
  .strict();

export type SimConfig = Readonly<z.output<typeof simConfigSchema>>;

/** Config input: the seed may be any safe integer (normalized to u32); the rest defaults from `BALANCE`. */
export interface SimConfigInput {
  readonly seed: number;
  readonly worldSize?: WorldSizePreset;
  readonly dayLengthMinutes?: DayLengthMinutes;
}

/** Fills defaults, normalizes the seed and validates. Throws `TypeError` on invalid input. */
export function resolveSimConfig(input: SimConfigInput): SimConfig {
  const candidate = {
    seed: normalizeSeed(input.seed),
    worldSize: input.worldSize ?? BALANCE.world.defaultSize,
    dayLengthMinutes: input.dayLengthMinutes ?? BALANCE.time.defaultDayLengthMinutes,
  };
  const parsed = simConfigSchema.safeParse(candidate);
  if (!parsed.success) throw new TypeError(`Invalid simulation config: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return Object.freeze(parsed.data);
}

// ---------------------------------------------------------------------------------------------
// Events, systems, handlers
// ---------------------------------------------------------------------------------------------

/** Why a command had no effect. */
export type CommandRejectReason = 'deadEntity' | 'noControlledEntity' | 'outOfBounds';

/** Events the simulation emits during a tick (drained by the presentation afterwards). `tick` is the step that produced the event. */
export interface SimEventMap {
  entitySpawned: { readonly entity: Entity; readonly tick: number };
  entityDespawned: { readonly entity: Entity; readonly tick: number };
  worldTick: { readonly tick: number };
  dailyTick: { readonly day: number; readonly tick: number };
  commandRejected: { readonly type: GameCommandType; readonly reason: CommandRejectReason; readonly tick: number };
}

/** Event names of `SimEventMap`. */
export const SIM_EVENT_TYPES = ['entitySpawned', 'entityDespawned', 'worldTick', 'dailyTick', 'commandRejected'] as const satisfies ReadonlyArray<keyof SimEventMap>;

/** Applies one command of type `T` in tick `tick`. */
export type CommandHandler<T extends GameCommandType> = (sim: Simulation, cmd: CommandOfType<T>, tick: number) => void;
/** Handlers a system contributes, by command type. */
export type CommandHandlers = { readonly [T in GameCommandType]?: CommandHandler<T> };
type AnyCommandHandler = (sim: Simulation, cmd: GameCommand, tick: number) => void;

/** A simulation system. Systems talk to each other only through components, events and commands. */
export interface SimSystem {
  /** Unique id (kebab-case). */
  readonly id: string;
  /** Command handlers this system owns (each command type has exactly one handler). */
  readonly commands?: CommandHandlers;
  /** Called every tick with the fixed step `dt` in seconds. */
  update?(sim: Simulation, dt: number): void;
  /** Called once per world tick (1 Hz). */
  worldTick?(sim: Simulation): void;
  /** Called when 06:00 is reached; `day` is the day that just began. */
  dailyTick?(sim: Simulation, day: number): void;
  /** The system's state for saves (at most one participant per system). */
  readonly save?: SaveParticipant;
}

/** Version of the core participants' data formats. */
const CORE_PARTICIPANT_VERSION = 1;

/** Plain snapshot of the whole simulation (input of `hashState`). */
export interface SimSnapshot {
  readonly config: SimConfig;
  readonly participants: Readonly<Record<string, { readonly version: number; readonly data: unknown }>>;
}

// ---------------------------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------------------------

export class Simulation {
  readonly config: SimConfig;
  readonly rng: RngStreams;
  readonly ecs: Ecs;
  readonly clock: GameClock;
  readonly events = new EventQueue<SimEventMap>();
  /** Commands for the next tick (attach a `CommandRecorder` with `commands.setSink`). */
  readonly commands = new CommandQueue<GameCommand>();
  /** Fixed step length in seconds. */
  readonly dt: number;

  private readonly systemList: SimSystem[] = [];
  private readonly handlers = new Map<GameCommandType, AnyCommandHandler>();
  private readonly participantList: SaveParticipant[] = [];
  private readonly applyCommand: (cmd: GameCommand, tick: number) => void;
  /** Tick stamped on events: the running step's tick inside `step()`, else the next tick. */
  private eventTickValue = 0;

  constructor(config: SimConfigInput) {
    this.config = resolveSimConfig(config);
    this.rng = new RngStreams(this.config.seed);
    this.ecs = new Ecs();
    this.clock = new GameClock({
      tickHz: BALANCE.time.tickHz,
      worldTickHz: BALANCE.time.worldTickHz,
      dayLengthMinutes: this.config.dayLengthMinutes,
    });
    this.dt = 1 / BALANCE.time.tickHz;
    this.applyCommand = (cmd, tick) => {
      const handler = this.handlers.get(cmd.type);
      if (handler === undefined) throw new Error(`Simulation: no handler registered for command "${cmd.type}"`);
      handler(this, cmd, tick);
    };
    this.ecs.onDestroy((entity) => this.events.push('entityDespawned', { entity, tick: this.eventTickValue }));
    this.onCommand('despawn', (sim, cmd, tick) => {
      if (!sim.ecs.alive(cmd.entity)) {
        sim.events.push('commandRejected', { type: cmd.type, reason: 'deadEntity', tick });
        return;
      }
      sim.ecs.queueDestroy(cmd.entity);
    });
    this.addParticipant({
      id: 'clock',
      version: CORE_PARTICIPANT_VERSION,
      serialize: () => this.clock.serialize(),
      deserialize: (data) => this.clock.deserialize(data),
    });
    this.addParticipant({
      id: 'rng',
      version: CORE_PARTICIPANT_VERSION,
      serialize: () => this.rng.serialize(),
      deserialize: (data) => this.rng.deserialize(data),
    });
    this.addParticipant({
      id: 'ecs',
      version: CORE_PARTICIPANT_VERSION,
      serialize: () => this.ecs.snapshot(),
      deserialize: (data) => this.ecs.restore(data),
    });
  }

  /** Completed ticks since the world was created (= tick index of the next `step`). */
  get tick(): number {
    return this.clock.tick;
  }

  /** Tick to stamp on events: the tick being stepped (outside `step()`: the next tick). */
  get eventTick(): number {
    return this.eventTickValue;
  }

  /** Systems in update order. */
  get systems(): readonly SimSystem[] {
    return this.systemList;
  }

  /** Appends a system (update order = registration order) and registers its handlers and participant. */
  addSystem<S extends SimSystem>(system: S): S {
    if (this.systemList.some((s) => s.id === system.id)) throw new Error(`Simulation: system "${system.id}" is already registered`);
    const handlers = system.commands ?? {};
    for (const type of Object.keys(handlers) as GameCommandType[]) {
      if (this.handlers.has(type)) throw new Error(`Simulation: command "${type}" already has a handler (system "${system.id}")`);
    }
    if (system.save !== undefined) this.addParticipant(system.save);
    for (const type of Object.keys(handlers) as GameCommandType[]) {
      const handler = handlers[type];
      if (handler !== undefined) this.handlers.set(type, handler as AnyCommandHandler);
    }
    this.systemList.push(system);
    return system;
  }

  /** The system with this id; throws if it is not registered. */
  system(id: string): SimSystem {
    const s = this.systemList.find((x) => x.id === id);
    if (s === undefined) throw new Error(`Simulation: unknown system "${id}"`);
    return s;
  }

  /** Registers the handler for one command type (exactly one handler per type). */
  onCommand<T extends GameCommandType>(type: T, handler: CommandHandler<T>): void {
    if (this.handlers.has(type)) throw new Error(`Simulation: command "${type}" already has a handler`);
    this.handlers.set(type, handler as AnyCommandHandler);
  }

  /** Command types without a handler (a complete simulation returns an empty list). */
  unhandledCommandTypes(): GameCommandType[] {
    return GAME_COMMAND_TYPES.filter((t) => !this.handlers.has(t));
  }

  /** Runs exactly one tick. `commands` are queued behind anything already in `this.commands`. */
  step(commands?: Iterable<GameCommand>): void {
    const tick = this.clock.tick;
    this.eventTickValue = tick;
    if (commands !== undefined) for (const cmd of commands) this.commands.push(cmd);
    this.commands.drainForTick(tick, this.applyCommand);
    const systems = this.systemList;
    for (let i = 0; i < systems.length; i++) (systems[i] as SimSystem).update?.(this, this.dt);
    const due = this.clock.advance();
    if (due.worldTick) {
      this.events.push('worldTick', { tick });
      for (let i = 0; i < systems.length; i++) (systems[i] as SimSystem).worldTick?.(this);
    }
    if (due.dailyTick) {
      const day = this.clock.day;
      this.events.push('dailyTick', { day, tick });
      for (let i = 0; i < systems.length; i++) (systems[i] as SimSystem).dailyTick?.(this, day);
    }
    this.ecs.flushDestroyed();
    this.eventTickValue = this.clock.tick;
  }

  /** Save participants in restore order: clock, rng, ecs, then the systems in registration order. */
  participants(): readonly SaveParticipant[] {
    return this.participantList;
  }

  /** The participant with this id; throws if unknown. */
  participant(id: string): SaveParticipant {
    const p = this.participantList.find((x) => x.id === id);
    if (p === undefined) throw new Error(`Simulation: unknown save participant "${id}"`);
    return p;
  }

  /** Plain snapshot of config and every participant. */
  snapshot(): SimSnapshot {
    const participants: Record<string, { version: number; data: unknown }> = {};
    for (const p of this.participantList) participants[p.id] = { version: p.version, data: p.serialize() };
    return { config: this.config, participants };
  }

  /** Stable 64 bit hash (16 hex digits) of the canonical snapshot of the whole state. */
  hashState(): string {
    return stableHash64(this.snapshot());
  }

  private addParticipant(p: SaveParticipant): void {
    assertValidParticipant(p);
    if (this.participantList.some((x) => x.id === p.id)) throw new Error(`Simulation: save participant "${p.id}" is already registered`);
    this.participantList.push(p);
  }
}
