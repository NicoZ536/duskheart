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
  /**
   * Radius around the start beach (the world's spawn) kept free of stamped places [tiles]: a slot whose disc reaches into it
   * stays the free disc of M2 (no layout, no marker). The first evening's camp is built here (§4 "Startstrand", the base
   * a player raises within sight of the surf), so the open sand and meadow stay the player's own; the nearest places lie a
   * short walk inland, where the first exploration leads.
   */
  startClearTiles: 40,
  /**
   * Plants of the start beach (M7-107; src/world/gen/resources.ts `placeStartFlora`). A new world begins in spring, and on a
   * bare Salzküste beach only marram grass and fibre grass gave something to the hand – the herbarium of the first morning
   * stayed at two plants. Around the spawn the generator sees to hand-picked bushes and herbs that bear in spring.
   */
  startFlora: {
    /**
     * Radius around the spawn the start flora stands in and is counted in [tiles]: the start clearing (40) and eight tiles of
     * the meadow's edge behind it – the first morning's walk; where the start beach is all sand, the Grünhain begins there.
     */
    radiusTiles: 48,
    /** Inner radius the flora's patch centres keep from the spawn [tiles]: the first camp's ground and its view stay the beach. */
    innerTiles: 20,
    /**
     * Kinds of spring-bearing deposit plants within the radius [kinds] the generator guarantees: berries, herbs, a bush's
     * twigs – food, medicine, kindling, the three uses a first spring teaches.
     */
    depositKinds: 3,
    /**
     * Kinds pickable in spring within the radius [kinds] – the target the world tests check: the guaranteed deposit kinds and
     * the beach's marram grass, which the scatter grows on every start beach's dunes. More than the two of before (M7-107).
     */
    springKinds: 4,
    /** Patch centres tried per missing kind, nearest first [centres]: enough to cross the beach to the first meadow tiles. */
    patchTries: 64,
  },
} as const;
