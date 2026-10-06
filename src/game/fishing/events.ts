/**
 * Events of fishing (docs/SPIEL.md §17, §20 "Angeln", §30 "Angel-Minispiel (HUD) – Öffner fishCast"; M7-24). Aggregated into
 * `SimEventMap`; the presentation reads them after the tick (sounds of src/audio/eventMap.ts, the splash of the float, the HUD
 * mini-game), the observers count them (statistics `gefangen`, chronicle, Funke; src/content/{chronik,guide}/fang.ts).
 *
 * - `fishCast`: the rod cast its float (opens the HUD mini-game) – where it lands and into which water (`gewaesser`).
 * - `fishBite`: the float dips – a fish took the bait; answer it by reeling within `biteWindowSeconds`.
 * - `fishHooked`: the reel answered the bite – the fight begins (`fish`). `fishLeap`: the hooked fish leapt (a splash).
 * - `fishCaught`: landed – the raw fish went into the bags (`fish`). `fishLost`: gone – the line broke (`gerissen`), the fish
 *   shook off or swam out of reach (`entkommen`), the bite was missed (`verpasst`).
 * - `castEnded`: the line was reeled in without a fish, or came loose (the player walked off, put the rod away, fell asleep).
 * - `iceHoleCut`: the pickaxe opened a hole in the ice (§20 "Eisangeln").
 * - `fishTrapPlaced`, `fishTrapEmptied` (the fish went into the bags; `anzahl`), `fishTrapTaken` (the trap back into the bags),
 *   `fishTrapCaught` (a fish went into a trap at a dawn – only in the active zone; a frozen trap catches silently).
 * Refused commands raise `commandRejected` with a `FishingRejectReason` (texts `ui.angeln.reject.<reason>`).
 */
import type { FishWater } from '../../content/fishing/schema';
import type { Layer } from '../../world/model/coords';

/** Why a fishing command was refused. */
export const FISHING_REJECT_REASONS = ['noRod', 'noPickaxe', 'noWater', 'tooFar', 'iceClosed', 'lineOut', 'noLine', 'notIce', 'holeOpen', 'trapThere', 'noTrap', 'notTrap'] as const;
/** One reason. */
export type FishingRejectReason = (typeof FISHING_REJECT_REASONS)[number];

/** Why a hooked or biting fish got away. */
export const FISH_LOSS_REASONS = ['gerissen', 'entkommen', 'verpasst'] as const;
export type FishLossReason = (typeof FISH_LOSS_REASONS)[number];

/** Why a cast ended without a fight. */
export type CastEndReason = 'eingeholt' | 'losgerissen';

export interface FishingEventMap {
  fishCast: { readonly layer: Layer; readonly x: number; readonly y: number; readonly gewaesser: FishWater; readonly tick: number };
  fishBite: { readonly layer: Layer; readonly x: number; readonly y: number; readonly tick: number };
  fishHooked: { readonly layer: Layer; readonly x: number; readonly y: number; readonly fish: string; readonly tick: number };
  fishLeap: { readonly layer: Layer; readonly x: number; readonly y: number; readonly fish: string; readonly tick: number };
  fishCaught: { readonly layer: Layer; readonly x: number; readonly y: number; readonly fish: string; readonly tick: number };
  fishLost: { readonly layer: Layer; readonly x: number; readonly y: number; readonly fish: string; readonly grund: FishLossReason; readonly tick: number };
  castEnded: { readonly layer: Layer; readonly x: number; readonly y: number; readonly grund: CastEndReason; readonly tick: number };
  iceHoleCut: { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly tick: number };
  fishTrapPlaced: { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly tick: number };
  fishTrapCaught: { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly fish: string; readonly tick: number };
  fishTrapEmptied: { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly anzahl: number; readonly tick: number };
  fishTrapTaken: { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly tick: number };
}

export const FISHING_EVENT_TYPES = ['fishCast', 'fishBite', 'fishHooked', 'fishLeap', 'fishCaught', 'fishLost', 'castEnded', 'iceHoleCut', 'fishTrapPlaced', 'fishTrapCaught', 'fishTrapEmptied', 'fishTrapTaken'] as const satisfies ReadonlyArray<keyof FishingEventMap>;

/** Sounds of fishing (src/content/sfx/angeln.ts; src/audio/eventMap.ts maps the events onto them). */
export const FISHING_SFX = {
  cast: 'sfx_angeln_wurf',
  plop: 'sfx_angeln_platsch',
  bite: 'sfx_angeln_biss',
  hooked: 'sfx_angeln_anschlag',
  leap: 'sfx_angeln_sprung',
  caught: 'sfx_angeln_fang',
  snapped: 'sfx_angeln_riss',
  escaped: 'sfx_angeln_entkommen',
  reeledIn: 'sfx_angeln_einholen',
  iceHole: 'sfx_angeln_eisloch',
  trap: 'sfx_angeln_reuse',
  trapEmptied: 'sfx_angeln_reuse_leeren',
} as const;
