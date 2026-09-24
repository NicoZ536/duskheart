/**
 * What crafting reads from other systems through hooks (MASTERPROMPT §15.1; M3-16, completed by M4-02
 * chests and M4-03/M4-05 stations):
 *
 * - **Chests** (`CraftingStore`, `StoreProvider`): "Crafting nimmt aus Inventar und Kisten im Umkreis von
 *   8 Tiles (abschaltbar)". The storage system registers a provider that lists the chests within the
 *   radius around the player; crafting counts their contents and takes what the bags lack.
 * - **Stations** (`StationProvider`): whether a placed station of an item id stands within reach of the
 *   player (the building system).
 * - **Skills** (`CraftingSkills`): the Handwerk bonus shortens crafting, every finished piece gives
 *   experience (§23.2) – the skill system.
 * - **Spilling** (`SpillItems`): what does not fit into the bags lands at the player's feet (the drop
 *   system), so a finished piece or a refund is never lost.
 */
import type { Layer } from '../../world/model/coords';
import type { ItemStack } from '../items/stack';
import type { Simulation } from '../sim';

/** A container crafting may take from (a chest). */
export interface CraftingStore {
  /** Usable pieces of `item` it holds [pieces] (items with durability only while intact). */
  count(item: string): number;
  /** Takes `count` usable pieces of `item` (at most `count(item)`); returns them with their state. */
  take(sim: Simulation, item: string, count: number): readonly ItemStack[];
}

/** The containers within `radiusPx` of (x, y) on `layer`, nearest first. */
export type StoreProvider = (sim: Simulation, layer: Layer, x: number, y: number, radiusPx: number) => readonly CraftingStore[];

/** Whether a placed station of item `station` stands within `radiusPx` of (x, y) on `layer`. */
export type StationProvider = (sim: Simulation, layer: Layer, x: number, y: number, radiusPx: number, station: string) => boolean;

/** The skill system as crafting sees it. */
export interface CraftingSkills {
  /** Effect bonus of skill `id` [fraction; +0,5 % per level]. */
  bonus(id: string): number;
  /** Awards the experience of source `sourceId` `times` times; returns the XP given. */
  award(sim: Simulation, sourceId: string, times?: number): number;
  /** Whether `sourceId` is an experience source of some skill. */
  hasSource(sourceId: string): boolean;
}

/** Puts a stack that found no room in the bags into the world at (x, y) on `layer`. */
export type SpillItems = (sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number) => void;
