/**
 * Events of fear (aggregated into `SimEventMap`) – the feedback hooks of MASTERPROMPT §12.3 and §2.7: the
 * HUD's fear eye (from 20), whispers and shadows at the screen edge (from 40), desaturation and
 * hallucinations (from 60), their attacks (from 80) and the Nachtmahr (100).
 *
 * - `fearStageChanged`: fear entered another stage (`fearStageEffects` says what the stage shows).
 * - `fearChanged`: a sudden change – a fright (`spike`: sighting, bad food, a settler's death) or comfort
 *   (`soothe`: comfort food).
 * - `hallucinationAppeared` / `hallucinationVanished`: a shape creeps out of the dark / dissolves in light,
 *   when struck, when it touches the player, when its time runs out or when courage returns.
 * - `nightmareSummoned` / `nightmareEnded`: the Nachtmahr hunts (the creature itself comes in M6 and
 *   spawns on this event) / gives up in glaring light, is defeated, or the player died.
 */
import type { FearStage } from '../../content/balance/fear';
import type { Entity } from '../../engine/ecs';

/** Why fear jumped. */
export type FearChangeReason = 'sichtung' | 'nahrung' | 'siedlertod' | 'wohlfuehlessen';
/** Why a hallucination vanished. */
export type HallucinationEnd = 'licht' | 'treffer' | 'beruehrt' | 'angriff' | 'zeit' | 'mut';
/** Why the Nachtmahr's pursuit ended. */
export type NightmareEnd = 'licht' | 'besiegt' | 'tod';

export interface FearEventMap {
  fearStageChanged: { readonly entity: Entity; readonly stage: FearStage; readonly previous: FearStage; readonly value: number; readonly tick: number };
  fearChanged: { readonly entity: Entity; readonly amount: number; readonly reason: FearChangeReason; readonly value: number; readonly tick: number };
  hallucinationAppeared: { readonly entity: Entity; readonly id: number; readonly x: number; readonly y: number; readonly harmful: boolean; readonly tick: number };
  hallucinationVanished: { readonly entity: Entity; readonly id: number; readonly reason: HallucinationEnd; readonly tick: number };
  nightmareSummoned: { readonly entity: Entity; readonly tick: number };
  nightmareEnded: { readonly entity: Entity; readonly reason: NightmareEnd; readonly tick: number };
}

/** Event names of `FearEventMap`. */
export const FEAR_EVENT_TYPES = ['fearStageChanged', 'fearChanged', 'hallucinationAppeared', 'hallucinationVanished', 'nightmareSummoned', 'nightmareEnded'] as const satisfies ReadonlyArray<keyof FearEventMap>;

/**
 * Sounds of fear (`sfx_<bereich>_<name>`, docs/SPIEL.md §5; presets in M3-33): whispers loop from stage
 * `fluestern`, a heartbeat from `bedrohlich`, a fright, a hallucination appearing and dissolving, the
 * Nachtmahr's call and its retreat.
 */
export const FEAR_SFX = {
  whispers: 'sfx_furcht_fluestern',
  heartbeat: 'sfx_furcht_herzschlag',
  fright: 'sfx_furcht_schreck',
  calm: 'sfx_furcht_erleichterung',
  hallucination: 'sfx_furcht_trugbild',
  hallucinationGone: 'sfx_furcht_verblassen',
  hallucinationHit: 'sfx_furcht_trugbild_treffer',
  nightmare: 'sfx_furcht_nachtmahr',
  nightmareGone: 'sfx_furcht_nachtmahr_weicht',
} as const;
