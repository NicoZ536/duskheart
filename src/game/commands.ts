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
 *
 * Debug commands of the console (M2-29, MASTERPROMPT §31.6; they change the world, so they are
 * commands and land in replays like any other):
 * - `teleport`: put the controlled entity at (x, y) world pixels on `layer` (the active zone follows).
 * - `setTime`: jump forward to the next `hour:minute` (time only runs forward: frozen chunks catch up
 *   from their `frozenAtTick`, docs/ARCHITEKTUR.md "Aktive Zone").
 * - `advanceTime`: jump `minutes` game minutes forward.
 * - `setSeason`: jump forward to 06:00 of the first day of the next `season`.
 * - `setWeather`: force a weather state in the weather region of tile (`tx`, `ty`), or in every
 *   region when no tile is given; it blends in and lasts a regular period.
 */
import { z } from 'zod';
import { BALANCE, SEASON_IDS } from '../content/balance';
import { WEATHER_STATE_IDS } from '../content/weather';
import { CommandRecorder, type CommandRecording } from '../engine/commands';
import { U32_MAX } from '../engine/rng';
import { HOURS_PER_DAY, MINUTES_PER_HOUR } from '../engine/time';

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

/** Deepest world layer (docs/WORLD.md §1: surface 0, caves −1 … −3). */
const LAYER_MIN = -3;
/** Longest single time jump [game minutes]: one year of the longest selectable seasons (§10 "wählbar 3–14"). */
export const MAX_TIME_JUMP_MINUTES = SEASON_IDS.length * BALANCE.calendar.maxSeasonLengthDays * HOURS_PER_DAY * MINUTES_PER_HOUR;

export const teleportCommandSchema = z
  .object({
    type: z.literal('teleport'),
    /** Target [world px]. */
    x: z.number(),
    y: z.number(),
    layer: z.number().int().min(LAYER_MIN).max(0),
  })
  .strict();

export const setTimeCommandSchema = z
  .object({
    type: z.literal('setTime'),
    hour: z.number().int().min(0).max(HOURS_PER_DAY - 1),
    minute: z.number().int().min(0).max(MINUTES_PER_HOUR - 1),
  })
  .strict();

export const advanceTimeCommandSchema = z.object({ type: z.literal('advanceTime'), minutes: z.number().int().min(1).max(MAX_TIME_JUMP_MINUTES) }).strict();

export const setSeasonCommandSchema = z.object({ type: z.literal('setSeason'), season: z.enum(SEASON_IDS) }).strict();

export const setWeatherCommandSchema = z
  .object({
    type: z.literal('setWeather'),
    state: z.enum(WEATHER_STATE_IDS),
    /** A surface tile of the region to change; both absent = every region. */
    tx: z.number().int().optional(),
    ty: z.number().int().optional(),
  })
  .strict()
  .refine((c) => (c.tx === undefined) === (c.ty === undefined), { message: 'tx and ty must be given together' });

export const gameCommandSchema = z.discriminatedUnion('type', [
  moveCommandSchema,
  spawnDebugMoverCommandSchema,
  despawnCommandSchema,
  teleportCommandSchema,
  setTimeCommandSchema,
  advanceTimeCommandSchema,
  setSeasonCommandSchema,
  setWeatherCommandSchema,
]);

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
