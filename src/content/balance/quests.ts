/**
 * Balance values of the chronicle, quests, statistics and achievements (MASTERPROMPT §23.3 "Chronik (J)", §26 "rechts
 * Aufgaben- und Rezept-Tracker"; docs/SPIEL.md §23; M7-41 … M7-43, M7-47) – group `BALANCE.quests`
 * (src/content/balance.ts re-exports it). Every value states its unit and the reason for it.
 */

export const QUESTS_BALANCE = {
  /** Quests followed in the HUD's tracker at once [quests]. docs/SPIEL.md §23 "bis 3 verfolgte Aufgaben (`quest.track`)". */
  trackedMax: 3,
  /**
   * Diary entries the chronicle keeps [entries]; older ones fall out (their numbers stay counted). A diary rule fires on
   * moments (a place found, a boss, a first harvest), a long game of M14 makes a few hundred of them – 500 keep a whole game
   * of 40 hours readable without growing the save without bound.
   */
  chronicleMaxEntries: 500,
  /**
   * Longest step the walked distance counts in one tick [tiles]. A sprint covers about 0,15 tiles per tick (§11.4, 9 tiles/s
   * at 60 Hz); a longer step is a jump – fast travel, a respawn, a teleport – and no walking (statistic `distanz`).
   */
  distanceMaxStepTiles: 1,
  /** Quests the world starts and checks per world tick at most [quests]: all of M7 (two) and room for the side quests of M9. */
  questsMax: 64,
};
