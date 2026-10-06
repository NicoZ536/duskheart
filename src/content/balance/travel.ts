/**
 * Balance values of fast travel (MASTERPROMPT §25 "Schnellreise zwischen entzündeten Leuchtfeuern, Herdfeuern und
 * Wegsteinen (Lumen-Kosten nach Distanz). Option „Logistik-Realismus“: Erze und Barren nicht teleportierbar"; docs/SPIEL.md
 * §22; M7-37) – group `BALANCE.travel` (src/content/balance.ts re-exports it). Every value states its unit and the reason
 * for it.
 */

export const TRAVEL_BALANCE = {
  /**
   * Distance one Lumen shard pays for [tiles]. §D "Lumen-Scherben ≈ 15–25 pro aktiver Nacht auf Stufe 1": a trip across a
   * medium world (≈ 1 500 tiles) costs 8 shards – a night's hunt pays for a few long trips, a short hop costs one.
   */
  tilesPerLumen: 200,
  /** Fewest shards a trip costs [shards]. docs/SPIEL.md §22: "mindestens 1". */
  minCost: 1,
  /** The item that pays [item id]. §25 "Lumen-Kosten": the Lumen shard, the loot of the shadow brood (§12.4). */
  currency: 'lumen_scherbe',
  /**
   * Time after the last blow given or taken in which travel is refused [s] (docs/SPIEL.md §22 "abgelehnt … im Kampf").
   * Five seconds: a fight that just ended has to be left on foot, not by vanishing mid-swing.
   */
  combatLockSeconds: 5,
  /** Reach of E at a travel point [tiles] (a way stone, a lit beacon, a burning hearth), from its centre: like a station's. */
  reachTiles: 3,
  /** Longest name of a way stone [characters]. A label on the travel screen's list, short like a chest's (§16.7). */
  nameMaxLength: 24,
  /** Stand-off of the arrival spot south of a travel point's centre [tiles]: in front of it, not on it. */
  arrivalOffsetTiles: 2,
};
