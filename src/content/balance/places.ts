/**
 * Balance values of the places (MASTERPROMPT §21 "Weitere Orte", "Gegner in Orten kehren nach 7 Tagen teilweise zurück,
 * Truhen nicht"; docs/SPIEL.md §18; M7-07 … M7-09) – group `BALANCE.places` (src/content/balance.ts re-exports it). The
 * location types, their layouts and their chest loot are content (src/content/places/). Every value states its unit and the
 * reason for it.
 */

export const PLACES_BALANCE = {
  /**
   * Discovery radius beyond the slot's own radius when a location type names none [tiles]. docs/SPIEL.md §18 "Standard
   * Slot-Radius + 4": the player sees the place from its edge, a few steps before standing in it.
   */
  discoverExtraTiles: 4,
  /** Game days after the cleansing until guards come back [days]. §21 "Gegner in Orten kehren nach 7 Tagen teilweise zurück". */
  returnDays: 7,
  /** Share of a place's guards that come back [0–1], rounded up. §21 "teilweise" – half the guards, at least one. */
  returnShare: 0.5,
  /**
   * Leash of a place's guards when the location type names none [tiles]. They keep to their place like a pack to its den
   * (the AI profile's `streifen` is the floor, `leashTiles ≥ streifen`, docs/SPIEL.md §17 "Besitz-Kreaturen").
   */
  guardLeashTiles: 12,
  /**
   * Distance of a guard's spawn point from its mark when several guards share one mark [tiles]. They stand around it
   * like a group, not on top of each other (one tile apart, the creature collision's size).
   */
  guardSpreadTiles: 1,
  /**
   * Reach of a place's uses from the player's feet to the mark's centre [tiles]: the tower door, the shrine's altar, a note
   * and a chest are used standing at them, like a station (§15) – the interaction offers them within its own reach first.
   */
  useReachTiles: 2.5,
} as const;
