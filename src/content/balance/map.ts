/**
 * Balance values of the map (MASTERPROMPT §25 "Karte (M): … Nebel über Unerkundetem, Aufdeckung im Radius 20 Tiles (auf Höhen
 * mehr), Aussichtstürme 80 … Marker … eigene (Symbol + Name)"; docs/SPIEL.md §18 "Karte"; M7-49) – group `BALANCE.map`
 * (src/content/balance.ts re-exports it). The look-out tower's radius belongs to its location type (`PlaceDef.wirkung`). Every
 * value states its unit and the reason for it.
 */

export const MAP_BALANCE = {
  /**
   * Edge of one map cell [tiles]: the reveal is a bit mask of cells. docs/SPIEL.md §18 "Kartenzellen zu 4 × 4 Kacheln" – a
   * Mittel world is 384² cells, 18 432 B per layer; finer than the map's widest zoom draws, coarse enough to save in a few KiB.
   */
  cellTiles: 4,
  /** Radius the player reveals around them [tiles]. §25 "Aufdeckung im Radius 20 Tiles". */
  revealRadiusTiles: 20,
  /**
   * Extra reveal radius per height level above the ground level 0 [tiles per level]. §25 "auf Höhen mehr": from a hill of
   * level 4 the view reaches 20 + 4 × 6 = 44 tiles – about half the look-out tower's 80, so the towers stay worth the climb.
   */
  heightBonusTiles: 6,
  /** Most own markers [count]. docs/SPIEL.md §18 "Eigene Marker (höchstens 64)" – enough for every base, cave and find. */
  maxMarkers: 64,
  /** Longest name of an own marker [characters]. docs/SPIEL.md §18 "Name ≤ 24 Zeichen" – one line of the map's label. */
  markerNameMax: 24,
} as const;
