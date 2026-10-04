/**
 * Quests at runtime (docs/SPIEL.md §23 "Aufgaben", ADR-0175; strand G, system `quests`, an observer): active and finished
 * quests with their current step and its armed trigger's count, up to three tracked in the HUD, the onboarding switch of the
 * world. Saved (participant `quests`). Commands (G): `quest.track {quest, on}`, `quest.onboarding {on}`.
 */
export const QUEST_STATUS = ['aktiv', 'erledigt'] as const;
export interface QuestState {
  readonly quest: string;
  status: (typeof QUEST_STATUS)[number];
  step: number;
  count: number;
  startedTick: number;
  tracked: boolean;
}
