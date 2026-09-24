/**
 * Events of the light sources (aggregated into `SimEventMap`) – the feedback hooks of MASTERPROMPT §12.2
 * and §2.7 ("Jede Aktion hat visuelles und akustisches Feedback"): the presentation lights and snuffs
 * flames (sprite clips, the light of the renderer, sparks and smoke), plays the sounds of `LIGHT_SFX` and
 * the kind's own `sounds` (`lightKindSound`, src/content/lights.ts) at the light, shows the off-hand light in
 * the HUD and tells why a light went out (texts `ui.light.*`).
 *
 * - `lightIgnited`: a light began to burn – the carried torch (F, `light: 0`) or a placed light.
 * - `lightExtinguished`: a light went out: switched off or doused (`schalter`), burned down or out of fuel
 *   (`abgebrannt`; a fire then glows as embers), put out by heavy rain (`regen`) or deep water
 *   (`wasser`), or the carried torch left the hand (`verstaut`).
 * - `fireCooled`: the embers of a fire went cold (ash).
 * - `lightPlaced` / `lightRemoved`: a torch or fire was set up / taken down or burned away.
 * - `fireFueled`: fuel was put on a fire (item, pieces, the fire's fuel afterwards).
 * - `carriedLightChanged`: the carried light changed (item, off hand or belt, lit) – HUD off-hand slot and
 *   the figure's light layer.
 * - `flammableIgnited`: a burning torch set something flammable alight (the hook `addFlammables`).
 * Refused light commands raise `commandRejected` with a `LightRejectReason`.
 */
import { lightKind } from '../../content/lights';
import type { CarryMode, PlacedMount } from './state';

/** Why a light went out (texts `ui.light.erloschen.<reason>`). */
export const LIGHT_OUT_REASONS = ['schalter', 'abgebrannt', 'regen', 'wasser', 'verstaut'] as const;
/** One reason a light went out. */
export type LightOutReason = (typeof LIGHT_OUT_REASONS)[number];

/** Why a placed light left the world. */
export const LIGHT_REMOVE_REASONS = ['genommen', 'abgebrannt'] as const;
/** One reason a placed light left the world. */
export type LightRemoveReason = (typeof LIGHT_REMOVE_REASONS)[number];

/**
 * Why a light command had no effect (`commandRejected`; texts `ui.light.reject.<reason>`):
 * - `noPlayer` – no player; `dead`, `asleep` – the player cannot act (§11.5, §11.6); `noLight` – no light in
 *   the off hand (or, with a shield or two-hander, on the
 *   hotbar); `inWater` – the player swims, a torch cannot be lit in deep water;
 * - `notPlaceable` – the item at the slot is no light that can be placed; `outOfReach` – the target is too
 *   far away; `tileBlocked` – the tile cannot hold a light (rock, water, a tree, a cliff face, outside the
 *   world, another layer); `tileTaken` – another light stands on the tile; `noSuchLight` – no placed light
 *   with this id;
 * - `notFuel` – the item does not burn (no `brennwert`); `fireFull` – the fire holds no more of this fuel
 *   (§15.4 "höchstens 6 Minuten"); `notAFire` – fuel goes into fires only;
 * - `nothingToIgnite` – nothing to light on the tile, or no burning torch in hand to set something
 *   flammable alight; `noFuel` – a fire without fuel cannot be lit; `burning` – the light burns already;
 *   `notBurning` – nothing to put out; `notTakeable` – fires cannot be taken down; `noSpace` – the bags
 *   have no room for the taken torch;
 * - `invalidSlot`, `slotEmpty`, `invalidCount` – the slot does not exist, is empty, or a count below 1.
 */
export const LIGHT_REJECT_REASONS = [
  'noPlayer',
  'dead',
  'asleep',
  'noLight',
  'inWater',
  'notPlaceable',
  'outOfReach',
  'tileBlocked',
  'tileTaken',
  'noSuchLight',
  'notFuel',
  'fireFull',
  'notAFire',
  'nothingToIgnite',
  'noFuel',
  'burning',
  'notBurning',
  'notTakeable',
  'noSpace',
  'invalidSlot',
  'slotEmpty',
  'invalidCount',
] as const;
/** One reason a light command was refused. */
export type LightRejectReason = (typeof LIGHT_REJECT_REASONS)[number];

/** Light events by name (payloads carry the tick that produced them). */
export interface LightEventMap {
  lightIgnited: { readonly light: number; readonly kind: string; readonly layer: number; readonly x: number; readonly y: number; readonly tick: number };
  lightExtinguished: { readonly light: number; readonly kind: string; readonly layer: number; readonly x: number; readonly y: number; readonly reason: LightOutReason; readonly tick: number };
  fireCooled: { readonly light: number; readonly layer: number; readonly x: number; readonly y: number; readonly tick: number };
  lightPlaced: { readonly light: number; readonly kind: string; readonly mount: PlacedMount; readonly layer: number; readonly tx: number; readonly ty: number; readonly lit: boolean; readonly tick: number };
  lightRemoved: { readonly light: number; readonly kind: string; readonly layer: number; readonly tx: number; readonly ty: number; readonly reason: LightRemoveReason; readonly tick: number };
  fireFueled: { readonly light: number; readonly item: string; readonly count: number; readonly fuelSeconds: number; readonly x: number; readonly y: number; readonly layer: number; readonly tick: number };
  carriedLightChanged: { readonly item: string | null; readonly mode: CarryMode | null; readonly lit: boolean; readonly tick: number };
  flammableIgnited: { readonly layer: number; readonly tx: number; readonly ty: number; readonly tick: number };
}

/** Event names of `LightEventMap`. */
export const LIGHT_EVENT_TYPES = ['lightIgnited', 'lightExtinguished', 'fireCooled', 'lightPlaced', 'lightRemoved', 'fireFueled', 'carriedLightChanged', 'flammableIgnited'] as const satisfies ReadonlyArray<keyof LightEventMap>;

/**
 * Sounds of the light sources (`sfx_<bereich>_<name>`, presets in src/content/sfx/feuer.ts). Lighting,
 * going out and the burning loop of a kind are its own `sounds` (`an`, `aus`, `brennen`); these are the
 * rest: setting a light up, taking it down, fuel landing in a fire, embers going cold.
 */
export const LIGHT_SFX = {
  place: 'sfx_inventar_ablegen',
  take: 'sfx_inventar_entnehmen',
  fuel: 'sfx_item_holz',
  cooled: 'sfx_feuer_erloeschen',
  flammable: 'sfx_feuer_entzuenden',
} as const;

/** Moments of a light kind with a sound of its own (`LightKind.sounds`): lighting, going out, the loop while it burns. */
export type LightSoundMoment = 'an' | 'aus' | 'brennen';

/**
 * The sound of light kind `kind` at `moment` – what the presentation plays for `lightIgnited` (`an`),
 * `lightExtinguished` (`aus`) and while a light burns (`brennen`, a loop at the light). Throws for an
 * unknown kind (every kind in the events is one of `LIGHT_KINDS`).
 */
export function lightKindSound(kind: string, moment: LightSoundMoment): string {
  return lightKind(kind).sounds[moment];
}
