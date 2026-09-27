/**
 * Storage commands (MASTERPROMPT §16.7 "Lagerung"; M4-21), aggregated by src/game/commands.ts; the chest screen of the
 * UI sends them. A chest is addressed by its id (`StorageSystem.chests`, `chestAt`); the player works it within
 * `BALANCE.storage.reachTiles` of its footprint.
 *
 * - `storage.open {chest}` / `storage.close {chest}`: the lid opens for the chest screen (E on a chest) and closes.
 * - `storage.put {chest, from, count?}`: moves pieces from bag slot `from` (inventory, backpack compartment, hotbar,
 *   belt) into the chest – joining its stacks first, then empty slots; the shelf takes raw materials only.
 * - `storage.take {chest, index, count?}`: moves pieces from chest slot `index` into the bags.
 * - `storage.takeAll {chest}`: moves everything that fits into the bags.
 * - `storage.storeAll {chest}`: "Alles einlagern" – every stack of the inventory and the backpack compartment (not
 *   the hotbar) that fits into the chest.
 * - `storage.sort {chest}`: joins and sorts the chest's stacks.
 * - `storage.rename {chest, name}`: the name on the lid (empty: the item's name).
 * - `storage.label {chest, item?}`: the item shown as the icon label (absent or `null`: none).
 * - `storage.quickStash {}`: "Schnellablage in passende Kisten (10 Tiles)" – every stack of the inventory and the
 *   backpack compartment goes into the chests around that already hold its item, nearest first.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { idSchema } from '../../content/schema/common';
import { slotRefSchema } from '../inventory/commands';
import { CHEST_SLOTS_MAX } from './state';

const chestId = z.number().int().min(1);
const count = z.number().int().min(1);

export const storageOpenCommandSchema = z.object({ type: z.literal('storage.open'), chest: chestId }).strict();
export const storageCloseCommandSchema = z.object({ type: z.literal('storage.close'), chest: chestId }).strict();
export const storagePutCommandSchema = z.object({ type: z.literal('storage.put'), chest: chestId, from: slotRefSchema, count: count.optional() }).strict();
export const storageTakeCommandSchema = z
  .object({
    type: z.literal('storage.take'),
    chest: chestId,
    index: z
      .number()
      .int()
      .min(0)
      .max(CHEST_SLOTS_MAX - 1),
    count: count.optional(),
  })
  .strict();
export const storageTakeAllCommandSchema = z.object({ type: z.literal('storage.takeAll'), chest: chestId }).strict();
export const storageStoreAllCommandSchema = z.object({ type: z.literal('storage.storeAll'), chest: chestId }).strict();
export const storageSortCommandSchema = z.object({ type: z.literal('storage.sort'), chest: chestId }).strict();
export const storageRenameCommandSchema = z.object({ type: z.literal('storage.rename'), chest: chestId, name: z.string().max(BALANCE.storage.nameMaxLength) }).strict();
export const storageLabelCommandSchema = z.object({ type: z.literal('storage.label'), chest: chestId, item: idSchema.nullable().optional() }).strict();
export const storageQuickStashCommandSchema = z.object({ type: z.literal('storage.quickStash') }).strict();

/** Schemas of the storage commands (aggregated by `gameCommandSchema`). */
export const STORAGE_COMMAND_SCHEMAS = [
  storageOpenCommandSchema,
  storageCloseCommandSchema,
  storagePutCommandSchema,
  storageTakeCommandSchema,
  storageTakeAllCommandSchema,
  storageStoreAllCommandSchema,
  storageSortCommandSchema,
  storageRenameCommandSchema,
  storageLabelCommandSchema,
  storageQuickStashCommandSchema,
] as const;
