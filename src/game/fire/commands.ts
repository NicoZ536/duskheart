/**
 * Commands of the fire simulation (M4-28), aggregated by src/game/commands.ts. In play a tile catches fire from a
 * torch (`light.ignite` on something flammable, the light system's flammables) or from a burning neighbour; the
 * console sets one alight directly.
 *
 * - `fire.ignite {tx, ty, layer?}` (debug, like `death.kill`): sets tile (tx, ty) of `layer` (default the surface)
 *   alight when something on it burns.
 */
import { z } from 'zod';

/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;

export const fireIgniteCommandSchema = z
  .object({ type: z.literal('fire.ignite'), tx: z.number().int().min(0), ty: z.number().int().min(0), layer: z.number().int().min(LAYER_MIN).max(0).optional() })
  .strict();

/** Schemas of the fire commands (aggregated by `gameCommandSchema`). */
export const FIRE_COMMAND_SCHEMAS = [fireIgniteCommandSchema] as const;
