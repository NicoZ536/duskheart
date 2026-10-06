/**
 * Events of the unlock registry (aggregated into `SimEventMap`; docs/SPIEL.md §17 "Ereignisse zwischen Strängen"):
 * - `unlockGranted {unlock, quelle}`: an unlock of §23.1 (or a blueprint, research) is granted – the UI announces it, the
 *   chronicle and statistics count it (strand G), crafting shows the recipes waiting for it.
 * Refused commands raise `commandRejected` with an `UnlockRejectReason` (texts `ui.unlock.reject.<reason>`).
 */
import type { UnlockSource } from './types';

/** Why an unlock command had no effect: no unlock of that id, or it is granted already. */
export const UNLOCK_REJECT_REASONS = ['unknownUnlock', 'alreadyUnlocked'] as const;
/** One reason an unlock command was refused. */
export type UnlockRejectReason = (typeof UNLOCK_REJECT_REASONS)[number];

export interface UnlockEventMap {
  unlockGranted: { readonly unlock: string; readonly quelle: UnlockSource; readonly tick: number };
}

/** Event names of `UnlockEventMap`. */
export const UNLOCK_EVENT_TYPES = ['unlockGranted'] as const satisfies ReadonlyArray<keyof UnlockEventMap>;

/** Sound of a granted unlock (src/content/sfx/leuchtfeuer.ts). */
export const UNLOCK_SFX = { granted: 'sfx_leuchtfeuer_wissen' } as const;
