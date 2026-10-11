/**
 * Balance values of the perk effects of the non-combat skills (MASTERPROMPT §23.2 "alle spürbar"; docs/SPIEL.md §23 "Perks M7";
 * M7-48) – group `BALANCE.perkEffects` (src/content/balance.ts re-exports it). Every value states its unit and the reason for it.
 */

export const PERK_EFFECTS_BALANCE = {
  /**
   * Least factor a perk leaves on a drain, a cost, a noise or a regrowth time [factor]. Perks of two levels of one skill add up
   * (Genügsam −30 % and Wildniskind −40 % make −70 %); a fifth keeps every need, every swim and every step a thing to mind –
   * hunger never stops, a sneaking step is never silent, a picked bush never grows back the same hour.
   */
  minFactor: 0.2,
};
