/**
 * The player's bags as immutable data (MASTERPROMPT §13.1; docs/SPIEL.md §2–§3): main inventory,
 * hotbar with its selected slot, backpack slot and backpack compartment, equipment and belt.
 * Operations (ops.ts) never change a state; they return a new one that shares every untouched area.
 * `PlayerBags` holds the current state for the systems (inventory and equipment own one part each).
 */
import type { ItemCatalog } from '../items/catalog';
import { BAG_AREAS, FIXED_AREA_SIZES, type BagArea, type SlotRef } from '../items/slots';
import type { ItemStack } from '../items/stack';

/** Content of one slot. */
export type Slot = ItemStack | null;

/** All bag areas of the player plus the selected hotbar slot. */
export interface BagsState {
  readonly inventar: readonly Slot[];
  readonly schnellleiste: readonly Slot[];
  /** The backpack slot (exactly one slot). */
  readonly rucksack: readonly Slot[];
  /** Extra slots of the worn backpack (as many as it adds; none without backpack). */
  readonly rucksackfach: readonly Slot[];
  /** Equipment in `EQUIPMENT_SLOTS` order. */
  readonly ausruestung: readonly Slot[];
  readonly guertel: readonly Slot[];
  /** Selected hotbar slot [index 0–9]. */
  readonly auswahl: number;
}

function emptyArea(size: number): readonly Slot[] {
  return Object.freeze(new Array<Slot>(size).fill(null));
}

/** Empty bags: no backpack, hotbar slot 1 selected. */
export function emptyBags(): BagsState {
  return {
    inventar: emptyArea(FIXED_AREA_SIZES.inventar),
    schnellleiste: emptyArea(FIXED_AREA_SIZES.schnellleiste),
    rucksack: emptyArea(FIXED_AREA_SIZES.rucksack),
    rucksackfach: emptyArea(0),
    ausruestung: emptyArea(FIXED_AREA_SIZES.ausruestung),
    guertel: emptyArea(FIXED_AREA_SIZES.guertel),
    auswahl: 0,
  };
}

/** The slots of one area. */
export function areaSlots(state: BagsState, area: BagArea): readonly Slot[] {
  return state[area];
}

/** Whether `ref` names an existing slot. */
export function isValidRef(state: BagsState, ref: SlotRef): boolean {
  return (BAG_AREAS as readonly string[]).includes(ref.bereich) && Number.isInteger(ref.index) && ref.index >= 0 && ref.index < state[ref.bereich].length;
}

/** Content of the slot `ref` (`null` when empty). Throws `RangeError` for an address outside the bags. */
export function slotAt(state: BagsState, ref: SlotRef): Slot {
  if (!isValidRef(state, ref)) throw new RangeError(`No slot ${ref.bereich}[${ref.index}]`);
  return state[ref.bereich][ref.index] ?? null;
}

/** `state` with the slot `ref` set to `slot` (the area is copied, all other areas are shared). */
export function withSlot(state: BagsState, ref: SlotRef, slot: Slot): BagsState {
  if (!isValidRef(state, ref)) throw new RangeError(`No slot ${ref.bereich}[${ref.index}]`);
  const area = state[ref.bereich].slice();
  area[ref.index] = slot;
  return { ...state, [ref.bereich]: Object.freeze(area) };
}

/** `state` with a whole area replaced. */
export function withArea(state: BagsState, area: BagArea, slots: readonly Slot[]): BagsState {
  return { ...state, [area]: Object.freeze(slots.slice()) };
}

/** Extra slots the backpack in the backpack slot adds [slots]; 0 without backpack. */
export function backpackCapacity(state: BagsState, catalog: ItemCatalog): number {
  const pack = state.rucksack[0] ?? null;
  return pack === null ? 0 : (catalog.get(pack.item).rucksack?.plaetze ?? 0);
}

/**
 * Holder of the current bags. `revision` counts every change (caches such as the equipment stats and
 * the UI compare it); it is not part of the saved state.
 */
export class PlayerBags {
  private stateValue: BagsState = emptyBags();
  private revisionValue = 0;

  constructor(readonly catalog: ItemCatalog) {}

  get state(): BagsState {
    return this.stateValue;
  }

  get revision(): number {
    return this.revisionValue;
  }

  /** Replaces the state (no-op when `next` is the current state). */
  replace(next: BagsState): void {
    if (next === this.stateValue) return;
    this.stateValue = next;
    this.revisionValue++;
  }
}
