/**
 * Events of spoilage (aggregated into `SimEventMap`, docs/SPIEL.md §17 "foodSpoiled"): a perishable stack reached freshness 0
 * and became spoiled food (`verdorbenes`) where it lay – in the bags, a chest, the pantry barrel, a station's slot, a dropped
 * stack or a grave (`behaelter`). Only stacks of the active zone report it; a frozen chunk catches up silently.
 */
import type { PerishableContainer } from './types';

export interface SpoilageEventMap {
  foodSpoiled: { readonly item: string; readonly count: number; readonly behaelter: PerishableContainer; readonly tick: number };
}

/** Event names of `SpoilageEventMap`. */
export const SPOILAGE_EVENT_TYPES = ['foodSpoiled'] as const satisfies ReadonlyArray<keyof SpoilageEventMap>;

/** Sounds of spoilage (`sfx_<bereich>_<name>`, src/content/sfx/kueche.ts): a stack turning to rot – a wet squelch and flies. */
export const SPOILAGE_SFX = {
  spoiled: 'sfx_kueche_verdorben',
} as const;
