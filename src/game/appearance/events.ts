/**
 * Events of the appearance (aggregated into `SimEventMap`; docs/SPIEL.md §17 "Ereignisse zwischen Strängen"):
 * `appearanceChanged` – the appearance was chosen (`appearance.set`); the renderer rebuilds the figure. Refused commands raise
 * `commandRejected` with an `AppearanceRejectReason`.
 */

/** Why `appearance.set` had no effect. */
export type AppearanceRejectReason =
  /** The appearance was chosen already – it changes only through a later mirror (docs/SPIEL.md §26). */
  'appearanceLocked';

export interface AppearanceEventMap {
  appearanceChanged: { readonly tick: number };
}

/** Event names of `AppearanceEventMap`. */
export const APPEARANCE_EVENT_TYPES = ['appearanceChanged'] as const satisfies ReadonlyArray<keyof AppearanceEventMap>;
