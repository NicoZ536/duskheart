/**
 * Events of storage (aggregated into `SimEventMap`) – the feedback of MASTERPROMPT §2.7 for §16.7: the renderer opens
 * and closes the lid (clips `zu`/`offen`), the chest screen and the HUD refresh, the audio plays the container's sounds
 * (src/audio/baseSounds.ts).
 *
 * - `chestPlaced` / `chestRemoved`: a container came onto the build grid / left it (`spilled`: stacks that fell out of
 *   a destroyed chest onto the ground).
 * - `chestOpened` / `chestClosed`: the lid opens for the chest screen / closes.
 * - `chestStored`: pieces went in – by the player (`spieler`), "Alles einlagern" (`alles`) or the quick stash
 *   (`schnellablage`).
 * - `chestTaken`: pieces came out – to the player (`spieler`), for crafting (`handwerk`) or for building and repairs
 *   (`bau`).
 * - `chestSorted`, `chestRenamed`, `chestLabeled`: the chest was sorted, named, labelled.
 * - `quickStashed`: the quick stash moved `count` pieces into `chests` chests.
 * Refused commands raise `commandRejected` with a `StorageRejectReason` (texts `ui.storage.reject.<reason>`).
 */

/**
 * Why a storage command had no effect:
 * - `noPlayer`; `dead`, `asleep` – the player cannot act (§11.5, §11.6);
 * - `unknownChest` – no chest of that id; `outOfReach` – farther than the reach from the chest;
 * - `invalidSlot`, `slotEmpty` – no such slot / nothing in it (bags or chest);
 * - `wrongItem` – the shelf takes raw materials only (§16.7); `chestFull` – no room in the chest; `bagsFull` – no
 *   room in the bags; `nothingToStore` – "Alles einlagern" or the quick stash found nothing that fits;
 * - `unknownItem` – the icon label names no item.
 */
export const STORAGE_REJECT_REASONS = ['noPlayer', 'dead', 'asleep', 'unknownChest', 'outOfReach', 'invalidSlot', 'slotEmpty', 'wrongItem', 'chestFull', 'bagsFull', 'nothingToStore', 'unknownItem'] as const;
/** One reason a storage command was refused. */
export type StorageRejectReason = (typeof STORAGE_REJECT_REASONS)[number];

/** Who put pieces into a chest. */
export type ChestStoreCause = 'spieler' | 'alles' | 'schnellablage';
/** Who took pieces out of a chest. */
export type ChestTakeCause = 'spieler' | 'handwerk' | 'bau';

interface ChestBase {
  readonly chest: number;
  readonly item: string;
  readonly layer: number;
  /** Centre of the chest [world px]. */
  readonly x: number;
  readonly y: number;
  readonly tick: number;
}

export interface StorageEventMap {
  chestPlaced: ChestBase & { readonly tx: number; readonly ty: number };
  chestRemoved: ChestBase & { readonly spilled: number };
  chestOpened: ChestBase;
  chestClosed: ChestBase;
  chestStored: ChestBase & { readonly stored: string; readonly count: number; readonly by: ChestStoreCause };
  chestTaken: ChestBase & { readonly taken: string; readonly count: number; readonly by: ChestTakeCause };
  chestSorted: ChestBase;
  chestRenamed: ChestBase & { readonly name: string };
  chestLabeled: ChestBase & { readonly label: string | null };
  quickStashed: { readonly count: number; readonly chests: number; readonly tick: number };
}

/** Event names of `StorageEventMap`. */
export const STORAGE_EVENT_TYPES = ['chestPlaced', 'chestRemoved', 'chestOpened', 'chestClosed', 'chestStored', 'chestTaken', 'chestSorted', 'chestRenamed', 'chestLabeled', 'quickStashed'] as const satisfies ReadonlyArray<keyof StorageEventMap>;
