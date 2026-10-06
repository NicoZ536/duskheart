/**
 * Saved state of the places (participant `places`, data version 1; docs/SPIEL.md §27): one `PlaceState` per touched slot –
 * discovered or revealed, chest bits, living guards, cleansing and return tick, blessing ready tick, the one-time effect used.
 * Untouched slots have no entry (a place nobody saw needs none: everything else is content and world generation).
 */
import { z } from 'zod';
import type { PlaceRevealSource, PlaceState } from './types';

/** "Not yet" in the tick fields of `PlaceState` (`discoveredTick`, `cleansedTick`, `returnTick`). */
export const NOT_YET = -1;

/** A fresh state of slot `slot`. */
export function newPlaceState(slot: number): PlaceState {
  return { slot, discoveredTick: NOT_YET, revealedBy: null, chestsOpened: 0, guardsAlive: 0, cleansedTick: NOT_YET, returnTick: NOT_YET, blessingReadyTick: 0, used: false };
}

const tickOrNot = z.number().int().min(NOT_YET);
const REVEAL_SOURCES = ['entdeckt', 'kartentisch', 'aufgabe', 'haendlerin'] as const satisfies readonly PlaceRevealSource[];

export const placeStateSchema = z
  .object({
    slot: z.number().int().min(0),
    discoveredTick: tickOrNot,
    revealedBy: z.enum(REVEAL_SOURCES).nullable(),
    chestsOpened: z.number().int().min(0),
    guardsAlive: z.number().int().min(0),
    cleansedTick: tickOrNot,
    returnTick: tickOrNot,
    blessingReadyTick: z.number().int().min(0),
    used: z.boolean(),
  })
  .strict();

/** Snapshot of the participant: the touched slots in slot order. */
export const placesSnapshotSchema = z.object({ places: z.array(placeStateSchema) }).strict();
export type PlacesSnapshot = z.output<typeof placesSnapshotSchema>;

/** Copies a state (snapshots never share objects with the live state). */
export function copyPlaceState(s: Readonly<PlaceState>): PlaceState {
  return { slot: s.slot, discoveredTick: s.discoveredTick, revealedBy: s.revealedBy, chestsOpened: s.chestsOpened, guardsAlive: s.guardsAlive, cleansedTick: s.cleansedTick, returnTick: s.returnTick, blessingReadyTick: s.blessingReadyTick, used: s.used };
}
