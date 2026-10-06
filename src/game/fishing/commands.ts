/**
 * Commands of fishing (docs/SPIEL.md §20 "Befehle fishing.cast {x, y}, fishing.reel {on} (gehalten), fishing.cancel", "Reusen
 * … fishing.placeTrap/fishing.takeTrap"), aggregated by src/game/commands.ts. The E targets of src/game/fishing/uses.ts send
 * them for the player: E on open water (or an ice hole) with the rod in the hand casts, E held reels.
 *
 * - `fishing.cast {x, y}`: cast the rod in the hand to the point (x, y) [world px] – open water or an open ice hole within
 *   `castReachTiles`.
 * - `fishing.reel {on}`: hold (`on`) or slacken the reel (gamepad and tests; E held does the same).
 * - `fishing.cancel`: reel the line in at once (the fish, if any, gets away).
 * - `fishing.placeTrap {from, tx, ty}`: set the fish trap of bag slot `from` into the water of tile (tx, ty) within reach.
 * - `fishing.takeTrap {tx, ty}`: empty the trap on (tx, ty) into the bags, or take it back when it is empty.
 * - `fishing.cutHole {tx, ty}`: cut a hole into the ice of tile (tx, ty) within reach (a pickaxe in the hand).
 */
import { z } from 'zod';
import { slotRefSchema } from '../inventory/commands';

export const fishingCastCommandSchema = z.object({ type: z.literal('fishing.cast'), x: z.number().finite(), y: z.number().finite() }).strict();
export const fishingReelCommandSchema = z.object({ type: z.literal('fishing.reel'), on: z.boolean() }).strict();
export const fishingCancelCommandSchema = z.object({ type: z.literal('fishing.cancel') }).strict();
export const fishingPlaceTrapCommandSchema = z.object({ type: z.literal('fishing.placeTrap'), from: slotRefSchema, tx: z.number().int(), ty: z.number().int() }).strict();
export const fishingTakeTrapCommandSchema = z.object({ type: z.literal('fishing.takeTrap'), tx: z.number().int(), ty: z.number().int() }).strict();
export const fishingCutHoleCommandSchema = z.object({ type: z.literal('fishing.cutHole'), tx: z.number().int(), ty: z.number().int() }).strict();

/** Schemas of the fishing commands (aggregated by `gameCommandSchema`). */
export const FISHING_COMMAND_SCHEMAS = [
  fishingCastCommandSchema,
  fishingReelCommandSchema,
  fishingCancelCommandSchema,
  fishingPlaceTrapCommandSchema,
  fishingTakeTrapCommandSchema,
  fishingCutHoleCommandSchema,
] as const;
