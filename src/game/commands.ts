/**
 * Game commands (docs/ARCHITEKTUR.md "Events & Commands"): the only way presentation, debug tools
 * and replays change the simulation. Each command is plain JSON data validated by zod at the
 * boundary (`parseGameCommand`), recorded tick-stamped by `CommandRecorder` and replayed by
 * `ReplayPlayer` (src/engine/commands.ts).
 *
 * - `move`: steer the controlled entity; `dx`/`dy` is the input direction (each axis −1…1,
 *   longer vectors are normalized), `{0, 0}` stops.
 * - `spawnDebugMover`: spawn a moving test entity at (x, y) world pixels. Without `vx`/`vy` the
 *   velocity is drawn from the simulation's `motion` random stream; `controlled: true` makes it
 *   the entity steered by `move` (then missing velocity components are 0).
 * - `despawn`: destroy an entity at the end of the tick.
 */
import { z } from 'zod';
import { CommandRecorder, type CommandRecording } from '../engine/commands';
import { U32_MAX } from '../engine/rng';

/** Smallest value of an input axis. */
const AXIS_MIN = -1;
/** Largest value of an input axis. */
const AXIS_MAX = 1;

const axis = z.number().min(AXIS_MIN).max(AXIS_MAX);

export const moveCommandSchema = z.object({ type: z.literal('move'), dx: axis, dy: axis }).strict();

export const spawnDebugMoverCommandSchema = z
  .object({
    type: z.literal('spawnDebugMover'),
    /** Position [px]. */
    x: z.number(),
    y: z.number(),
    /** Velocity [px/s]; drawn from the `motion` stream when omitted. */
    vx: z.number().optional(),
    vy: z.number().optional(),
    controlled: z.boolean().optional(),
  })
  .strict();

export const despawnCommandSchema = z.object({ type: z.literal('despawn'), entity: z.number().int().min(0).max(U32_MAX) }).strict();

export const gameCommandSchema = z.discriminatedUnion('type', [moveCommandSchema, spawnDebugMoverCommandSchema, despawnCommandSchema]);

/** Any game command. */
export type GameCommand = z.output<typeof gameCommandSchema>;
/** Discriminant of `GameCommand`. */
export type GameCommandType = GameCommand['type'];
/** The command variant with the given type. */
export type CommandOfType<T extends GameCommandType> = Extract<GameCommand, { type: T }>;

/** Every command type, in declaration order. */
export const GAME_COMMAND_TYPES: readonly GameCommandType[] = gameCommandSchema.options.map((o) => o.shape.type.value);

/** Validates unknown data as a game command. Throws `TypeError` naming the offending fields. */
export function parseGameCommand(raw: unknown): GameCommand {
  const result = gameCommandSchema.safeParse(raw);
  if (!result.success) {
    throw new TypeError(`Invalid game command: ${result.error.issues.map((i) => `${i.path.map(String).join('.') || '(command)'}: ${i.message}`).join('; ')}`);
  }
  return result.data;
}

/** Parses a serialized command recording (e.g. a bug-repro replay file) and validates every command. */
export function parseCommandRecording(json: unknown): CommandRecorder<GameCommand> {
  return CommandRecorder.fromJSON(json, parseGameCommand);
}

/** Serializable form of a game command recording. */
export type GameCommandRecording = CommandRecording<GameCommand>;
