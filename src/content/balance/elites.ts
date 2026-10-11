/**
 * Balance values of the elites (MASTERPROMPT §20.1 "Elites: seltene, stärkere Varianten"; docs/SPIEL.md §26 "Kreaturen M7":
 * "seltene Spawnregel je Biom (höchstens einer je Region, nach Sieg … Ruhe)"; M7-17) – group `BALANCE.elites`
 * (src/content/balance.ts re-exports it; the contract's `BALANCE.creatures.eliteRestDays` is `BALANCE.elites.restDays`, every
 * strand keeps its values in its own group). Every value states its unit and the reason for it.
 */

export const ELITE_BALANCE = {
  /**
   * Rest of a region's lair after its elite fell [game days]. docs/SPIEL.md §26 "nach Sieg … Ruhe": a week – the player feels
   * the victory (the territory stays quiet, its essence is rare), the next elite comes back within a season (28 days).
   */
  restDays: 7,
  /**
   * Weight of an elite in Grünhain's spawn table [weight, against the table's entries]. §20.1 "seltene": the table's foes weigh
   * 0,5–1,2; a twentieth of the wolf's night weight (1,2) to a third of the badger's (0,6) – one elite in roughly every hundred
   * draws of a chunk, and only its region's lair may hold it.
   */
  spawnWeight: 0.15,
} as const;
