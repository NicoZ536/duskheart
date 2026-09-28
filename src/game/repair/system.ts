/**
 * Repair system (MASTERPROMPT §13.1 "Haltbarkeit für Werkzeuge, Waffen, Rüstung; Reparatur an Werkbank, Amboss
 * oder Schleifstein (anteilige Materialkosten). Kaputt = unbenutzbar, nie zerstört."; M4-09).
 *
 * `repair.item {slot}` mends the piece in a bag or equipment slot – broken or worn – to the full durability of
 * its quality, when a station within reach repairs its category up to its tier (src/content/stations.ts
 * `reparatur`: Werkbank I stone-age pieces, Werkbank II and the bronze anvil up to bronze, the grindstone
 * tools and weapons up to bronze). The materials are a share of its recipe (formulas.ts), taken like
 * ingredients: from the bags first, then from the chests in reach (the crafting system's `takeItems`). A dead
 * or sleeping player mends nothing. No state of its own, no tick.
 */
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY } from '../../engine/ecs';
import type { CraftingSystem } from '../crafting/system';
import { isValidRef, slotAt, withSlot } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import type { SlotRef } from '../items/slots';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { StationSystem } from '../stations/system';
import type { RepairRejectReason } from './events';
import { fullDurability, repairCostsInto, repairRecipe, type RepairCost, type RepairCostRecord } from './formulas';

/** Id of the repair system. */
export const REPAIR_SYSTEM_ID = 'repair';
/** Share of a recipe's materials mending a broken piece costs (`BALANCE.crafting.repairMaterialShare`). */
const MATERIAL_SHARE = BALANCE.crafting.repairMaterialShare;

/** Dependencies of the repair system. */
export interface RepairSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  /** Recipes and taking materials (bags, chests in reach). */
  readonly crafting: CraftingSystem;
  /** Repair stations in reach. */
  readonly stations: StationSystem;
}

/** What a repair of a slot would cost and where, or why it cannot be done. */
export interface RepairQuote {
  readonly station: string;
  readonly costs: readonly RepairCost[];
}

/** A quote the caller keeps and `RepairSystem.quoteInto` overwrites: the station and the first `count` cost records. */
export interface RepairQuoteRecord {
  station: string;
  readonly costs: RepairCostRecord[];
  count: number;
}

/** A fresh `RepairQuoteRecord`. */
export function createRepairQuoteRecord(): RepairQuoteRecord {
  return { station: '', costs: [], count: 0 };
}

export class RepairSystem implements SimSystem {
  readonly id = REPAIR_SYSTEM_ID;
  readonly commands: CommandHandlers;
  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly crafting: CraftingSystem;
  private readonly stations: StationSystem;
  /** The quote `quote` and `repair.item` fill. */
  private readonly held = createRepairQuoteRecord();
  /** Whether an ingredient keeps its own durability (it is no material of the repair); one function for every quote. */
  private readonly durable = (item: string): boolean => this.crafting.recipes.catalog.get(item).haltbarkeit !== undefined;

  constructor(deps: RepairSystemDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.crafting = deps.crafting;
    this.stations = deps.stations;
    this.commands = {
      'repair.item': (sim, cmd, tick) => {
        const reason = this.repair(sim, cmd.slot, tick);
        if (reason !== null) sim.events.push('commandRejected', { type: cmd.type, reason, tick });
      },
    };
  }

  /** Station and material costs of mending the piece in `slot` now, or the refusal (the UI shows both). */
  quote(sim: Simulation, slot: SlotRef): RepairQuote | RepairRejectReason {
    const q = this.held;
    const reason = this.quoteInto(sim, slot, q);
    if (reason !== null) return reason;
    const costs: RepairCost[] = [];
    for (let i = 0; i < q.count; i++) {
      const c = q.costs[i] as RepairCostRecord;
      costs.push({ key: c.key, items: c.items, anzahl: c.anzahl });
    }
    return { station: q.station, costs };
  }

  /**
   * `quote` into the records of `out` (the repair tab's sampler, ≈ 10×/s: nothing is allocated once `out` holds enough
   * cost records): the refusal, or `null` with `out` filled. `out` keeps its last content on a refusal.
   */
  quoteInto(sim: Simulation, slot: SlotRef, out: RepairQuoteRecord): RepairRejectReason | null {
    if (sim.player === NULL_ENTITY || this.player.body(sim) === undefined) return 'noPlayer';
    const unable = this.player.incapacity(sim);
    if (unable !== null) return unable;
    const bags = this.inventory.state;
    if (!isValidRef(bags, slot)) return 'invalidSlot';
    const stack = slotAt(bags, slot);
    if (stack === null) return 'slotEmpty';
    const book = this.crafting.recipes;
    const def = book.catalog.get(stack.item);
    if (def.haltbarkeit === undefined) return 'notRepairable';
    // Worn (`wornShare` > 0) in whole uses; the share itself is taken inside the cost formula.
    const full = fullDurability(def, stack);
    if (stack.haltbarkeit === undefined || stack.haltbarkeit >= full) return 'notDamaged';
    const recipe = repairRecipe(book, def.id);
    if (recipe === undefined) return 'notRepairable';
    const station = this.stations.repairStationAtHand(sim, def);
    if (station === null) return 'noStation';
    out.station = station;
    out.count = repairCostsInto(book.ingredients(recipe.id), this.durable, stack.haltbarkeit, full, out.costs, MATERIAL_SHARE);
    return null;
  }

  private repair(sim: Simulation, slot: SlotRef, tick: number): RepairRejectReason | null {
    const q = this.quote(sim, slot);
    if (typeof q === 'string') return q;
    for (const c of q.costs) {
      let have = 0;
      for (const item of c.items) have += this.crafting.available(sim, item);
      if (have < c.anzahl) return 'notEnough';
    }
    const paid: Record<string, number> = {};
    for (const c of q.costs) {
      let need = c.anzahl;
      for (const item of c.items) {
        const n = Math.min(need, this.crafting.available(sim, item));
        if (n < 1) continue;
        if (this.crafting.takeItems(sim, item, n) === null) throw new Error(`RepairSystem: ${n} × "${item}" counted but not taken`);
        paid[item] = (paid[item] ?? 0) + n;
        need -= n;
        if (need === 0) break;
      }
    }
    const bags = this.inventory.state;
    const stack = slotAt(bags, slot);
    if (stack === null) throw new Error('RepairSystem: the piece left its slot while paying');
    const def = this.crafting.recipes.catalog.get(stack.item);
    const full = fullDurability(def, stack);
    this.inventory.bags.replace(withSlot(bags, slot, { ...stack, haltbarkeit: full }));
    sim.events.push('inventoryChanged', { change: 'move', tick });
    sim.events.push('itemRepaired', { item: stack.item, slot, haltbarkeit: full, station: q.station, materialien: paid, tick });
    return null;
  }
}
