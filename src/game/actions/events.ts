/**
 * Events of the player's actions (aggregated into `SimEventMap`) – feedback hooks of MASTERPROMPT §2.7 and
 * §11.4: the presentation plays the eating, drinking, sitting and throwing clips (M3-06), a progress ring
 * over the player while eating or drinking, the sounds of `ACTION_SFX` (eating also the item's own
 * `sounds.benutzen`), and shows why an action stopped.
 *
 * - `activityStarted` / `activityFinished` / `activityInterrupted`: eating, drinking, sitting (`ticks` = how long
 *   it takes; 0 for sitting). Interrupted by a hit, a roll, sprinting, deep water, a jump, sleep, death,
 *   the player (`action.cancel`) or because the eaten piece left the bags.
 * - `itemEaten`: a piece was eaten (its nutrition, freshness stage, whether it poisoned).
 * - `waterDrunk`: a sip of water (source, thirst, whether it brought a fever).
 * - `itemThrown` / `thrownItemLanded`: a piece flies from the player to the aimed point / came down
 *   (`sunk` in deep water).
 * Refused action commands raise `commandRejected` with an `ActionRejectReason`.
 */
import type { Entity } from '../../engine/ecs';
import type { FreshnessStage, WaterSource } from './formulas';

/** Actions that take time. */
export type ActionKind = 'essen' | 'trinken' | 'sitzen';

/** Why an action stopped before its end. */
export type ActionInterruption = 'treffer' | 'rolle' | 'sprint' | 'wasser' | 'sprung' | 'schlaf' | 'tod' | 'abgebrochen' | 'weg' | 'bewegung';

/** Why an action command had no effect. */
export type ActionRejectReason =
  /** The player is dead. */
  | 'dead'
  /** The player sleeps. */
  | 'asleep'
  /** The item cannot be eaten or drunk. */
  | 'notEdible'
  /** No water on the tile. */
  | 'noWater'
  /** Sea water (§18: salty). */
  | 'saltWater'
  /** Frozen water (melt it first). */
  | 'frozen'
  /** No seat on the tile. */
  | 'noSeat'
  /** The target is out of reach. */
  | 'outOfReach'
  /** Equipment and the backpack slot cannot be thrown from. */
  | 'notThrowable'
  /** Nothing to cancel. */
  | 'idle';

export interface ActionEventMap {
  activityStarted: { readonly entity: Entity; readonly action: ActionKind; readonly item: string | null; readonly ticks: number; readonly tick: number };
  activityFinished: { readonly entity: Entity; readonly action: ActionKind; readonly item: string | null; readonly tick: number };
  activityInterrupted: { readonly entity: Entity; readonly action: ActionKind; readonly item: string | null; readonly reason: ActionInterruption; readonly tick: number };
  itemEaten: { readonly entity: Entity; readonly item: string; readonly satiety: number; readonly thirst: number; readonly freshness: FreshnessStage | null; readonly poisoned: boolean; readonly tick: number };
  waterDrunk: { readonly entity: Entity; readonly source: WaterSource; readonly thirst: number; readonly fever: boolean; readonly tick: number };
  itemThrown: { readonly entity: Entity; readonly item: string; readonly fromX: number; readonly fromY: number; readonly toX: number; readonly toY: number; readonly ticks: number; readonly tick: number };
  thrownItemLanded: { readonly entity: Entity; readonly item: string; readonly x: number; readonly y: number; readonly layer: number; readonly sunk: boolean; readonly tick: number };
}

/** Event names of `ActionEventMap`. */
export const ACTION_EVENT_TYPES = ['activityStarted', 'activityFinished', 'activityInterrupted', 'itemEaten', 'waterDrunk', 'itemThrown', 'thrownItemLanded'] as const satisfies ReadonlyArray<keyof ActionEventMap>;

/** Sounds of the actions (`sfx_<bereich>_<name>`, docs/SPIEL.md §5; presets in M3-33). */
export const ACTION_SFX = {
  eat: 'sfx_aktion_essen',
  swallow: 'sfx_aktion_schlucken',
  drink: 'sfx_aktion_trinken',
  sit: 'sfx_aktion_hinsetzen',
  stand: 'sfx_aktion_aufstehen',
  throw: 'sfx_aktion_werfen',
  land: 'sfx_aktion_aufprall',
  sink: 'sfx_wasser_platsch',
  interrupted: 'sfx_aktion_abbruch',
  given: 'sfx_inventar_ablegen',
} as const;
