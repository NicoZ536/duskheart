/**
 * Fast travel (docs/SPIEL.md §22 "Schnellreise", MASTERPROMPT §25; ADR-0207; strand F, system `travel`): between lit beacons,
 * burning hearth fires and way stones, paid in Lumen shards by distance; refused without Lumen, in a fight, with a boss
 * awake, and – with the world setting "Logistik-Realismus" – with ores and bars in the bags. Way stone names are saved
 * (participant `travel`); the travel screen reads one held record (`GameSession.sampleTravel`).
 */
import type { Layer } from '../../world/model/coords';

export const TRAVEL_POINT_KINDS = ['leuchtfeuer', 'herdfeuer', 'wegstein'] as const;
export type TravelPointKind = (typeof TRAVEL_POINT_KINDS)[number];
export interface TravelPoint {
  readonly id: string;
  readonly kind: TravelPointKind;
  readonly name: string;
  readonly layer: Layer;
  readonly tx: number;
  readonly ty: number;
}
/** Travel screen record (held, `GameSession.sampleTravel`). */
export interface TravelSample {
  from: string;
  points: TravelPoint[];
  costs: number[];
  blocked: string | null;
}
export interface TravelApi {
  /** Lumen shards for the trip: ⌈distance / BALANCE.travel.tilesPerLumen⌉, at least 1. */
  cost(from: TravelPoint, to: TravelPoint): number;
}
