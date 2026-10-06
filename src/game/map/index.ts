/** The map (docs/SPIEL.md §18 "Karte"; M7-49, strand B): reveal bit masks, own and derived markers. */
export { MAP_COMMAND_SCHEMAS } from './commands';
export { MAP_EVENT_TYPES, MAP_REJECT_REASONS, MAP_SFX, type MapEventMap, type MapRejectReason } from './events';
export { cellRevealed, cellsPerSide, countRevealed, decodeMask, encodeMask, maskBytes, revealDisc, revealRadius } from './formulas';
export { MAP_SAVE_VERSION, MAP_SYSTEM_ID, MapSystem, type MapDeps } from './system';
export { MAP_MARKER_KINDS, MAP_MARKER_SYMBOLS, type MapApi, type MapMarker, type MapMarkerKind, type MapMarkerSource, type MapMarkerSymbol, type MapMarkerVisitor } from './types';
