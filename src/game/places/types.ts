/**
 * The places at runtime (docs/SPIEL.md §18, ADR-0207; strand B, system `places`): discovery, chests, guards (owned creatures,
 * `ort:<slot>`), cleansing and the return of guards after `BALANCE.places.returnDays`, the effects of look-outs, shrines and
 * dig sites. A slot's state is saved once it was touched (participant `places`).
 */
import type { Layer } from '../../world/model/coords';
import type { LocationType } from '../../world/gen/locations';
import type { PlacePlacement } from '../../world/gen/places/types';
import type { Simulation } from '../sim';

export type PlaceRevealSource = 'entdeckt' | 'kartentisch' | 'aufgabe' | 'haendlerin';
/** Saved state of a touched slot (participant `places`). */
export interface PlaceState {
  readonly slot: number;
  discoveredTick: number;
  revealedBy: PlaceRevealSource | null;
  /** Bit i = chest marker i opened. */
  chestsOpened: number;
  /** Guards spawned and not yet killed in the current round. */
  guardsAlive: number;
  /** Tick the place was cleansed (−1 = not), and the tick part of the guards returns. */
  cleansedTick: number;
  returnTick: number;
  /** Shrine: blessing ready again from this tick; other effects: used once. */
  blessingReadyTick: number;
  used: boolean;
}
export interface PlacesApi {
  state(slot: number): Readonly<PlaceState> | undefined;
  isDiscovered(slot: number): boolean;
  /** Reveals a slot on the map without visiting it (`placeRevealed`); false if unknown or already known. */
  reveal(sim: Simulation, slot: number, source: PlaceRevealSource): boolean;
  /** Nearest slot of `type` that is neither discovered nor revealed, or −1. */
  nearestHidden(type: LocationType, layer: Layer, tx: number, ty: number): number;
  placementOf(slot: number): PlacePlacement | undefined;
  /** First marker of `mark` in the slot's placement into `out`; false if none. */
  markerOf(slot: number, mark: string, out: { tx: number; ty: number; data: string }): boolean;
  forEachKnown(visit: (slot: number, state: Readonly<PlaceState>) => void): void;
}
