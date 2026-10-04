/**
 * Balance values of the condition system (MASTERPROMPT §11.3, M3-19) – group `BALANCE.conditions`
 * (src/content/balance.ts re-exports it). The conditions themselves – durations, stack rules, effects –
 * are content data (src/content/conditions.ts); this group holds the rules around them. Every value
 * states its unit and the reason for it.
 */
export const CONDITION_BALANCE = {
  wellFed: {
    /**
     * Satiety from which the player is "Wohlgenährt" [points of 100]. The top fifth of the bar: a
     * player who eats regularly keeps it for the first quarter of the 36 min a full bar lasts (§11.1).
     */
    satietyFrom: 80,
    /** Thirst from which the player is "Wohlgenährt" [points of 100]. As satiety: fed and watered together. */
    thirstFrom: 80,
  },
  /** What the conditions do to the player's deeds (M6-78; src/game/conditions/system.ts `precision`, `actionSpeed`). */
  player: {
    /**
     * Widest half-angle a lowered precision opens a shot's spread to [°]: the spread grows as 1 / precision – Geblendet
     * (0,5) doubles a bow's 4° to 8°, with Beschwipst and Frierend on top a bow reaches ≈ 10° and a sling ≈ 18° –, but a
     * precision near 0 would send the shot sideways; at 30° it still flies into the third of the view it was aimed at.
     */
    maxSpreadDeg: 30,
  },
};
