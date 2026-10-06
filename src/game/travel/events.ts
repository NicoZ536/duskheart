/**
 * Events of fast travel (docs/SPIEL.md §22 "Schnellreise", M7-37; aggregated into `SimEventMap`):
 *
 * - `travelOpened`: E at a travel point – the travel screen opens with the points reachable from `von`.
 * - `travelled`: the player went from `von` to `nach` for `kosten` Lumen shards, arriving at (x, y) on `layer`.
 * - `travelPointRenamed`: a way stone got a name (`travel.rename`).
 * Refused travel commands raise `commandRejected` with a `TravelRejectReason`.
 */
import type { TravelPointKind } from './types';

/** Why a travel command had no effect. */
export const TRAVEL_REJECT_REASONS = [
  /** The player stands at no travel point (a lit beacon, a burning hearth, a way stone within reach). */
  'notAtPoint',
  /** No such travel point (gone out, torn down, never there). */
  'unknownPoint',
  /** The destination is the point the player stands at. */
  'samePoint',
  /** Fewer Lumen shards in the bags than the trip costs. */
  'notEnoughLumen',
  /** A blow given or taken within `BALANCE.travel.combatLockSeconds`. */
  'inFight',
  /** A boss is awake (its arena is sealed). */
  'bossAwake',
  /** Logistics realism (world setting): ores and bars do not travel. */
  'cargoNotTeleportable',
  /** No such way stone (`travel.rename`). */
  'unknownWaystone',
  /** The name is blank or longer than `BALANCE.travel.nameMaxLength`. */
  'nameInvalid',
] as const;
/** One reason. */
export type TravelRejectReason = (typeof TRAVEL_REJECT_REASONS)[number];

export interface TravelEventMap {
  travelOpened: { readonly von: string; readonly kind: TravelPointKind; readonly tick: number };
  travelled: { readonly von: string; readonly nach: string; readonly kind: TravelPointKind; readonly kosten: number; readonly x: number; readonly y: number; readonly layer: number; readonly tick: number };
  travelPointRenamed: { readonly wegstein: number; readonly name: string; readonly tick: number };
}

/** Event names of `TravelEventMap`. */
export const TRAVEL_EVENT_TYPES = ['travelOpened', 'travelled', 'travelPointRenamed'] as const satisfies ReadonlyArray<keyof TravelEventMap>;

/** Sound of a trip (src/content/sfx/leuchtfeuer.ts). */
export const TRAVEL_SFX = { travelled: 'sfx_reise_sprung' } as const;
