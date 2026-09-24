/**
 * Bag operations (MASTERPROMPT §13.1, §26 "Inventar-Komfort"; docs/SPIEL.md §2 "Operationen rein
 * funktional"). Every function takes a `BagsState` and returns a new one (or a rejection reason);
 * nothing is changed in place, so the systems apply a result only when it succeeded.
 *
 * - `addStack` (pick up, receive): joins matching stacks first (hotbar, inventory, backpack), then
 *   fills empty slots – things held in the hand (tools, weapons, lights, shields) try the hotbar first,
 *   everything else the inventory first. What does not fit is returned as `rest`.
 * - `moveStack` (drag and drop, number keys onto the hotbar): onto an empty slot, onto a matching
 *   stack up to its capacity, or – for a whole stack – swap with a different item. Equipment slots,
 *   the belt and the backpack slot only take what fits there (src/game/items/slots.ts).
 * - `splitStack` (right click): the smaller half goes to the given or the first free slot.
 * - `collectSame` (double click): pulls matching items from the carried bags onto one stack.
 * - `sortBags`: joins and orders inventory and backpack compartment (category, tier, id, quality,
 *   durability, freshness, count); the hotbar keeps its arrangement.
 * - `quickMove` (shift click): hotbar → inventory/backpack; inventory/backpack → a free matching
 *   equipment or backpack slot, else the hotbar; worn items → the carried bags.
 * - `discard` (bin), `removeItems` (crafting, eating), `selectHotbar`/`scrollHotbar` (keys 1–0,
 *   mouse wheel).
 * - Backpack: the compartment always has as many slots as the worn backpack adds. Taking off or
 *   swapping a backpack fails while items lie in slots that would disappear; a backpack never moves
 *   between its own slot and its compartment.
 * Joining stacks averages their freshness weighted by count (§13.1).
 */
import { ITEM_CATEGORIES, type ItemCategory, type ItemDef } from '../../content/schema/item';
import type { ItemCatalog } from '../items/catalog';
import { CARRY_AREAS, EQUIPMENT_SLOTS, sameSlot, slotAccepts, slotCapacity, type BagArea, type SlotRef } from '../items/slots';
import { canStack, joinedStack, stackQuality, withCount, type ItemStack } from '../items/stack';
import { backpackCapacity, isValidRef, slotAt, withArea, withSlot, type BagsState, type Slot } from './bags';
import { scrolledIndex, splitAmount, transferAmount } from './formulas';

/** Why a bag operation was refused. */
export const INVENTORY_REJECT_REASONS = [
  'invalidSlot',
  'sameSlot',
  'slotEmpty',
  'invalidCount',
  'wrongSlot',
  'occupied',
  'stackFull',
  'noSpace',
  'nothingToCollect',
  'backpackNotEmpty',
  'backpackInside',
  'notEnough',
] as const;
/** One rejection reason of a bag operation. */
export type InventoryRejectReason = (typeof INVENTORY_REJECT_REASONS)[number];

/** A refused operation. */
export interface BagsRejection {
  readonly ok: false;
  readonly reason: InventoryRejectReason;
}
/** A successful operation with its new state and extra results `T`. */
export type BagsSuccess<T extends object = object> = T & { readonly ok: true; readonly state: BagsState };
/** Result of a bag operation. */
export type BagsResult<T extends object = object> = BagsSuccess<T> | BagsRejection;

function reject(reason: InventoryRejectReason): BagsRejection {
  return { ok: false, reason };
}

/** Categories held in the hand: picked up into the hotbar first. */
const HAND_CATEGORIES: readonly ItemCategory[] = ['werkzeug', 'waffe', 'licht', 'schild'];
/** Where picked-up items join existing stacks. */
const JOIN_ORDER: readonly BagArea[] = ['schnellleiste', 'inventar', 'rucksackfach'];
const HAND_EMPTY_ORDER: readonly BagArea[] = ['schnellleiste', 'inventar', 'rucksackfach'];
const OTHER_EMPTY_ORDER: readonly BagArea[] = ['inventar', 'rucksackfach', 'schnellleiste'];
/** Where `removeItems` takes from first: the backpack compartment and the back of the inventory, the hotbar last. */
const REMOVE_ORDER: readonly BagArea[] = ['rucksackfach', 'inventar', 'schnellleiste'];

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Moves up to `count` items of `stack` into `areas`: first onto matching stacks, then into empty slots that accept it. */
function distribute(
  state: BagsState,
  def: ItemDef,
  stack: ItemStack,
  count: number,
  joinAreas: readonly BagArea[],
  emptyAreas: readonly BagArea[],
  skip: SlotRef | null,
): { state: BagsState; moved: number } {
  let next = state;
  let remaining = count;
  for (const area of joinAreas) {
    const capacity = slotCapacity(area, def);
    for (let index = 0; index < next[area].length && remaining > 0; index++) {
      const slot = next[area][index] ?? null;
      if (slot === null || (skip !== null && skip.bereich === area && skip.index === index) || !canStack(slot, stack)) continue;
      const moved = transferAmount(slot.count, remaining, capacity);
      if (moved === 0) continue;
      next = withSlot(next, { bereich: area, index }, joinedStack(slot, stack, moved));
      remaining -= moved;
    }
  }
  for (const area of emptyAreas) {
    const capacity = slotCapacity(area, def);
    for (let index = 0; index < next[area].length && remaining > 0; index++) {
      const ref = { bereich: area, index };
      if (next[area][index] !== null || !slotAccepts(ref, def)) continue;
      const moved = remaining < capacity ? remaining : capacity;
      next = withSlot(next, ref, withCount(stack, moved));
      remaining -= moved;
    }
  }
  return { state: next, moved: count - remaining };
}

/** Resizes the backpack compartment to the worn backpack; fails when slots that would disappear hold items. */
export function settleBackpack(state: BagsState, catalog: ItemCatalog): BagsResult {
  const capacity = backpackCapacity(state, catalog);
  const fach = state.rucksackfach;
  if (capacity === fach.length) return { ok: true, state };
  if (capacity > fach.length) return { ok: true, state: withArea(state, 'rucksackfach', [...fach, ...new Array<Slot>(capacity - fach.length).fill(null)]) };
  for (let i = capacity; i < fach.length; i++) if (fach[i] !== null) return reject('backpackNotEmpty');
  return { ok: true, state: withArea(state, 'rucksackfach', fach.slice(0, capacity)) };
}

/** A backpack never moves between its own slot and its compartment. */
function crossesBackpack(a: SlotRef, b: SlotRef): boolean {
  return (a.bereich === 'rucksack' && b.bereich === 'rucksackfach') || (a.bereich === 'rucksackfach' && b.bereich === 'rucksack');
}

/** `stack` minus `count` items (`null` when nothing is left). */
function reduced(stack: ItemStack, count: number): Slot {
  return stack.count > count ? withCount(stack, stack.count - count) : null;
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

/** Items of `item` in the carried bags (inventory, backpack compartment, hotbar) [items]. */
export function countItem(state: BagsState, item: string): number {
  let n = 0;
  for (const area of CARRY_AREAS) for (const slot of state[area]) if (slot !== null && slot.item === item) n += slot.count;
  return n;
}

/** The stack in the selected hotbar slot (the item in the hand), or `null`. */
export function selectedStack(state: BagsState): Slot {
  return state.schnellleiste[state.auswahl] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------------------------

/** Puts `stack` (any count) into the carried bags; `rest` items did not fit. Never fails. */
export function addStack(state: BagsState, catalog: ItemCatalog, stack: ItemStack): { state: BagsState; added: number; rest: number } {
  const def = catalog.get(stack.item);
  const emptyOrder = HAND_CATEGORIES.includes(def.kategorie) ? HAND_EMPTY_ORDER : OTHER_EMPTY_ORDER;
  const result = distribute(state, def, stack, stack.count, JOIN_ORDER, emptyOrder, null);
  return { state: result.state, added: result.moved, rest: stack.count - result.moved };
}

/** Takes `count` items of `item` from the carried bags; fails with `notEnough` when fewer are there. */
export function removeItems(state: BagsState, item: string, count: number): BagsResult<{ removed: readonly ItemStack[] }> {
  if (!Number.isInteger(count) || count < 1) return reject('invalidCount');
  if (countItem(state, item) < count) return reject('notEnough');
  let next = state;
  let remaining = count;
  const removed: ItemStack[] = [];
  for (const area of REMOVE_ORDER) {
    for (let index = next[area].length - 1; index >= 0 && remaining > 0; index--) {
      const slot = next[area][index] ?? null;
      if (slot === null || slot.item !== item) continue;
      const taken = slot.count < remaining ? slot.count : remaining;
      removed.push(withCount(slot, taken));
      next = withSlot(next, { bereich: area, index }, reduced(slot, taken));
      remaining -= taken;
    }
  }
  return { ok: true, state: next, removed };
}

/**
 * Moves `count` items (default: the whole stack) from `from` to `to`: onto an empty slot, onto a
 * matching stack up to its capacity (`stackFull` when it has no room), or swaps a whole stack with a
 * different item (`occupied` for a part of a stack).
 */
export function moveStack(state: BagsState, catalog: ItemCatalog, from: SlotRef, to: SlotRef, count?: number): BagsResult {
  if (!isValidRef(state, from) || !isValidRef(state, to)) return reject('invalidSlot');
  if (sameSlot(from, to)) return reject('sameSlot');
  const source = slotAt(state, from);
  if (source === null) return reject('slotEmpty');
  const n = count ?? source.count;
  if (!Number.isInteger(n) || n < 1 || n > source.count) return reject('invalidCount');
  const def = catalog.get(source.item);
  if (!slotAccepts(to, def)) return reject('wrongSlot');
  if (crossesBackpack(from, to)) return reject('backpackInside');
  const target = slotAt(state, to);
  const capacity = slotCapacity(to.bereich, def);
  let next: BagsState;
  if (target === null) {
    const moved = n < capacity ? n : capacity;
    next = withSlot(withSlot(state, to, withCount(source, moved)), from, reduced(source, moved));
  } else if (canStack(target, source)) {
    const moved = transferAmount(target.count, n, capacity);
    if (moved === 0) return reject('stackFull');
    next = withSlot(withSlot(state, to, joinedStack(target, source, moved)), from, reduced(source, moved));
  } else {
    if (n !== source.count) return reject('occupied');
    if (!slotAccepts(from, catalog.get(target.item))) return reject('wrongSlot');
    next = withSlot(withSlot(state, to, source), from, target);
  }
  return settleBackpack(next, catalog);
}

/** Splits off the smaller half of the stack at `from` onto `to` (must be empty) or the first free slot. */
export function splitStack(state: BagsState, catalog: ItemCatalog, from: SlotRef, to?: SlotRef): BagsResult<{ to: SlotRef }> {
  if (!isValidRef(state, from)) return reject('invalidSlot');
  const source = slotAt(state, from);
  if (source === null) return reject('slotEmpty');
  const half = splitAmount(source.count);
  if (half < 1) return reject('invalidCount');
  const def = catalog.get(source.item);
  let target: SlotRef | null = null;
  if (to !== undefined) {
    if (!isValidRef(state, to)) return reject('invalidSlot');
    if (sameSlot(from, to)) return reject('sameSlot');
    if (slotAt(state, to) !== null) return reject('occupied');
    if (!slotAccepts(to, def)) return reject('wrongSlot');
    target = to;
  } else {
    const areas: BagArea[] = (CARRY_AREAS as readonly BagArea[]).includes(from.bereich) ? [from.bereich, ...CARRY_AREAS.filter((a) => a !== from.bereich)] : [...CARRY_AREAS];
    for (const area of areas) {
      const index = state[area].indexOf(null);
      if (index >= 0) {
        target = { bereich: area, index };
        break;
      }
    }
    if (target === null) return reject('noSpace');
  }
  const capacity = slotCapacity(target.bereich, def);
  const moved = half < capacity ? half : capacity;
  const next = withSlot(withSlot(state, target, withCount(source, moved)), from, withCount(source, source.count - moved));
  return { ok: true, state: next, to: target };
}

/** Pulls matching items from the carried bags onto the stack at `at` until it is full. */
export function collectSame(state: BagsState, catalog: ItemCatalog, at: SlotRef): BagsResult<{ collected: number }> {
  if (!isValidRef(state, at)) return reject('invalidSlot');
  const first = slotAt(state, at);
  if (first === null) return reject('slotEmpty');
  const capacity = slotCapacity(at.bereich, catalog.get(first.item));
  if (first.count >= capacity) return reject('stackFull');
  let next = state;
  let target: ItemStack = first;
  for (const area of CARRY_AREAS) {
    for (let index = 0; index < next[area].length && target.count < capacity; index++) {
      if (area === at.bereich && index === at.index) continue;
      const slot = next[area][index] ?? null;
      if (slot === null || !canStack(target, slot)) continue;
      const moved = transferAmount(target.count, slot.count, capacity);
      target = joinedStack(target, slot, moved);
      next = withSlot(next, { bereich: area, index }, reduced(slot, moved));
    }
  }
  const collected = target.count - first.count;
  if (collected === 0) return reject('nothingToCollect');
  return { ok: true, state: withSlot(next, at, target), collected };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort order of stacks: category (schema order), tier, id, then better quality, more durability, fresher, larger first. */
function compareStacks(catalog: ItemCatalog, a: ItemStack, b: ItemStack): number {
  const da = catalog.get(a.item);
  const db = catalog.get(b.item);
  return (
    ITEM_CATEGORIES.indexOf(da.kategorie) - ITEM_CATEGORIES.indexOf(db.kategorie) ||
    da.stufe - db.stufe ||
    compareText(a.item, b.item) ||
    stackQuality(b) - stackQuality(a) ||
    (b.haltbarkeit ?? 0) - (a.haltbarkeit ?? 0) ||
    (b.frische ?? 0) - (a.frische ?? 0) ||
    b.count - a.count
  );
}

/** Joins and sorts the inventory and the backpack compartment (the hotbar keeps its arrangement). Never fails. */
export function sortBags(state: BagsState, catalog: ItemCatalog): BagsState {
  const joined: ItemStack[] = [];
  for (const slot of [...state.inventar, ...state.rucksackfach]) {
    if (slot === null) continue;
    let rest: ItemStack | null = slot;
    const capacity = catalog.get(slot.item).stapel;
    for (let i = 0; i < joined.length && rest !== null; i++) {
      const other = joined[i] as ItemStack;
      if (!canStack(other, rest)) continue;
      const moved = transferAmount(other.count, rest.count, capacity);
      if (moved === 0) continue;
      joined[i] = joinedStack(other, rest, moved);
      rest = reduced(rest, moved);
    }
    if (rest !== null) joined.push(rest);
  }
  joined.sort((a, b) => compareStacks(catalog, a, b));
  const slots: Slot[] = [...joined, ...new Array<Slot>(state.inventar.length + state.rucksackfach.length - joined.length).fill(null)];
  return withArea(withArea(state, 'inventar', slots.slice(0, state.inventar.length)), 'rucksackfach', slots.slice(state.inventar.length));
}

/** A free equipment or backpack slot the item at `from` would go to with a shift click, or `null`. */
function wearTarget(state: BagsState, def: ItemDef, from: SlotRef): SlotRef | null {
  if (def.kategorie === 'rucksack') return from.bereich !== 'rucksackfach' && state.rucksack[0] === null ? { bereich: 'rucksack', index: 0 } : null;
  for (let index = 0; index < EQUIPMENT_SLOTS.length; index++) {
    const ref: SlotRef = { bereich: 'ausruestung', index };
    if (state.ausruestung[index] === null && slotAccepts(ref, def)) return ref;
  }
  return null;
}

/** Shift click: moves the stack at `from` to its counterpart area (see module comment); `noSpace` when nothing moved. */
export function quickMove(state: BagsState, catalog: ItemCatalog, from: SlotRef): BagsResult<{ moved: number }> {
  if (!isValidRef(state, from)) return reject('invalidSlot');
  const source = slotAt(state, from);
  if (source === null) return reject('slotEmpty');
  const def = catalog.get(source.item);
  let areas: readonly BagArea[];
  switch (from.bereich) {
    case 'schnellleiste':
      areas = ['inventar', 'rucksackfach'];
      break;
    case 'inventar':
    case 'rucksackfach': {
      const wear = wearTarget(state, def, from);
      if (wear !== null) {
        const pieces = slotCapacity(wear.bereich, def);
        const equipped = moveStack(state, catalog, from, wear, pieces);
        return equipped.ok ? { ...equipped, moved: pieces } : equipped;
      }
      areas = ['schnellleiste'];
      break;
    }
    case 'rucksack':
      areas = ['inventar', 'schnellleiste'];
      break;
    case 'ausruestung':
    case 'guertel':
      areas = CARRY_AREAS;
      break;
  }
  const result = distribute(state, def, source, source.count, areas, areas, from);
  if (result.moved === 0) return reject('noSpace');
  const settled = settleBackpack(withSlot(result.state, from, reduced(source, result.moved)), catalog);
  return settled.ok ? { ...settled, moved: result.moved } : settled;
}

/** Throws away `count` items (default: the whole stack) at `from`. */
export function discard(state: BagsState, catalog: ItemCatalog, from: SlotRef, count?: number): BagsResult<{ discarded: ItemStack }> {
  if (!isValidRef(state, from)) return reject('invalidSlot');
  const source = slotAt(state, from);
  if (source === null) return reject('slotEmpty');
  const n = count ?? source.count;
  if (!Number.isInteger(n) || n < 1 || n > source.count) return reject('invalidCount');
  const settled = settleBackpack(withSlot(state, from, reduced(source, n)), catalog);
  return settled.ok ? { ...settled, discarded: withCount(source, n) } : settled;
}

/** Selects hotbar slot `index` (keys 1–0). */
export function selectHotbar(state: BagsState, index: number): BagsResult {
  if (!Number.isInteger(index) || index < 0 || index >= state.schnellleiste.length) return reject('invalidSlot');
  return { ok: true, state: index === state.auswahl ? state : { ...state, auswahl: index } };
}

/** Moves the hotbar selection `delta` slots (mouse wheel), wrapping around. */
export function scrollHotbar(state: BagsState, delta: number): BagsState {
  const index = scrolledIndex(state.auswahl, delta, state.schnellleiste.length);
  return index === state.auswahl ? state : { ...state, auswahl: index };
}
