/**
 * Events of the quests (aggregated into `SimEventMap`; docs/SPIEL.md §17 "Ereignisse zwischen Strängen"):
 * - `questStarted {quest}`: a quest began (at world start, or when its start trigger held) – the tracker shows it.
 * - `questStepCompleted {quest, schritt}`: a step's trigger held; the next step is active (Funke speaks its dialog).
 * - `questCompleted {quest}`: the last step held; the reward is given.
 * Refused commands raise `commandRejected` with a `QuestRejectReason` (texts `ui.aufgaben.reject.<reason>`).
 */

/** Why a quest command had no effect. */
export const QUEST_REJECT_REASONS = ['unknownQuest', 'unknownStep', 'questNotActive', 'trackerFull'] as const;
/** One reason a quest command was refused. */
export type QuestRejectReason = (typeof QUEST_REJECT_REASONS)[number];

export interface QuestEventMap {
  questStarted: { readonly quest: string; readonly tick: number };
  questStepCompleted: { readonly quest: string; readonly schritt: string; readonly tick: number };
  questCompleted: { readonly quest: string; readonly tick: number };
}

/** Event names of `QuestEventMap`. */
export const QUEST_EVENT_TYPES = ['questStarted', 'questStepCompleted', 'questCompleted'] as const satisfies ReadonlyArray<keyof QuestEventMap>;

/** Sounds of the quests (src/content/sfx/chronik.ts). */
export const QUEST_SFX = { started: 'sfx_chronik_aufgabe_neu', step: 'sfx_chronik_schritt', completed: 'sfx_chronik_aufgabe_fertig' } as const;
