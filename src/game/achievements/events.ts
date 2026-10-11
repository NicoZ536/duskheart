/**
 * Events of the achievements (aggregated into `SimEventMap`; docs/SPIEL.md §17 "Ereignisse zwischen Strängen"):
 * - `achievementUnlocked {achievement}`: an achievement's trigger held for the first time in this world – the UI shows it,
 *   the chronicle writes it down, its sound plays (src/audio/eventMap.ts).
 */

export interface AchievementEventMap {
  achievementUnlocked: { readonly achievement: string; readonly tick: number };
}

/** Event names of `AchievementEventMap`. */
export const ACHIEVEMENT_EVENT_TYPES = ['achievementUnlocked'] as const satisfies ReadonlyArray<keyof AchievementEventMap>;

/** Sound of an unlocked achievement (src/content/sfx/chronik.ts). */
export const ACHIEVEMENT_SFX = { unlocked: 'sfx_chronik_erfolg' } as const;
