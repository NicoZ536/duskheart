/**
 * Events of interacting (MASTERPROMPT §2.7, §11.4; M3-10): the presentation shows the progress ring
 * and the tool clip while an action runs and the hint of a refused E ("Braucht eine Axt", "Taschen
 * voll", §26 "Fehlermeldungen sagen, was fehlt und wie man es löst").
 *
 * - `actionStarted`: the player works a target – by hand or with the tool; `hitsNeeded` for the ring.
 * - `actionStopped`: the action ended – done, released, target gone or out of reach, too hard, tool broken.
 * - A refused E raises `commandRejected` (type `player.interact`) with an `InteractionRejectReason`.
 */
import type { Layer } from '../../world/model/coords';
import type { HarvestBlock } from '../gathering/system';
import type { HarvestAction } from '../gathering/rules';
import type { PlayerIncapacity } from '../player/system';
import type { UseRejectReason } from './uses';

/**
 * Why an E press had no effect: nothing in reach, a harvest block, a use target that cannot be used now
 * (src/game/interaction/uses.ts), or a player who cannot act (dead, asleep).
 */
export type InteractionRejectReason = 'nothingToInteract' | Exclude<HarvestBlock, 'nothing'> | UseRejectReason | PlayerIncapacity;

/** The interaction reject reasons of harvesting and of a player who cannot act (i18n `ui.interaction.block.<reason>`); use targets name theirs in src/content/uses.ts. */
export const INTERACTION_REJECT_REASONS = ['nothingToInteract', 'needsTool', 'toolBroken', 'notRipe', 'regrowing', 'alreadyDug', 'notDiggable', 'dead', 'asleep'] as const satisfies readonly InteractionRejectReason[];

/** How an action ended. */
export const ACTION_STOPS = ['done', 'released', 'gone', 'outOfReach', 'tooHard', 'toolBroken', 'blocked'] as const;
export type ActionStop = (typeof ACTION_STOPS)[number];

export interface InteractionEventMap {
  actionStarted: {
    readonly kind: 'object' | 'tile';
    readonly layer: Layer;
    readonly tx: number;
    readonly ty: number;
    readonly target: string;
    readonly action: HarvestAction;
    readonly byHand: boolean;
    readonly hitsNeeded: number;
    readonly tick: number;
  };
  actionStopped: { readonly kind: 'object' | 'tile'; readonly target: string; readonly action: HarvestAction; readonly reason: ActionStop; readonly tick: number };
}

/** Event names of `InteractionEventMap`. */
export const INTERACTION_EVENT_TYPES = ['actionStarted', 'actionStopped'] as const satisfies ReadonlyArray<keyof InteractionEventMap>;

/** Sounds of interacting (`sfx_<bereich>_<name>`; presets in M3-33): a swing without a hit, a refused E (the inventory's error sound). */
export const INTERACTION_SFX = {
  swing: 'sfx_werkzeug_schwung',
  refused: 'sfx_ui_fehler',
} as const;
