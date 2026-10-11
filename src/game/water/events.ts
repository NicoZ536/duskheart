/**
 * Events of water (aggregated into `SimEventMap`; docs/SPIEL.md §21 "Wasser"): the presentation plays the gurgle of a skin
 * filling, the collector's splash; the observers count them (strand G).
 *
 * - `vesselFilled`: a water skin, a bucket or the boiled bucket was filled at a river, lake or spring (`quelle` = the water's
 *   source) or at a rain collector (`regensammler`), with the sips it now holds.
 * - `collectorPlaced` / `collectorRemoved`: a rain collector came onto or left the build grid.
 * Refused water commands raise `commandRejected` with a `WaterRejectReason`.
 */
export const WATER_REJECT_REASONS = ['noVessel', 'notWaterSource', 'collectorEmpty', 'vesselFull', 'vesselEmpty'] as const;
/** Why a water command had no effect: nothing to fill in the hand, no fresh water or collector there, the collector dry, the vessel full or empty. */
export type WaterRejectReason = (typeof WATER_REJECT_REASONS)[number];

export interface WaterEventMap {
  vesselFilled: { readonly item: string; readonly quelle: string; readonly schlucke: number; readonly layer: number; readonly tx: number; readonly ty: number; readonly tick: number };
  collectorPlaced: { readonly layer: number; readonly tx: number; readonly ty: number; readonly tick: number };
  collectorRemoved: { readonly layer: number; readonly tx: number; readonly ty: number; readonly tick: number };
}

/** Event names of `WaterEventMap`. */
export const WATER_EVENT_TYPES = ['vesselFilled', 'collectorPlaced', 'collectorRemoved'] as const satisfies ReadonlyArray<keyof WaterEventMap>;

/** Sounds of water (`sfx_<bereich>_<name>`, defined with the kitchen's in src/content/sfx/kueche.ts). */
export const WATER_SFX = {
  fillSkin: 'sfx_wasser_schlauch_fuellen',
  fillCollector: 'sfx_wasser_sammler_schoepfen',
} as const;
