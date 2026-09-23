/**
 * A running game session: the simulation plus the input chain that feeds it (docs/ARCHITEKTUR.md
 * "Datenfluss"). DOM free — the browser composition root attaches the DOM input adapter to
 * `input` and drives the session from the `FixedStepLoop`:
 *   `beginFrame()` once per frame (gamepads → actions → commands),
 *   `step()` once per 60 Hz tick (commands → systems → events drained for the presentation).
 * Debug tools and E2E tests read `debugState()` and push commands through `command()`, which
 * validates them exactly like a replay file.
 */
import { DEFAULT_BINDINGS, BindingSet } from '../engine/input/bindings';
import { pollGamepads, type GamepadGetter } from '../engine/input/gamepad';
import { ActionReader } from '../engine/input/reader';
import { InputState } from '../engine/input/state';
import type { Settings } from '../engine/settings';
import { parseGameCommand, type GameCommand } from './commands';
import { InputCommandTranslator } from './input';
import { createSimulation } from './setup';
import { SIM_EVENT_TYPES, type SimConfigInput, type SimEventMap, type Simulation } from './sim';
import { MotionSystem } from './systems/motion';

/**
 * World seed of the session the browser starts at boot. It is fixed so screenshots and E2E runs
 * see the same world (§31.5 "fester Seed"; any fixed value works, this one is the project's start
 * date); debug mode can override it with `?seed=<n>`.
 */
export const BOOT_SESSION_SEED = 20_260_923;

/** Control settings the session applies to its input chain. */
export type ControlSettings = Settings['controls'];

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
}

/** Options of `GameSession`. */
export interface GameSessionOptions {
  readonly config: SimConfigInput;
  /** Gamepad source (browser: `() => navigator.getGamepads()`); without it gamepads are not polled. */
  readonly getGamepads?: GamepadGetter;
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
  /** Drain callback created once (no closure per tick). */
  private readonly countEvent: (type: keyof SimEventMap, payload: unknown) => void;

  constructor(options: GameSessionOptions) {
    this.sim = createSimulation(options.config);
    const motion = this.sim.system('motion');
    if (!(motion instanceof MotionSystem)) throw new Error('GameSession: the simulation has no motion system');
    this.motion = motion;
    this.reader = new ActionReader(this.input, new BindingSet(DEFAULT_BINDINGS));
    this.getGamepads = options.getGamepads;
    this.eventCounts = Object.fromEntries(SIM_EVENT_TYPES.map((t) => [t, 0])) as Record<keyof SimEventMap, number>;
    this.countEvent = (type) => {
      this.eventCounts[type]++;
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

  /** One simulation tick; its events are drained afterwards (the presentation reads them here). */
  step(): void {
    this.sim.step();
    this.sim.events.drain(this.countEvent);
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

  /** Snapshot for debug tools (allocates; not for per-frame use). */
  debugState(): SessionDebugState {
    const clock = this.sim.clock;
    const e = this.motion.controlled;
    const controlled = this.sim.ecs.alive(e) && this.motion.position.has(e) ? { entity: e, x: this.motion.position.get(e, 'x'), y: this.motion.position.get(e, 'y') } : null;
    return {
      seed: this.sim.config.seed,
      worldSize: this.sim.config.worldSize,
      tick: this.sim.tick,
      day: clock.day,
      time: `${twoDigits(clock.hour)}:${twoDigits(clock.minute)}`,
      entities: this.sim.ecs.count,
      controlled,
      queuedCommands: this.sim.commands.size,
      events: { ...this.eventCounts },
    };
  }
}
