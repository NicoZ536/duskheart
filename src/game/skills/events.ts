/**
 * Events of the skills (aggregated into `SimEventMap`) – feedback hooks of MASTERPROMPT §23.2 and §2.7: the
 * presentation shows "+8 EP Holzfällen" over the player, a level-up fanfare with the skill's new level,
 * the perk choice dialog, and what death cost.
 *
 * - `xpGained`: an action gave XP (`source` = the experience source id of src/content/skills.ts).
 *   Continuous sources (sneaking, swimming, enduring cold) add up silently and show in the level only.
 * - `skillLevelUp`: a skill reached a new level.
 * - `perkChoiceOpened` / `perkChosen`: at levels 30/60/90 a choice between two perks opens / was taken.
 * - `skillProgressLost`: death took a share of the progress within the level.
 * Refused skill commands raise `commandRejected` with a `SkillRejectReason`.
 */

/** Why a skill command had no effect. */
export type SkillRejectReason =
  /** No such skill. */
  | 'unknownSkill'
  /** No open perk choice of this skill at this level. */
  | 'noPerkChoice';

export interface SkillEventMap {
  xpGained: { readonly skill: string; readonly amount: number; readonly source: string; readonly tick: number };
  skillLevelUp: { readonly skill: string; readonly level: number; readonly tick: number };
  perkChoiceOpened: { readonly skill: string; readonly level: number; readonly tick: number };
  perkChosen: { readonly skill: string; readonly level: number; readonly choice: number; readonly tick: number };
  skillProgressLost: { readonly skill: string; readonly amount: number; readonly tick: number };
}

/** Event names of `SkillEventMap`. */
export const SKILL_EVENT_TYPES = ['xpGained', 'skillLevelUp', 'perkChoiceOpened', 'perkChosen', 'skillProgressLost'] as const satisfies ReadonlyArray<keyof SkillEventMap>;

/** Sounds of the skills (`sfx_<bereich>_<name>`, docs/SPIEL.md §5; presets in M3-33). */
export const SKILL_SFX = {
  xp: 'sfx_fertigkeit_ep',
  levelUp: 'sfx_fertigkeit_aufstieg',
  perk: 'sfx_fertigkeit_perk',
} as const;
