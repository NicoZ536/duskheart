/**
 * Station commands (MASTERPROMPT §15.1, §15.2; docs/SPIEL.md §3; M4-03 … M4-07). `src/game/commands.ts`
 * aggregates the schemas; the station screen of the UI (M4-07) sends them.
 *
 * - `station.place {from, tx, ty, mirror?}`: sets up the station item in bag slot `from` with its footprint's
 *   north-west corner on tile (tx, ty) in build reach, mirrored with `mirror` (the build menu's F, §16.6).
 * - `station.remove {station}`: takes the placed station down – within 30 s of setting it up the item comes back
 *   whole, later 60 % of its materials (§16.6, like build parts) – with everything in its slots; refused while a
 *   crafting order is worked at it.
 * - `station.use {station}`: opens the station (E on it; the UI shows its recipes and slots).
 * - `station.put {station, from, bereich, count?}`: moves pieces from bag slot `from` into the station's input
 *   slots (`eingang`) or its fuel slot (`brennstoff`) – only what its recipes use, only fuel it accepts.
 * - `station.take {station, bereich, index, count?}`: moves pieces from a station slot into the bags
 *   (`eingang`, `brennstoff` or `ausgang`; `index` in that area).
 * - `station.takeAll {station}`: moves every product of the output slots into the bags.
 */
import { z } from 'zod';
import { STATION_SLOTS_MAX } from '../../content/stations';
import { slotRefSchema } from '../inventory/commands';

/** Areas of a processing station's slots. */
export const STATION_AREAS = ['eingang', 'brennstoff', 'ausgang'] as const;
/** One area. */
export type StationArea = (typeof STATION_AREAS)[number];
/** Areas the player may fill. */
export const STATION_INPUT_AREAS = ['eingang', 'brennstoff'] as const;

const stationId = z.number().int().min(1);
const count = z.number().int().min(1);
const tile = z.number().int().min(0);

export const stationPlaceCommandSchema = z.object({ type: z.literal('station.place'), from: slotRefSchema, tx: tile, ty: tile, mirror: z.boolean().optional() }).strict();
export const stationRemoveCommandSchema = z.object({ type: z.literal('station.remove'), station: stationId }).strict();
export const stationUseCommandSchema = z.object({ type: z.literal('station.use'), station: stationId }).strict();
export const stationPutCommandSchema = z
  .object({ type: z.literal('station.put'), station: stationId, from: slotRefSchema, bereich: z.enum(STATION_INPUT_AREAS), count: count.optional() })
  .strict();
export const stationTakeCommandSchema = z
  .object({
    type: z.literal('station.take'),
    station: stationId,
    bereich: z.enum(STATION_AREAS),
    index: z
      .number()
      .int()
      .min(0)
      .max(STATION_SLOTS_MAX - 1),
    count: count.optional(),
  })
  .strict();
export const stationTakeAllCommandSchema = z.object({ type: z.literal('station.takeAll'), station: stationId }).strict();

/** Schemas of the station commands (aggregated by `gameCommandSchema`). */
export const STATION_COMMAND_SCHEMAS = [
  stationPlaceCommandSchema,
  stationRemoveCommandSchema,
  stationUseCommandSchema,
  stationPutCommandSchema,
  stationTakeCommandSchema,
  stationTakeAllCommandSchema,
] as const;
