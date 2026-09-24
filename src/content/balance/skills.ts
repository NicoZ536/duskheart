/**
 * Balance values of the skills (MASTERPROMPT §23.2, M3-32) – group `BALANCE.skills` (src/content/balance.ts
 * re-exports it). The skills and their experience sources are content (src/content/skills.ts). Every value
 * states its unit and the reason for it.
 */
export const SKILL_BALANCE = {
  /** First level [level]. §23.2: "Stufe 1–100". */
  minLevel: 1,
  /** Last level [level]. §23.2: "Stufe 1–100". */
  maxLevel: 100,
  /** Factor of the level curve [XP]. §23.2: "EP-Bedarf 50 × stufe^1,6". */
  xpFactor: 50,
  /** Exponent of the level curve. §23.2: "EP-Bedarf 50 × stufe^1,6". */
  xpExponent: 1.6,
  /**
   * Effect per level above the first [fraction]. §23.2: "je Stufe +0,5 % Wirkung im Bereich". A new
   * character (level 1) has no bonus, so §D's "Grünhain-Baum: 5 Treffer mit Steinaxt" holds at the start.
   */
  bonusPerLevel: 0.005,
  /** Levels with a choice between two perks [level]. §23.2: "Bei 30/60/90 Wahl zwischen 2 Perks". */
  perkLevels: [30, 60, 90] as readonly number[],
  /** Perks offered at each of these levels [perks]. §23.2: "Wahl zwischen 2 Perks". */
  perkChoices: 2,
  /**
   * Temperature stress that counts as enduring cold or heat [°C]. The felt temperature must lie this far
   * outside the comfort band (§11.2) – a light chill at dusk teaches nothing.
   */
  enduredStressC: 3,
};
