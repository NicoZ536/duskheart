/**
 * Balance values of the vault puzzles (MASTERPROMPT §21 "Rätseltypen"; docs/SPIEL.md §19; M7-12, M7-13) – group
 * `BALANCE.puzzles`. The variants are content (src/content/dungeons/raetsel.ts). Every value states its unit and the reason.
 */

export const PUZZLES_BALANCE = {
  /** How long a lever stays down after a pull before the next counts [s]: a pull is a decision, not a double press. */
  leverCooldownSeconds: 0.5,
  /** Time between two tones when an inscription plays its tune [s]: slow enough to hear each bell (glocken). */
  toneSpacingSeconds: 0.6,
  /** Pause after a wrong bell or lever before the parts reset [s]: the player sees and hears the failure first. */
  resetDelaySeconds: 0.8,
} as const;
