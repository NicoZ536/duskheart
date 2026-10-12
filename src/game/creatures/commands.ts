/**
 * Commands of the creatures, carcasses and traps (docs/SPIEL.md §3, §11, §13 "Debug (M6-35)"), aggregated by
 * src/game/commands.ts.
 *
 * - `creature.spawn {creature, count, x?, y?, layer?, finster?}` (debug console `spawn <kreatur> [n]`): `count` creatures appear
 *   around (x, y) – without a place a few tiles in front of the player –, on free tiles of the active zone.
 * - `creature.kill {radius}` (debug console `kill <radius>`): every creature within `radius` tiles of the player dies
 *   (loot and carcasses as if the player had struck).
 * - `carcass.carve {carcass}`: E on a carcass with a knife in the hand carves it (§14 "Jagen & Zerlegen").
 * - `trap.place {from, tx, ty}`: sets the trap in bag slot `from` on tile (tx, ty) within reach (§14 "Fallen").
 * - `trap.take {trap}`: takes trap `trap` back into the bags; what it caught stays as a carcass at its place.
 * - `creature.condition {creature, condition, seconds}` (debug console `zustand <kreatur> <zustand> [sekunden]`; M7-128, last
 *   – after the commands of M6): the living `creature` nearest the player on its layer (within `MAX_DEBUG_KILL_RADIUS` tiles)
 *   takes condition `condition` for `seconds` under the condition's stack rule, as a hit would lay it – but without a hit: no
 *   damage, no alarm, no flash. For a condition no item lays yet (the frost of M7-71) and the screenshots (`kreatur-frost`).
 *   Handled by the system `creature-debug` (src/game/creatures/debugSystem.ts).
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';
import { slotRefSchema } from '../inventory/commands';

/** Most creatures one debug spawn brings. */
export const MAX_DEBUG_SPAWN = 20;
/** Largest kill radius of the debug console [tiles]. */
export const MAX_DEBUG_KILL_RADIUS = 64;
/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;

export const creatureSpawnCommandSchema = z
  .object({
    type: z.literal('creature.spawn'),
    creature: idSchema,
    count: z.number().int().min(1).max(MAX_DEBUG_SPAWN),
    /** Place [world px]; absent: in front of the player. */
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    layer: z.number().int().min(LAYER_MIN).max(0).optional(),
    /**
     * Shadow brood as a Finstermond night brings it (stronger, marked; ADR-0135, ADR-0168) – the screenshot of its mark
     * beside an ordinary brood. Ignored for every other creature.
     */
    finster: z.boolean().optional(),
  })
  .strict();

export const creatureKillCommandSchema = z.object({ type: z.literal('creature.kill'), radius: z.number().positive().max(MAX_DEBUG_KILL_RADIUS) }).strict();

/** Longest a debug condition lasts [s]: ten game hours at the standard day (a picture or a test never needs more). */
export const MAX_DEBUG_CONDITION_SECONDS = 600;

export const creatureConditionCommandSchema = z
  .object({
    type: z.literal('creature.condition'),
    creature: idSchema,
    condition: idSchema,
    seconds: z.number().positive().max(MAX_DEBUG_CONDITION_SECONDS),
  })
  .strict();

export const carcassCarveCommandSchema = z.object({ type: z.literal('carcass.carve'), carcass: z.number().int().min(0) }).strict();

export const trapPlaceCommandSchema = z.object({ type: z.literal('trap.place'), from: slotRefSchema, tx: z.number().int(), ty: z.number().int() }).strict();

export const trapTakeCommandSchema = z.object({ type: z.literal('trap.take'), trap: z.number().int().min(1) }).strict();

/** Schemas of the creature commands (aggregated by `gameCommandSchema`). */
export const CREATURE_COMMAND_SCHEMAS = [creatureSpawnCommandSchema, creatureKillCommandSchema, carcassCarveCommandSchema, trapPlaceCommandSchema, trapTakeCommandSchema, creatureConditionCommandSchema] as const;
