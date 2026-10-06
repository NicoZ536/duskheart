/**
 * Commands of the world events (docs/SPIEL.md §18; M7-38 … M7-40), aggregated by src/game/commands.ts. The events plan
 * themselves; the console starts and ends them and calls a bolt down (screenshots, tests, debugging).
 *
 * - `worldEvent.start {event}` (debug, console `ereignis <id>`): starts a running event of the register now, announced and
 *   started in one tick, for the longest of its durations.
 * - `worldEvent.stop {event}` (debug): ends it (`worldEventEnded` with `grund: 'debug'`).
 * - `lightning.strike {dx?, dy?}` (debug, console `blitz`): a bolt `dx`, `dy` tiles from the player now, seeking its target
 *   as every strike does.
 */
import { z } from 'zod';

/** Farthest a debug bolt may land from the player [tiles] (the active zone's reach). */
const MAX_DEBUG_STRIKE_TILES = 64;
const offset = z.number().int().min(-MAX_DEBUG_STRIKE_TILES).max(MAX_DEBUG_STRIKE_TILES);

export const worldEventStartCommandSchema = z.object({ type: z.literal('worldEvent.start'), event: z.string().min(1) }).strict();
export const worldEventStopCommandSchema = z.object({ type: z.literal('worldEvent.stop'), event: z.string().min(1) }).strict();
export const lightningStrikeCommandSchema = z.object({ type: z.literal('lightning.strike'), dx: offset.optional(), dy: offset.optional() }).strict();

/** Schemas of the world event commands (aggregated by `gameCommandSchema`). */
export const WORLD_EVENT_COMMAND_SCHEMAS = [worldEventStartCommandSchema, worldEventStopCommandSchema, lightningStrikeCommandSchema] as const;
