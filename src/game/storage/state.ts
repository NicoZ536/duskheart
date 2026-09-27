/**
 * State of storage (MASTERPROMPT §16.7; M4-21) and its save form (participant `storage`).
 *
 * - `chests`: every placed container – id, its item (`kiste_holz`, `truhe`, `lagerregal`), the anchor tile (north-west
 *   tile of its footprint on the build grid), layer, footprint as placed (`w` × `h`, turned by the grid), its slots,
 *   its name (§16.7 "Umbenennen"; empty = the item's name) and the item shown as the icon label on its lid (`label`,
 *   §16.7 "Icon-Etikett"; `null` = none).
 * - `nextId`: id of the next container (ids start at 1, never reused).
 * The building grid owns the part itself (src/game/building); a chest lives exactly as long as its part.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { idSchema } from '../../content/schema/common';
import type { Layer } from '../../world/model/coords';
import { copyStack } from '../inventory/snapshot';
import { itemStackSchema, type ItemStack } from '../items/stack';

/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;
/** Most slots of any container [slots]. */
export const CHEST_SLOTS_MAX = Math.max(...Object.values(BALANCE.storage.containers).map((c) => c.slots));
/** Largest side of a container's footprint [tiles] (§16.1 "Objekte (1×1 bis 4×4)"). */
const SIDE_MAX = BALANCE.building.maxObjectSide;

/** A placed container. */
export interface Chest {
  readonly id: number;
  /** The placed item (= its build part). */
  readonly item: string;
  readonly layer: Layer;
  /** Anchor tile: the north-west tile of the footprint. */
  readonly tx: number;
  readonly ty: number;
  /** Footprint as placed [tiles]. */
  readonly w: number;
  readonly h: number;
  readonly slots: (ItemStack | null)[];
  /** Name on the lid; empty = the item's name. */
  name: string;
  /** Item shown as the icon label, or `null`. */
  label: string | null;
}

/** State of the storage system. */
export interface StorageState {
  readonly chests: Chest[];
  nextId: number;
}

/** An empty state. */
export function createStorageState(): StorageState {
  return { chests: [], nextId: 1 };
}

const side = z.number().int().min(1).max(SIDE_MAX);

/** Saved form of the storage state. */
export const storageSnapshotSchema = z
  .object({
    chests: z.array(
      z
        .object({
          id: z.number().int().min(1),
          item: idSchema,
          layer: z.number().int().min(LAYER_MIN).max(0),
          tx: z.number().int().min(0),
          ty: z.number().int().min(0),
          w: side,
          h: side,
          slots: z.array(itemStackSchema.nullable()).min(1).max(CHEST_SLOTS_MAX),
          name: z.string().max(BALANCE.storage.nameMaxLength),
          label: idSchema.nullable(),
        })
        .strict(),
    ),
    nextId: z.number().int().min(1),
  })
  .strict();

/** A deep copy (the save participant serialises it; restoring copies in). */
export function copyStorageState(s: StorageState): StorageState {
  return {
    chests: s.chests.map((c) => ({ id: c.id, item: c.item, layer: c.layer, tx: c.tx, ty: c.ty, w: c.w, h: c.h, slots: c.slots.map((x) => (x === null ? null : copyStack(x))), name: c.name, label: c.label })),
    nextId: s.nextId,
  };
}
