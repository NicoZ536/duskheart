/**
 * Achievements (docs/SPIEL.md §23 "Erfolge", ADR-0207; strand G, system `achievements`, an observer): local per world, unlocked
 * once by their trigger (`achievementUnlocked`). Saved (participant `achievements`).
 */
export interface AchievementState {
  readonly id: string;
  readonly tick: number;
  /** Play time [ticks of play, statistic `spielzeit`] at the unlock – what the chronicle shows. */
  readonly spielzeit: number;
}
