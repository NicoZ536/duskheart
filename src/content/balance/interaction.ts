/**
 * Balance values of interacting and picking up (MASTERPROMPT §11.4 "Interagieren (E)", "Aufheben:
 * Kleinteile im Radius 1,5 Tiles automatisch (Magnet), sonst E"; §14 "fliegende Drops mit Magnet";
 * M3-10) – group `BALANCE.interaction` (src/content/balance.ts re-exports it). Every value states its
 * unit and the reason for it.
 */
export const INTERACTION_BALANCE = {
  /**
   * Reach of E and of every tool action [tiles], measured from the player's feet to the nearest edge
   * of the target (the footprint of an object, the tile of a drop or of dug ground). An arm plus a tool
   * reaches the neighbouring tile from anywhere inside the own tile: the far edge of the own tile is one
   * tile away, half a tile more covers a diagonal neighbour.
   */
  reachTiles: 1.5,
  /**
   * How much closer a target in front of the player counts when the focus is chosen [tiles]. The
   * player looks at what they walk towards: with two targets at about the same distance the one in
   * front wins, but a target right beside the player still beats one a step ahead.
   */
  facingBonusTiles: 0.5,
  /** Radius in which small items fly to the player by themselves [tiles]. §11.4: "Kleinteile im Radius 1,5 Tiles automatisch (Magnet)". */
  magnetRadiusTiles: 1.5,
  /**
   * Speed of a drop pulled by the magnet [tiles/s]. Faster than a sprint (7 tiles/s, §11.4), so a pulled
   * drop always catches up with a running player; a drop from the edge of the radius arrives in ≈ 0,15 s.
   */
  magnetSpeedTilesPerSecond: 10,
  /** Distance from the feet at which a pulled drop is collected [tiles]: it disappears into the body, not past it. */
  collectDistanceTiles: 0.25,
  drops: {
    /**
     * Flight time of a drop that pops out of a harvested object [s]. The eye follows the arc (§14
     * "fliegende Drops"); long enough to read where it lands, short enough that the pick-up is not held up.
     */
    flightSeconds: 0.45,
    /** Closest landing spot to the source [tiles]: the drop visibly leaves the object instead of hiding at its foot. */
    landingMinTiles: 0.5,
    /** Farthest landing spot from the source [tiles]: drops of one harvest stay within the magnet radius of a player next to it. */
    landingMaxTiles: 1.25,
    /** Time a landed drop lies still before the magnet takes it [s]: the player sees what fell before it flies over. */
    settleSeconds: 0.25,
    /**
     * Lifetime of a drop nobody picks up [game minutes]. Ten game hours (10 real minutes at the default
     * day length): enough to fetch what was left behind after a fight or a full bag (a trip to a chest
     * and back), short enough that forgotten drops do not pile up over days.
     */
    lifetimeGameMinutes: 600,
    /** Drops of the same item that land this close join one stack [tiles]: a felled tree leaves "Holz ×4", not four logs. */
    mergeRadiusTiles: 0.75,
  },
};
