/**
 * Commands of the places (docs/SPIEL.md §18; M7-07 … M7-09), aggregated by src/game/commands.ts. In play the player uses a
 * place's marks with E (the interaction system's use target, src/game/places/uses.ts, issues `place.use`); the console
 * discovers a place directly.
 *
 * - `place.use {place, marker}`: uses mark `marker` (index into the place's marks, `PlacePlacement.markers`) of the place in
 *   slot `place` – open a chest, climb a look-out tower, receive a shrine's blessing, read a note.
 * - `place.discover {place}` (debug, like `death.kill`): discovers the place in slot `place` as if the player came near it.
 */
import { z } from 'zod';

const slotSchema = z.number().int().min(0);

export const placeUseCommandSchema = z.object({ type: z.literal('place.use'), place: slotSchema, marker: z.number().int().min(0) }).strict();
export const placeDiscoverCommandSchema = z.object({ type: z.literal('place.discover'), place: slotSchema }).strict();

/** Schemas of the place commands (aggregated by `gameCommandSchema`). */
export const PLACE_COMMAND_SCHEMAS = [placeUseCommandSchema, placeDiscoverCommandSchema] as const;
