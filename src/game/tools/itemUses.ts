/**
 * The item-use chain of `player.useItem` (docs/SPIEL.md §17 "Haken", ADR-0175): strands hang their uses – seed,
 * sapling, watering can, fertiliser, fishing rod, water skin, shard, blueprint, map scroll, instrument, net … – onto
 * `ToolsSystem.addItemUse` instead of changing the tools system. The tools system asks the handlers in registration order
 * after its built-in uses (eating, cures, buckets, lights, traps, earth) and before the primary button's blow or
 * `notUsable`; the first handler that does not `pass` decides.
 */
import type { ItemDef } from '../../content/schema/item';
import type { Layer } from '../../world/model/coords';
import type { SlotRef } from '../items/slots';
import type { ItemStack } from '../items/stack';
import type { CommandRejectReason, Simulation } from '../sim';

/** What `player.useItem` hands to an item-use handler (a held record of the tools system: read it, do not keep it). */
export interface ItemUseContext {
  readonly slot: SlotRef;
  readonly stack: ItemStack;
  readonly def: ItemDef;
  /** The aimed tile (`player.useItem {tx, ty}`, else the interaction focus), or null. */
  readonly target: { readonly layer: Layer; readonly tx: number; readonly ty: number } | null;
  readonly tick: number;
  /** The command named the tile (E on a use target: the handler checks the reach and refuses `outOfReach`), else it is the aim. */
  readonly named: boolean;
  /** The primary button (no slot, no tile): a use that finds nothing to do stays silent (`used`) instead of refusing. */
  readonly primary: boolean;
}

/** `pass`: not mine, ask the next handler · `used`: done (the handler pushed its events, took the pieces) · reject: rejected with a reason. */
export type ItemUseOutcome = 'pass' | 'used' | { readonly reject: CommandRejectReason };

/**
 * An item use contributed by a strand (seed, sapling, watering can, fertiliser, fishing rod, water skin, shard, blueprint, map scroll,
 * instrument, net …). `ToolsSystem` asks the handlers in registration order after its built-in uses and before `notUsable`.
 */
export interface ItemUseHandler {
  readonly id: string;
  /** Cheap test without state: whether the item concerns this handler at all (its block, tool kind or id). */
  handles(def: ItemDef): boolean;
  use(sim: Simulation, ctx: ItemUseContext): ItemUseOutcome;
}
