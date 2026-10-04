/**
 * Spoilage (docs/SPIEL.md §21 "Verderb", ADR-0175; strand E, system `spoilage`): once per full game hour every perishable
 * stack of the bags and of every container of the active zone loses `n × loss` freshness – the loss and every freshness on
 * the 2^-16 grid, so n single steps and one step of n hours are bit-identical and the catch-up of frozen chunks (their
 * stamp and the factor of each container saved when they froze, split at season changes) decomposes. Containers report
 * their stacks through `forEachPerishable` – the bags, chests and the storage barrel, station slots, drops, graves.
 */
import type { ChunkData } from '../../world/model/chunk';
import type { Layer } from '../../world/model/coords';
import type { ItemStack } from '../items/stack';
import type { Simulation } from '../sim';

export const PERISHABLE_CONTAINERS = ['taschen', 'kiste', 'vorratsfass', 'station', 'drop', 'grab'] as const;
export type PerishableContainer = (typeof PERISHABLE_CONTAINERS)[number];
/** One perishable stack where it lies. `key` is stable (chest id, station id + area + index, drop entity, grave id). */
export interface PerishableSlot {
  readonly container: PerishableContainer;
  readonly key: string;
  readonly layer: Layer;
  readonly tx: number;
  readonly ty: number;
  readonly stack: ItemStack;
}
/** `replace(stack)` swaps the stack in place (new freshness, or `verdorbenes`). */
export type PerishableVisitor = (slot: PerishableSlot, replace: (stack: ItemStack) => void) => void;
/** `chunk = null`: the bags and every container of the active zone; else the containers of that (frozen, catching up) chunk. */
export interface PerishableContainerSource {
  readonly id: PerishableContainer;
  forEachPerishable(sim: Simulation, chunk: ChunkData | null, visit: PerishableVisitor): void;
}
/** Factors of MASTERPROMPT §18 (docs/SPIEL.md §21) in fixed order (BALANCE.spoilage). */
export interface SpoilageFactors {
  readonly container: number;
  readonly room: number;
  readonly surroundings: number;
}
export interface SpoilageApi {
  /** Loss per game hour on the 2^-16 grid (docs/SPIEL.md §21). */
  lossPerHour(item: string, factor: number): number;
  addSource(source: PerishableContainerSource): void;
}
// src/game/items/formulas.ts (E, additive): quantizeFreshness(value: number): number – rounds to the 2^-16 grid.
