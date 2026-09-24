/**
 * Inventory system (M3-02; MASTERPROMPT §13.1; docs/SPIEL.md §2–§3): the player's main inventory,
 * hotbar with the selected slot, backpack slot and backpack compartment.
 *
 * - Commands `inventory.*` and `player.selectHotbar`/`player.scrollHotbar` (commands.ts) run the pure
 *   bag operations (ops.ts) – including moves into and out of equipment, belt and backpack slot, which
 *   the equipment system keeps (both share one `PlayerBags`). A refused command raises
 *   `commandRejected` with the reason; a successful one raises `inventoryChanged` (and
 *   `equipmentChanged` for every worn slot it touched, `hotbarSelected` for the hand).
 * - API for other systems: `give`/`giveStack` (pick-ups, harvests, crafting results), `take`
 *   (crafting, eating), `count`, `roomFor`, `selected`. `inventory.give` (debug, tests) gives like a
 *   pick-up; an item the catalog does not know is refused with `unknownItem`.
 * - Save participant `inventory` (version 1): inventory, hotbar, backpack slot, compartment,
 *   selection. The equipment part belongs to the participant `equipment`.
 * - No time dependence (no tick hooks): nothing in the bags changes on its own. Spoilage arrives with
 *   the freshness system (§18).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import type { CommandOfType, GameCommandType } from '../commands';
import type { BagArea } from '../items/slots';
import { newStack, type ItemStack, type NewStackOptions } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import { backpackCapacity, type BagsState, type PlayerBags, type Slot } from './bags';
import type { InventoryChange } from './events';
import { copySlots, restoredArea, restoredSlot, savedSlotSchema } from './snapshot';
import {
  addStack,
  collectSame,
  countItem,
  discard,
  moveStack,
  quickMove,
  removeItems,
  scrollHotbar,
  selectedStack,
  selectHotbar,
  sortBags,
  splitStack,
  type BagsResult,
} from './ops';

/** Data version of the `inventory` save participant. */
export const INVENTORY_SAVE_VERSION = 1;

const BAGS = BALANCE.items.bags;
const inventorySnapshotSchema = z
  .object({
    inventar: z.array(savedSlotSchema).length(BAGS.inventorySlots),
    schnellleiste: z.array(savedSlotSchema).length(BAGS.hotbarSlots),
    rucksack: savedSlotSchema,
    rucksackfach: z.array(savedSlotSchema),
    auswahl: z
      .number()
      .int()
      .min(0)
      .max(BAGS.hotbarSlots - 1),
  })
  .strict();

/** Worn areas whose changes raise `equipmentChanged`. */
const WORN_AREAS = ['ausruestung', 'guertel', 'rucksack'] as const satisfies readonly BagArea[];

export class InventorySystem implements SimSystem {
  readonly id = 'inventory';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;

  constructor(readonly bags: PlayerBags) {
    const catalog = bags.catalog;
    this.commands = {
      'inventory.move': (sim, cmd, tick) => this.apply(sim, cmd.type, tick, 'move', moveStack(this.state, catalog, cmd.from, cmd.to, cmd.count)),
      'inventory.split': (sim, cmd, tick) => this.apply(sim, cmd.type, tick, 'split', splitStack(this.state, catalog, cmd.from, cmd.to)),
      'inventory.collect': (sim, cmd, tick) => this.apply(sim, cmd.type, tick, 'collect', collectSame(this.state, catalog, cmd.at)),
      'inventory.sort': (sim, cmd, tick) => this.apply(sim, cmd.type, tick, 'sort', { ok: true, state: sortBags(this.state, catalog) }),
      'inventory.quickMove': (sim, cmd, tick) => this.apply(sim, cmd.type, tick, 'quickMove', quickMove(this.state, catalog, cmd.from)),
      'inventory.discard': (sim, cmd, tick) => this.apply(sim, cmd.type, tick, 'discard', discard(this.state, catalog, cmd.from, cmd.count)),
      'player.selectHotbar': (sim, cmd, tick) => this.handleSelect(sim, cmd, tick),
      'player.scrollHotbar': (sim, cmd, tick) => this.select(sim, tick, scrollHotbar(this.state, cmd.delta)),
      'inventory.give': (sim, cmd, tick) => {
        if (!catalog.has(cmd.item)) {
          sim.events.push('commandRejected', { type: cmd.type, reason: 'unknownItem', tick });
          return;
        }
        const def = catalog.get(cmd.item);
        this.give(sim, cmd.item, cmd.count, {
          ...(cmd.qualitaet === undefined ? {} : { qualitaet: cmd.qualitaet }),
          ...(cmd.frische === undefined || def.frische === undefined ? {} : { frische: cmd.frische }),
        });
      },
    };
    this.save = {
      id: 'inventory',
      version: INVENTORY_SAVE_VERSION,
      serialize: () => {
        const s = this.state;
        return {
          inventar: copySlots(s.inventar),
          schnellleiste: copySlots(s.schnellleiste),
          rucksack: copySlots(s.rucksack)[0] ?? null,
          rucksackfach: copySlots(s.rucksackfach),
          auswahl: s.auswahl,
        };
      },
      deserialize: (data) => this.restore(data),
    };
  }

  /** The current bags. */
  get state(): BagsState {
    return this.bags.state;
  }

  /** The stack in the hand (selected hotbar slot), or `null`. */
  selected(): Slot {
    return selectedStack(this.state);
  }

  /** Items of `item` in the carried bags [items]. */
  count(item: string): number {
    return countItem(this.state, item);
  }

  /** How many items of `stack` would fit into the carried bags now [items] (the pick-up magnet takes only these). */
  roomFor(stack: ItemStack): number {
    return addStack(this.state, this.bags.catalog, stack).added;
  }

  /** Puts `count` new pieces of `item` into the bags (see `giveStack`). */
  give(sim: Simulation, item: string, count: number, options?: NewStackOptions): { added: number; rest: number } {
    return this.giveStack(sim, newStack(this.bags.catalog.get(item), count, options));
  }

  /**
   * Puts `stack` (any count) into the carried bags. Raises `itemsAdded` for what arrived and
   * `inventoryFull` for the rest, which the caller keeps (e.g. leaves lying in the world).
   */
  giveStack(sim: Simulation, stack: ItemStack): { added: number; rest: number } {
    const result = addStack(this.state, this.bags.catalog, stack);
    const tick = sim.eventTick;
    if (result.added > 0) {
      this.bags.replace(result.state);
      sim.events.push('itemsAdded', { item: stack.item, count: result.added, tick });
      sim.events.push('inventoryChanged', { change: 'add', tick });
    }
    if (result.rest > 0) sim.events.push('inventoryFull', { item: stack.item, count: result.rest, tick });
    return { added: result.added, rest: result.rest };
  }

  /** Takes `count` items of `item` from the carried bags; returns the taken stacks, or `null` (nothing taken) when fewer are there. */
  take(sim: Simulation, item: string, count: number): readonly ItemStack[] | null {
    const result = removeItems(this.state, item, count);
    if (!result.ok) return null;
    this.bags.replace(result.state);
    sim.events.push('inventoryChanged', { change: 'remove', tick: sim.eventTick });
    return result.removed;
  }

  private apply(sim: Simulation, type: GameCommandType, tick: number, change: InventoryChange, result: BagsResult): void {
    if (!result.ok) {
      sim.events.push('commandRejected', { type, reason: result.reason, tick });
      return;
    }
    const before = this.state;
    this.bags.replace(result.state);
    sim.events.push('inventoryChanged', { change, tick });
    for (const area of WORN_AREAS) {
      const old = before[area];
      const now = result.state[area];
      for (let index = 0; index < now.length; index++) {
        const slot = now[index] ?? null;
        if (slot !== (old[index] ?? null)) sim.events.push('equipmentChanged', { at: { bereich: area, index }, item: slot === null ? null : slot.item, tick });
      }
    }
  }

  private handleSelect(sim: Simulation, cmd: CommandOfType<'player.selectHotbar'>, tick: number): void {
    const result = selectHotbar(this.state, cmd.index);
    if (!result.ok) {
      sim.events.push('commandRejected', { type: cmd.type, reason: result.reason, tick });
      return;
    }
    this.select(sim, tick, result.state);
  }

  private select(sim: Simulation, tick: number, next: BagsState): void {
    if (next === this.state) return;
    this.bags.replace(next);
    sim.events.push('hotbarSelected', { index: next.auswahl, tick });
  }

  private restore(data: unknown): void {
    const parsed = inventorySnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`inventory snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const catalog = this.bags.catalog;
    const d = parsed.data;
    const next: BagsState = {
      ...this.state,
      inventar: Object.freeze(restoredArea(catalog, 'inventar', d.inventar)),
      schnellleiste: Object.freeze(restoredArea(catalog, 'schnellleiste', d.schnellleiste)),
      rucksack: Object.freeze([restoredSlot(catalog, { bereich: 'rucksack', index: 0 }, d.rucksack)]),
      rucksackfach: Object.freeze(restoredArea(catalog, 'rucksackfach', d.rucksackfach)),
      auswahl: d.auswahl,
    };
    const capacity = backpackCapacity(next, catalog);
    if (next.rucksackfach.length !== capacity) throw new TypeError(`inventory snapshot invalid: backpack compartment has ${next.rucksackfach.length} slots, the worn backpack ${capacity}`);
    this.bags.replace(next);
  }
}
