/**
 * Headless simulation runner for tests, balancing and benchmarks (docs/ARCHITEKTUR.md
 * "Simulation"). Runs the full simulation in Node without render, audio or UI: N ticks, optional
 * tick-stamped command stream (a recording), events drained after every tick, state hash at the end.
 */
import { BALANCE, type WorldSizePreset } from '../content/balance';
import { ReplayPlayer, type CommandRecorder, type CommandRecording, type RecordedCommand } from '../engine/commands';
import { makeEntity } from '../engine/ecs';
import { Rng } from '../engine/rng';
import type { GameCommand } from './commands';
import { createSimulation } from './setup';
import { SIM_EVENT_TYPES, type SimConfigInput, type SimEventMap, type Simulation } from './sim';

/** Commands to feed: a recording, its entries or a live recorder. */
export type CommandSource = CommandRecording<GameCommand> | ReadonlyArray<RecordedCommand<GameCommand>> | CommandRecorder<GameCommand>;

/** Options of `runHeadless`. Give either `seed` (new world) or `sim` (continue, e.g. after loading). */
export interface HeadlessOptions {
  /** World seed of a new simulation. */
  readonly seed?: number;
  /** Further config of a new simulation. */
  readonly config?: Omit<SimConfigInput, 'seed'>;
  /** Existing simulation to continue; commands recorded before `sim.tick` are skipped. */
  readonly sim?: Simulation;
  /** Number of ticks to run. */
  readonly ticks: number;
  /** Commands delivered at their recorded ticks. */
  readonly commands?: CommandSource;
  /** Receives every applied command with its tick (for recording a run). */
  readonly recorder?: CommandRecorder<GameCommand>;
}

/** Result of `runHeadless`. */
export interface HeadlessResult {
  /** `sim.hashState()` after the last tick. */
  readonly hash: string;
  readonly sim: Simulation;
  /** Number of drained events per type during this run. */
  readonly events: Readonly<Record<keyof SimEventMap, number>>;
}

/** Runs `ticks` simulation ticks headless and returns the final state hash. */
export function runHeadless(options: HeadlessOptions): HeadlessResult {
  const { ticks } = options;
  if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError(`runHeadless: ticks must be an integer ≥ 0, got ${String(ticks)}`);
  let sim: Simulation;
  if (options.sim !== undefined) {
    if (options.seed !== undefined || options.config !== undefined) throw new TypeError('runHeadless: pass either sim or seed/config, not both');
    sim = options.sim;
  } else {
    if (options.seed === undefined) throw new TypeError('runHeadless: seed is required for a new simulation');
    sim = createSimulation({ ...options.config, seed: options.seed });
  }
  const events = Object.fromEntries(SIM_EVENT_TYPES.map((t) => [t, 0])) as Record<keyof SimEventMap, number>;
  const count = (type: keyof SimEventMap, _payload: unknown): void => {
    events[type]++;
  };
  let player: ReplayPlayer<GameCommand> | null = null;
  if (options.commands !== undefined) {
    player = new ReplayPlayer(options.commands);
    player.seek(sim.tick);
  }
  if (options.recorder !== undefined) sim.commands.setSink(options.recorder);
  try {
    for (let i = 0; i < ticks; i++) {
      player?.feed(sim.tick, sim.commands);
      sim.step();
      sim.events.drain(count);
    }
  } finally {
    if (options.recorder !== undefined) sim.commands.setSink(null);
  }
  return { hash: sim.hashState(), sim, events };
}

// ---------------------------------------------------------------------------------------------
// Demo script
// ---------------------------------------------------------------------------------------------

/** Wandering movers spawned at tick 0 by the demo script. */
const DEMO_MOVERS = 48;
/** Ticks between two steering commands of the controlled entity. */
const DEMO_STEER_INTERVAL = 30;
/** Ticks between two despawn/respawn pairs. */
const DEMO_CHURN_INTERVAL = 250;
/** Every n-th churn additionally despawns an already destroyed entity (exercises rejections). */
const DEMO_STALE_DESPAWN_EVERY = 4;

/** Options of `demoScript`. */
export interface DemoScriptOptions {
  /** Length of the script in ticks. */
  readonly ticks: number;
  /** Seed of the script's own random choices (independent of the world seed). */
  readonly seed: number;
  /** World size the positions are drawn for. */
  readonly worldSize?: WorldSizePreset;
}

/**
 * Deterministic command script that exercises every command type: at tick 0 a controlled entity
 * in the world center and `DEMO_MOVERS` movers with random velocities; the controlled entity is
 * steered every `DEMO_STEER_INTERVAL` ticks; every `DEMO_CHURN_INTERVAL` ticks one mover is
 * despawned and a new one spawned; some despawns target dead entities and are rejected.
 * Entity handles are predicted from spawn order (fresh indices, generation 0), which holds while
 * fewer entities have been freed than the ECS reuse threshold (1024).
 */
export function demoScript(options: DemoScriptOptions): RecordedCommand<GameCommand>[] {
  const { ticks } = options;
  if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError(`demoScript: ticks must be an integer ≥ 0, got ${String(ticks)}`);
  const rng = new Rng(options.seed);
  const edge = BALANCE.world.sizeTiles[options.worldSize ?? BALANCE.world.defaultSize] * BALANCE.world.tilePx;
  const out: RecordedCommand<GameCommand>[] = [];
  const alive: number[] = [];
  const dead: number[] = [];
  let spawned = 0;
  /** Records a spawn and predicts its handle; only churnable movers join `alive`. */
  const spawn = (tick: number, cmd: GameCommand, churnable: boolean): void => {
    out.push({ tick, cmd });
    const handle = makeEntity(spawned++, 0);
    if (churnable) alive.push(handle);
  };
  if (ticks === 0) return out;
  spawn(0, { type: 'spawnDebugMover', x: edge / 2, y: edge / 2, controlled: true }, false);
  for (let i = 0; i < DEMO_MOVERS; i++) spawn(0, { type: 'spawnDebugMover', x: rng.float(0, edge), y: rng.float(0, edge) }, true);
  let churns = 0;
  for (let tick = 1; tick < ticks; tick++) {
    if (tick % DEMO_STEER_INTERVAL === 0) out.push({ tick, cmd: { type: 'move', dx: rng.int(-1, 2), dy: rng.int(-1, 2) } });
    if (tick % DEMO_CHURN_INTERVAL === 0 && alive.length > 0) {
      const victim = alive.splice(rng.int(0, alive.length), 1)[0] as number;
      out.push({ tick, cmd: { type: 'despawn', entity: victim } });
      dead.push(victim);
      churns++;
      if (churns % DEMO_STALE_DESPAWN_EVERY === 0) out.push({ tick, cmd: { type: 'despawn', entity: rng.pick(dead) } });
      spawn(tick, { type: 'spawnDebugMover', x: rng.float(0, edge), y: rng.float(0, edge) }, true);
    }
  }
  return out;
}
