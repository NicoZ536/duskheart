/**
 * Simulation events of the survival stats (MASTERPROMPT §2.7 "Jede Aktion hat visuelles und akustisches
 * Feedback"): the presentation turns them into the hit flash of the player sprite, a hurt sound per
 * cause and HUD warnings; the conditions system (M3-19) can follow the stage changes.
 *
 * - `playerDamaged`: health lost – instantly (a fall) or as damage over time, reported once per second
 *   per cause with the amount of that second. `health` is the value afterwards; `lethal` when it hit 0.
 * - `survivalStageChanged`: a stat entered another stage (`stat` and `stage` ids as in
 *   src/game/survival/formulas.ts and docs/SPIEL.md §6: e.g. `satiety` → `hungrig`, `temperature` →
 *   `frierend`, `drowning` → `ertrinkend`).
 */
import type { Entity } from '../../engine/ecs';
import type { ContinuousDamageCause } from './state';

/** Every cause of player damage the survival rules produce (§11.1, §11.2, §11.4). */
export type DamageCause = ContinuousDamageCause | 'sturz';

/** Stats whose stages are reported. */
export type SurvivalStat = 'satiety' | 'thirst' | 'exhaustion' | 'wetness' | 'temperature' | 'drowning';

export interface SurvivalEventMap {
  playerDamaged: { readonly entity: Entity; readonly cause: DamageCause; readonly amount: number; readonly health: number; readonly lethal: boolean; readonly tick: number };
  survivalStageChanged: { readonly entity: Entity; readonly stat: SurvivalStat; readonly stage: string; readonly previous: string; readonly tick: number };
}

/** Event names of `SurvivalEventMap`. */
export const SURVIVAL_EVENT_TYPES = ['playerDamaged', 'survivalStageChanged'] as const satisfies ReadonlyArray<keyof SurvivalEventMap>;

/** Stage of `drowning` while swimming without stamina (condition id `ertrinkend`, docs/SPIEL.md §6). */
export const DROWNING_STAGE = 'ertrinkend';
/** Stage of `drowning` otherwise. */
export const BREATHING_STAGE = 'atmend';

/**
 * Sound ids of the survival feedback (`sfx_<bereich>_<name>`, docs/SPIEL.md §5) for the audio kernel
 * (M3-33): a hurt sound per cause, one sound per stage entered.
 */
export const SURVIVAL_SFX = {
  damage: { sturz: 'sfx_spieler_aufprall', hunger: 'sfx_spieler_magenknurren', durst: 'sfx_spieler_keuchen', ertrinken: 'sfx_spieler_ertrinken', kaelte: 'sfx_spieler_zittern', hitze: 'sfx_spieler_keuchen' } satisfies Record<DamageCause, string>,
  stage: {
    hungrig: 'sfx_spieler_magenknurren',
    verhungernd: 'sfx_spieler_magenknurren',
    durstig: 'sfx_spieler_keuchen',
    verdurstend: 'sfx_spieler_keuchen',
    muede: 'sfx_spieler_gaehnen',
    erschoepft: 'sfx_spieler_gaehnen',
    durchnaesst: 'sfx_wasser_tropfen',
    frierend: 'sfx_spieler_zittern',
    unterkuehlt: 'sfx_spieler_zittern',
    erfrierend: 'sfx_spieler_zittern',
    erhitzt: 'sfx_spieler_keuchen',
    ueberhitzt: 'sfx_spieler_keuchen',
    hitzschlag: 'sfx_spieler_keuchen',
    ertrinkend: 'sfx_spieler_ertrinken',
  },
} as const;
