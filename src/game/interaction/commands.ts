/**
 * Interaction commands (docs/SPIEL.md §3 "`player.interact {tx,ty}`, `player.aim {x,y}`"; MASTERPROMPT
 * §11.4 "Sammeln (halten, Fortschrittsring), Interagieren (E)"; M3-10). `src/game/commands.ts`
 * aggregates the schemas.
 *
 * - `player.interact`: E pressed (`on: true`) or released (`on: false`). While it is held the player
 *   works the target in reach: picks up a drop, picks a plant by hand, strikes a tree, rock or tile with
 *   the tool in the hand – one target after the other. Without `tx`/`ty` the target is the focus the
 *   simulation chose (the aimed tile first, else the nearest in front); with them, that tile (touch
 *   taps, debug tools, tests).
 * - `player.aim`: the world point under the cursor [px] – its tile is preferred as the target; without
 *   `x`/`y` nothing is aimed at (cursor outside the view, gamepad). The input layer sends it only when
 *   the aimed tile changes.
 */
import { z } from 'zod';

export const playerInteractCommandSchema = z
  .object({
    type: z.literal('player.interact'),
    on: z.boolean(),
    /** Target tile; both absent = the focus of the simulation. */
    tx: z.number().int().optional(),
    ty: z.number().int().optional(),
  })
  .strict()
  .refine((c) => (c.tx === undefined) === (c.ty === undefined), { message: 'tx and ty must be given together' });

export const playerAimCommandSchema = z
  .object({
    type: z.literal('player.aim'),
    /** Aimed world point [px]; both absent = no aim. */
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .strict()
  .refine((c) => (c.x === undefined) === (c.y === undefined), { message: 'x and y must be given together' });

/** Schemas of the interaction commands (aggregated by `gameCommandSchema`). */
export const INTERACTION_COMMAND_SCHEMAS = [playerInteractCommandSchema, playerAimCommandSchema] as const;
