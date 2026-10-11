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
   * Weight of an elite in Grünhain's night table [weight, against the table's entries]. §20.1 "seltene": the table's foes weigh
   * 0,8–4, the whole table 18,5 (winter) to 23,5 (summer); an eighth of the wolf's weight (1,2) gives each elite 0,6–0,8 % of a
   * chunk's night draws – one in 125–160 – and only its region's lair may hold it.
   */
  spawnWeight: 0.15,
} as const;
