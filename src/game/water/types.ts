/**
 * Water (docs/SPIEL.md §21 "Wasser", ADR-0207; strand E, system `water`): rain collectors fill from the rain of the climate
 * log (caught up per day while frozen, participant `water`), the water skin holds charges, boiling makes water clean.
 */

/** A rain collector (build part `regensammler`), saved per chunk (participant `water`). */
export interface RainCollectorState {
  readonly layer: number;
  readonly tx: number;
  readonly ty: number;
  fill: number;
}
export interface WaterApi {
  collectorAt(layer: number, tx: number, ty: number): Readonly<RainCollectorState> | undefined;
}
