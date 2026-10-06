/**
 * Events of the map (aggregated into `SimEventMap`; docs/SPIEL.md §18 "Karte"; M7-49) – what the player does with their own
 * markers. The reveal itself raises no event (it happens on every cell the player enters; the map and minimap read its version).
 *
 * - `mapMarked`: an own marker was set (`id`, `symbol`, tile and layer); a quill scratches.
 * - `mapUnmarked`: an own marker was removed. `mapRenamed`: an own marker got a new name.
 *
 * Refused commands raise `commandRejected` with a `MapRejectReason` (texts `ui.karte.reject.<reason>`).
 */
import type { MapMarkerSymbol } from './types';

/**
 * Why a map command had no effect:
 * - `tooManyMarkers` – `BALANCE.map.maxMarkers` own markers stand already; `unknownMarker` – no own marker has that id;
 * - `outOfWorld` – the tile lies outside the world; `emptyName` – the name is empty after trimming.
 */
export const MAP_REJECT_REASONS = ['tooManyMarkers', 'unknownMarker', 'outOfWorld', 'emptyName'] as const;
/** One reason a map command was refused. */
export type MapRejectReason = (typeof MAP_REJECT_REASONS)[number];

export interface MapEventMap {
  mapMarked: { readonly id: number; readonly symbol: MapMarkerSymbol; readonly layer: number; readonly tx: number; readonly ty: number; readonly tick: number };
  mapUnmarked: { readonly id: number; readonly tick: number };
  mapRenamed: { readonly id: number; readonly tick: number };
}

/** Event names of `MapEventMap`. */
export const MAP_EVENT_TYPES = ['mapMarked', 'mapUnmarked', 'mapRenamed'] as const satisfies ReadonlyArray<keyof MapEventMap>;

/** Sound of setting a marker (src/content/sfx/orte.ts). */
export const MAP_SFX = { marked: 'sfx_karte_markiert' } as const;
