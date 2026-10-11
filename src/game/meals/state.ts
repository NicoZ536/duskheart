/**
 * State of the meals (docs/SPIEL.md §27 "meals 1: Überdruss-Zähler"): the boredom counter of every dish eaten lately [pieces;
 * multiples of 0,5]. Saved by the participant `meals` in item order, without counters that faded to 0.
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';

/** Saved meals (participant `meals`, version 1): `[item, counter]` in ascending item order. */
export const mealsSnapshotSchema = z
  .object({
    ueberdruss: z.array(z.tuple([idSchema, z.number().positive()])),
  })
  .strict();
export type MealsSnapshot = z.output<typeof mealsSnapshotSchema>;
