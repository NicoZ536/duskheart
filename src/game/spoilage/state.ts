/**
 * State of spoilage (docs/SPIEL.md §21 "Stempel", §27 "spoilage 1: globaler Stunden-Stempel; je eingefrorenem Chunk Stempel und
 * Faktor seiner Behälter") and its save form (participant `spoilage`, version 1).
 *
 * - `lastHour`: the game hour up to which the bags and every container of the active zone have spoiled (−1: not yet started –
 *   the first tick sets it to the hour then, so a save from before the kitchen does not spoil its past at once).
 * - `frozen`: per frozen chunk with perishable stacks the hour its containers had spoiled to when it froze and the place of each
 *   container (`[key, base, hot, outdoors]`: container × room factor, hot biome, outdoors) – rooms exist only in the active zone.
 * - `ahead`: chunks that caught up this tick past `lastHour` (the hour they reached); the next hourly pass starts them there.
 */
import { z } from 'zod';
import type { SpoilagePlace } from './formulas';

/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;

/** One frozen chunk. */
export interface FrozenSpoilage {
  readonly layer: number;
  readonly cx: number;
  readonly cy: number;
  readonly stamp: number;
  readonly places: Map<string, SpoilagePlace>;
}

const hour = z.number().int().min(-1);
const layer = z.number().int().min(LAYER_MIN).max(0);
const coord = z.number().int().min(0);

/** Saved spoilage. */
export const spoilageSnapshotSchema = z
  .object({
    lastHour: hour,
    frozen: z.array(
      z
        .object({
          layer,
          cx: coord,
          cy: coord,
          stamp: hour,
          behaelter: z.array(z.tuple([z.string().min(1), z.number().positive(), z.boolean(), z.boolean()])),
        })
        .strict(),
    ),
    ahead: z.array(z.tuple([layer, coord, coord, hour])),
  })
  .strict();
export type SpoilageSnapshot = z.output<typeof spoilageSnapshotSchema>;
