/**
 * Places in the generated world (docs/SPIEL.md §18, ADR-0207; strand B): layouts compiled from the content, the choice of a
 * layout per slot (the generator's step `orte`) and the stamping into surface chunks.
 */
export { compileLayout, contentPlaceLayouts, layoutCellAt, markOf, NO_MARK, placeLayout, turnedSize, type CompiledLayout } from './layouts';
export { extraPlaceDiscs, layoutFitsDisc, placeCandidates, placementOf, selectPlaceLayouts, type StampTest } from './select';
export { PlaceStamper, STAMP_ALL, STAMP_MARK, STAMP_NONE, stampRight, type StampTiles } from './stamp';
export type { PlaceMarker, PlacePlacement, QuarterTurn } from './types';
