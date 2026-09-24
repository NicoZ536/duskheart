/**
 * Player commands (docs/SPIEL.md §3; MASTERPROMPT §11.4, §26): intentions from input, UI and debug tools,
 * applied by the player system in the next tick. `src/game/commands.ts` aggregates the schemas.
 *
 * - `player.spawn`: creates the player – on the start beach (the free tile nearest to the beach centre of
 *   the generated world), or at the free tile nearest to (`tx`, `ty`) on `layer` (debug, tests).
 *   Rejected while a player exists.
 * - `player.move`: the movement direction (each axis −1…1, longer vectors are normalized; {0, 0} stops).
 * - `player.sprint` / `player.sneak`: hold or release sprinting / sneaking (the input layer resolves
 *   hold and toggle modes, `src/engine/input/reader.ts`).
 * - `player.roll`: dodge roll in direction (dx, dy); {0, 0} rolls towards the facing.
 * - `player.teleport`: debug – puts the player at (x, y) world px on `layer`.
 */
import { z } from 'zod';

/** Smallest and largest value of an input axis. */
const AXIS_MIN = -1;
const AXIS_MAX = 1;
/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;

const axis = z.number().min(AXIS_MIN).max(AXIS_MAX);
const layer = z.number().int().min(LAYER_MIN).max(0);

export const playerSpawnCommandSchema = z
  .object({
    type: z.literal('player.spawn'),
    /** Requested tile; both absent = the start beach. */
    tx: z.number().int().optional(),
    ty: z.number().int().optional(),
    /** Layer of the requested tile (default: the surface). */
    layer: layer.optional(),
  })
  .strict()
  .refine((c) => (c.tx === undefined) === (c.ty === undefined), { message: 'tx and ty must be given together' });

export const playerMoveCommandSchema = z.object({ type: z.literal('player.move'), dx: axis, dy: axis }).strict();

export const playerSprintCommandSchema = z.object({ type: z.literal('player.sprint'), on: z.boolean() }).strict();

export const playerSneakCommandSchema = z.object({ type: z.literal('player.sneak'), on: z.boolean() }).strict();

export const playerRollCommandSchema = z.object({ type: z.literal('player.roll'), dx: axis, dy: axis }).strict();

export const playerTeleportCommandSchema = z
  .object({
    type: z.literal('player.teleport'),
    /** Target [world px]. */
    x: z.number(),
    y: z.number(),
    layer,
  })
  .strict();

/** Schemas of the player commands (aggregated by `gameCommandSchema`). */
export const PLAYER_COMMAND_SCHEMAS = [
  playerSpawnCommandSchema,
  playerMoveCommandSchema,
  playerSprintCommandSchema,
  playerSneakCommandSchema,
  playerRollCommandSchema,
  playerTeleportCommandSchema,
] as const;
