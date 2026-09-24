/**
 * Sleep of the player (MASTERPROMPT §11.5): whether and where the player sleeps. Saved by the participant
 * `sleep`.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import type { SleepPlaceKind } from './formulas';

/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;
/** Highest comfort of a room [points]. §16.4: "Behaglichkeit 0–20". */
export const MAX_COMFORT = BALANCE.fear.decay.roomComfortForMax;

/** A place to sleep: a placed bed (reported by the building system) or a carried sleeping bag rolled out. */
export interface SleepPlace {
  readonly kind: SleepPlaceKind;
  /** Where the sleeper lies [world px]. */
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  /** Comfort of the room around it [0–20] (§16.4); 0 outdoors. */
  readonly comfort: number;
  /** In a bedroom (§16.4 "Schlafraum (Bett + Licht: Ausgeruht ×1,5)"). */
  readonly bedroom: boolean;
}

/** A sleep in progress. */
export interface Slumber {
  readonly place: SleepPlace;
  /** Begun outside the night: ends when exhaustion reaches 0. */
  readonly nap: boolean;
  /** Tick it began. */
  readonly sinceTick: number;
  /** 06:00 crossings of the clock when it began (the next one ends it). */
  readonly dawns: number;
}

/** Saved sleeping place. */
export const sleepPlaceSchema = z
  .object({
    kind: z.enum(Object.keys(BALANCE.sleep.places) as [SleepPlaceKind, ...SleepPlaceKind[]]),
    x: z.number(),
    y: z.number(),
    layer: z.number().int().min(LAYER_MIN).max(0),
    comfort: z.number().min(0).max(MAX_COMFORT),
    bedroom: z.boolean(),
  })
  .strict();

/** Saved sleep (participant `sleep`, version 1). */
export const slumberSchema = z
  .object({
    place: sleepPlaceSchema,
    nap: z.boolean(),
    sinceTick: z.number().int().min(0),
    dawns: z.number().int().min(0),
  })
  .strict();
