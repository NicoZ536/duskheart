/**
 * Events of sleep (aggregated into `SimEventMap`) – feedback hooks of MASTERPROMPT §11.5 and §2.7: the
 * presentation fades to the sleep overlay and runs time ×30, plays the sleep clip of the player and the
 * sounds of `SLEEP_SFX`, and shows why the player woke.
 *
 * - `sleepStarted`: the player lay down (place kind, position, nap or night).
 * - `sleepEnded`: the player woke – in the morning, rested after a nap, startled by an attack, by their
 *   own choice (a key, `sleep.wake`) or dying; `rested` when the sleep gave "Ausgeruht".
 * Refused sleep commands raise `commandRejected` with a `SleepRejectReason`.
 */
import type { Entity } from '../../engine/ecs';
import type { SleepPlaceKind } from './formulas';

/** Why a sleep ended: 06:00, exhaustion 0 after a nap, an attack, the player's own will, death. */
export type SleepEnd = 'morgen' | 'erholt' | 'angriff' | 'geweckt' | 'tod';

/** Why a sleep command had no effect. */
export type SleepRejectReason =
  /** The player is dead. */
  | 'dead'
  /** Already asleep. */
  | 'asleep'
  /** Not asleep (nothing to wake from). */
  | 'notAsleep'
  /** Before 19:00 and not exhausted enough (§11.5). */
  | 'tooEarly'
  /** An enemy within 20 tiles, or the Nachtmahr hunts (§11.5). */
  | 'enemiesNear'
  /** No bed at the tile, no sleeping bag in the bags. */
  | 'noSleepPlace'
  /** The bed is out of reach. */
  | 'outOfReach';

export interface SleepEventMap {
  sleepStarted: { readonly entity: Entity; readonly place: SleepPlaceKind; readonly x: number; readonly y: number; readonly layer: number; readonly nap: boolean; readonly tick: number };
  sleepEnded: { readonly entity: Entity; readonly reason: SleepEnd; readonly rested: boolean; readonly tick: number };
}

/** Event names of `SleepEventMap`. */
export const SLEEP_EVENT_TYPES = ['sleepStarted', 'sleepEnded'] as const satisfies ReadonlyArray<keyof SleepEventMap>;

/** Sounds of sleep (`sfx_<bereich>_<name>`, docs/SPIEL.md §5; presets in M3-33). */
export const SLEEP_SFX = {
  lieDown: 'sfx_schlaf_hinlegen',
  breathing: 'sfx_schlaf_atmen',
  wake: 'sfx_schlaf_aufwachen',
  startled: 'sfx_schlaf_aufschrecken',
} as const;
