/**
 * Place layouts in the generated world (docs/SPIEL.md §18, ADR-0175; strand B): the generator's step `orte` picks one layout
 * of the content (`placeLayouts`) per slot of `GeneratedWorld.locations` – a pure function of seed, slot id and content –
 * and the chunk generator stamps its ground and objects into the surface chunks. The marks of the layout (chests, guards,
 * tablet, beacon, altar, entrance, look-out, dig site …) are kept with world coordinates for the systems that read them.
 */
import type { PlaceMark } from '../../../content/places/schema';
import type { LocationType } from '../locations';

/** Quarter turns of a stamped layout (clockwise). */
export type QuarterTurn = 0 | 1 | 2 | 3;

export interface PlaceMarker {
  readonly mark: PlaceMark;
  readonly tx: number;
  readonly ty: number;
  readonly data: string;
}
/** The layout chosen for a slot – pure function of (seed, slot id, content); never saved. */
export interface PlacePlacement {
  readonly slot: number;
  readonly type: LocationType;
  readonly layout: string;
  readonly rotation: QuarterTurn;
  readonly mirror: boolean;
  /** North-west corner and size of the stamped rectangle [tiles]. */
  readonly x0: number;
  readonly y0: number;
  readonly width: number;
  readonly height: number;
  readonly markers: readonly PlaceMarker[];
}
// GeneratedWorld (src/world/gen/world.ts): readonly placeLayouts: readonly PlacePlacement[] (slot order; slots without a layout have none).
