/**
 * Commands of fast travel (docs/SPIEL.md §22 "Schnellreise", M7-37; aggregated into `GameCommand`):
 *
 * - `travel.open` – E at a travel point: the travel screen opens (`travelOpened`), refused away from one.
 * - `travel.go { ziel }` – travel from the point the player stands at to point `ziel` (a point id, `TravelPoint.id`).
 * - `travel.rename { wegstein, name }` – names way stone `wegstein` (its number in `TravelState`).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';

/** Id of a travel point: `leuchtfeuer:<n>`, `herdfeuer:<hearth id>`, `wegstein:<n>`. */
export const TRAVEL_POINT_ID_PATTERN = /^(?:leuchtfeuer|herdfeuer|wegstein):\d+$/;

export const travelOpenCommandSchema = z.object({ type: z.literal('travel.open') }).strict();
export const travelGoCommandSchema = z.object({ type: z.literal('travel.go'), ziel: z.string().regex(TRAVEL_POINT_ID_PATTERN) }).strict();
export const travelRenameCommandSchema = z
  .object({ type: z.literal('travel.rename'), wegstein: z.number().int().min(1), name: z.string().max(BALANCE.travel.nameMaxLength * 2) })
  .strict();

/** The travel commands (spread into `COMMAND_SCHEMAS`). */
export const TRAVEL_COMMAND_SCHEMAS = [travelOpenCommandSchema, travelGoCommandSchema, travelRenameCommandSchema] as const;
