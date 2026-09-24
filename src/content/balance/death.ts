/**
 * Balance values of death and respawn (MASTERPROMPT §11.6, §29, M3-26) – group `BALANCE.death`
 * (src/content/balance.ts re-exports it). Every value states its unit and the reason for it.
 */

/** Difficulty presets of §29 (Entspannt, Normal, Hart, Unbarmherzig). */
export const DIFFICULTIES = ['entspannt', 'normal', 'hart', 'unbarmherzig'] as const;
/** One difficulty preset. */
export type Difficulty = (typeof DIFFICULTIES)[number];

/** What goes into the grave: nothing, the carried bags (equipment stays on), or everything. */
export const GRAVE_CONTENTS = ['nichts', 'inventar', 'alles'] as const;
/** One grave rule. */
export type GraveContents = (typeof GRAVE_CONTENTS)[number];

/** Penalties of one difficulty (§29 table, column "Tod"). */
export interface DeathPenalty {
  /** What the grave takes. */
  readonly grave: GraveContents;
  /** Share of the current progress within each skill level that is lost [fraction]. */
  readonly skillLoss: number;
  /** The world ends with the death (no respawn). */
  readonly permadeath: boolean;
}

export const DEATH_BALANCE = {
  /**
   * Penalties per difficulty. §29: Entspannt "Inventar bleibt" · Normal "Inventar im Grab (Ausrüstung
   * bleibt), −25 % Skill-Fortschritt" · Hart "alles im Grab" · Unbarmherzig "Permadeath". §29 names the
   * skill loss only for Normal: Entspannt keeps it (it punishes nothing), Hart keeps Normal's loss and
   * sharpens the grave instead, Unbarmherzig ends the world.
   */
  penalties: {
    entspannt: { grave: 'nichts', skillLoss: 0, permadeath: false },
    normal: { grave: 'inventar', skillLoss: 0.25, permadeath: false },
    hart: { grave: 'alles', skillLoss: 0.25, permadeath: false },
    unbarmherzig: { grave: 'alles', skillLoss: 0.25, permadeath: true },
  } satisfies Record<Difficulty, DeathPenalty>,
  /** Difficulty of a world until the player chooses another one [preset]. §29: "Normal" is the reference of all balance values. */
  defaultDifficulty: 'normal' as Difficulty,
  /** Condition after a respawn. §11.6: "danach 3 min „Erschüttert“ (−15 % max. Leben)" – duration and effect are the condition's content. */
  respawnCondition: 'erschuettert',
  /**
   * Least satiety and thirst after a respawn [points of 100]. A player who died of hunger or thirst would
   * otherwise starve again at once on the beach; half a bar leaves time to find food and water.
   */
  respawnMinSatiety: 50,
  respawnMinThirst: 50,
  /** Distance from which the player can take items out of the grave [tiles]. The interaction reach of §11.4. */
  graveReachTiles: 2,
};
