/**
 * Events of dropped items (MASTERPROMPT §2.7, §11.4, §14 "fliegende Drops mit Magnet"): the
 * presentation draws the flight arc and the bobbing icon, plays the landing and pick-up sounds and shows
 * the bags-full hint (§11.4 "volle Taschen → klarer Hinweis"). Items arriving in the bags additionally
 * raise the inventory's `itemsAdded` (pick-up message "Feuerstein ×3").
 *
 * - `dropSpawned`: a stack pops out of (fromX, fromY) and flies to (x, y).
 * - `dropLanded`: it hit the ground (sound of its material).
 * - `dropPickedUp`: the player took `count` of it – by E or by the magnet (`magnet`).
 * - `dropBlocked`: the player stands in the magnet radius but the bags cannot take it.
 * - `dropExpired`: nobody picked it up within its lifetime.
 */
import type { Entity } from '../../engine/ecs';
import type { Layer } from '../../world/model/coords';

export interface DropEventMap {
  dropSpawned: {
    readonly entity: Entity;
    readonly item: string;
    readonly count: number;
    readonly layer: Layer;
    readonly fromX: number;
    readonly fromY: number;
    readonly x: number;
    readonly y: number;
    readonly tick: number;
  };
  dropLanded: { readonly entity: Entity; readonly item: string; readonly x: number; readonly y: number; readonly tick: number };
  dropPickedUp: { readonly entity: Entity; readonly item: string; readonly count: number; readonly x: number; readonly y: number; readonly magnet: boolean; readonly tick: number };
  dropBlocked: { readonly entity: Entity; readonly item: string; readonly count: number; readonly tick: number };
  dropExpired: { readonly entity: Entity; readonly item: string; readonly count: number; readonly tick: number };
}

/** Event names of `DropEventMap`. */
export const DROP_EVENT_TYPES = ['dropSpawned', 'dropLanded', 'dropPickedUp', 'dropBlocked', 'dropExpired'] as const satisfies ReadonlyArray<keyof DropEventMap>;

/**
 * Sounds of dropped items (`sfx_<bereich>_<name>`; presets in M3-33). The pick-up itself plays the item's
 * own `sounds.aufheben`; the bags-full hint plays the inventory's `sfx_inventar_voll`.
 */
export const DROP_SFX = {
  pop: 'sfx_drop_auswurf',
  land: 'sfx_drop_landung',
  magnet: 'sfx_drop_magnet',
} as const;
