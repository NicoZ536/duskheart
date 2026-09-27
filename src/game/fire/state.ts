/**
 * State of the fire simulation (MASTERPROMPT §16.2, §16.8, §10; M4-28) and its save form (participant `fire`).
 *
 * - `cells`: every burning tile – layer and tile, the world second it caught fire (`seit`), the last world second it
 *   burned (`bis`; it burns on from `bis + 1`), the spread plan (`plan`: per direction N, NE, E, SE, S, SW, W, NW the
 *   world second it reaches that neighbour, −1 never, −2 undecided – the neighbour lies in a chunk outside the active
 *   zone and is decided when that chunk activates; `null` until its first second) and the burn hit points left of a
 *   standing tree on the tile (`baum`, −1 before the first second or without a tree).
 *   World second s = tick / 60: the world tick at tick 60 s burns second s (§3.3 "Welt-Tick 1 Hz"). Cells in active
 *   chunks burn at every world tick; frozen ones catch up second by second when their chunk activates.
 * - `klima`: per weather region the climate of the past seconds as runs `[second, code, second, code …]` – whether it
 *   rained, the wind class and its direction – recorded at every world tick for the regions a burning tile lies in or
 *   borders on, from the earliest second one of them still has to burn: a frozen fire meets exactly the rain and wind
 *   a ticking one met (catching up never needs the weather's past), and regions without fire keep no log.
 */
import { z } from 'zod';
import type { Layer } from '../../world/model/coords';

/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;
/** Neighbour directions of a tile (N, NE, E, SE, S, SW, W, NW). */
export const FIRE_DIRECTIONS = 8;
/** "Never" in a spread plan. */
export const NO_SPREAD = -1;
/** "Undecided" in a spread plan: the neighbour's chunk is outside the active zone; its activation decides. */
export const PENDING_SPREAD = -2;

/** A burning tile. */
export interface FireCell {
  readonly layer: Layer;
  readonly tx: number;
  readonly ty: number;
  /** World second it caught fire. */
  readonly seit: number;
  /** Last world second it burned. */
  bis: number;
  /** World second it reaches each neighbour (`NO_SPREAD`: never, `PENDING_SPREAD`: undecided), or `null` before its first second. */
  plan: number[] | null;
  /** Burn hit points left of the standing tree on the tile, −1 before its first second or without a tree. */
  baum: number;
}

/** State of the fire system. */
export interface FireState {
  /** Burning tiles by tile key. */
  readonly cells: Map<number, FireCell>;
  /** Climate runs per weather region. */
  readonly klima: Map<number, number[]>;
}

/** An empty state. */
export function createFireState(): FireState {
  return { cells: new Map(), klima: new Map() };
}

const second = z.number().int().min(0);

/** Saved form of the fire state. */
export const fireSnapshotSchema = z
  .object({
    cells: z.array(
      z
        .object({
          layer: z.number().int().min(LAYER_MIN).max(0),
          tx: z.number().int().min(0),
          ty: z.number().int().min(0),
          seit: second,
          bis: second,
          plan: z.array(z.number().int().min(PENDING_SPREAD)).length(FIRE_DIRECTIONS).nullable(),
          baum: z.number().int().min(-1),
        })
        .strict(),
    ),
    klima: z.array(z.tuple([z.number().int().min(0), z.array(z.number().int().min(0))])),
  })
  .strict();

/** Saved form of the fire state. */
export type FireSnapshot = z.output<typeof fireSnapshotSchema>;
