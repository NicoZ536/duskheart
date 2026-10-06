/**
 * The map (docs/SPIEL.md §18 "Karte", MASTERPROMPT §25; ADR-0207; strand B, system `map`): what the player revealed per
 * layer (a bit mask of map cells, saved run-length and Base64 encoded), the player's own markers (saved) and the markers
 * other systems derive (places, beacons, the grave, bases, the quest target – never saved).
 */
import type { Layer } from '../../world/model/coords';
import type { Simulation } from '../sim';

export const MAP_MARKER_SYMBOLS = ['eigen_1', 'eigen_2', 'eigen_3', 'eigen_4', 'eigen_5', 'eigen_6', 'eigen_7', 'eigen_8'] as const;
export type MapMarkerSymbol = (typeof MAP_MARKER_SYMBOLS)[number];
export const MAP_MARKER_KINDS = ['eigen', 'ort', 'leuchtfeuer', 'grab', 'basis', 'aufgabe', 'haendlerin'] as const;
export type MapMarkerKind = (typeof MAP_MARKER_KINDS)[number];
/** A player's own marker (saved, at most `BALANCE.map.maxMarkers`). */
export interface MapMarker {
  readonly id: number;
  readonly symbol: MapMarkerSymbol;
  readonly name: string;
  readonly layer: Layer;
  readonly tx: number;
  readonly ty: number;
}
/** Derived markers of other systems (never saved): `sprite` is the map symbol (`karte_<…>`), `ref` the content id that names it. */
export type MapMarkerVisitor = (kind: MapMarkerKind, sprite: string, ref: string, layer: Layer, tx: number, ty: number) => void;
export type MapMarkerSource = (sim: Simulation, layer: Layer, visit: MapMarkerVisitor) => void;
export interface MapApi {
  revealed(layer: Layer, tx: number, ty: number): boolean;
  /** Reveals a disc (look-out tower 80, height bonus); used by `places`, debug `map.reveal`. */
  revealCircle(sim: Simulation, layer: Layer, tx: number, ty: number, radiusTiles: number): void;
  addMarkerSource(source: MapMarkerSource): void;
}
