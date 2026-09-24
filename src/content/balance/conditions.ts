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
};
