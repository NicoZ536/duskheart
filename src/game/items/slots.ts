/**
 * Slot addressing of the player's bags (MASTERPROMPT §13.1; docs/SPIEL.md §3).
 *
 * Areas (`bereich`): `inventar` (30), `schnellleiste` (10, keys 1–0), `rucksack` (the backpack slot,
 * 1), `rucksackfach` (the extra slots of the worn backpack: 0, 8, 16 or 24), `ausruestung` (the
 * equipment slots in `EQUIPMENT_SLOTS` order) and `guertel` (3 quick-use slots). A slot is addressed as
 * `{ bereich, index }`; commands, events and the UI use the same form.
 *
 * What fits where: bag areas take anything; the backpack slot only backpacks; each equipment slot the
 * items of its kind (armour by slot, shields and lights in the off-hand, jewellery in both jewellery
 * slots); the belt only consumables (food, dishes, potions, medicine). Equipment and the backpack slot
 * hold a single piece.
 */
import { BALANCE } from '../../content/balance';
import { CONSUMABLE_CATEGORIES, type EquipmentSlotKind, type ItemDef } from '../../content/schema/item';

/** Bag areas. */
export const BAG_AREAS = ['inventar', 'schnellleiste', 'rucksack', 'rucksackfach', 'ausruestung', 'guertel'] as const;
/** One bag area. */
export type BagArea = (typeof BAG_AREAS)[number];

/** Address of one slot. */
export interface SlotRef {
  readonly bereich: BagArea;
  readonly index: number;
}

/** Equipment slots in index order (§13.1: Kopf, Brust, Beine, Füße, Rücken, Nebenhand, 2× Schmuck). */
export const EQUIPMENT_SLOTS = ['kopf', 'brust', 'beine', 'fuesse', 'ruecken', 'nebenhand', 'schmuck1', 'schmuck2'] as const;
/** One equipment slot. */
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

/** Which item slot kind each equipment slot takes. */
export const EQUIPMENT_SLOT_KIND: Readonly<Record<EquipmentSlot, EquipmentSlotKind>> = {
  kopf: 'kopf',
  brust: 'brust',
  beine: 'beine',
  fuesse: 'fuesse',
  ruecken: 'ruecken',
  nebenhand: 'nebenhand',
  schmuck1: 'schmuck',
  schmuck2: 'schmuck',
};

/** Areas of the carried bags (not worn): where picked-up items go and where crafting takes from. */
export const CARRY_AREAS = ['inventar', 'rucksackfach', 'schnellleiste'] as const satisfies readonly BagArea[];

/** Size of the fixed areas [slots]; `rucksackfach` depends on the worn backpack. */
export const FIXED_AREA_SIZES = {
  inventar: BALANCE.items.bags.inventorySlots,
  schnellleiste: BALANCE.items.bags.hotbarSlots,
  rucksack: 1,
  ausruestung: EQUIPMENT_SLOTS.length,
  guertel: BALANCE.items.bags.beltSlots,
} as const satisfies Readonly<Record<Exclude<BagArea, 'rucksackfach'>, number>>;

/** Largest slot index any area can have (the biggest of the main inventory and the largest backpack). */
export const MAX_SLOT_INDEX = Math.max(BALANCE.items.bags.inventorySlots, ...BALANCE.items.bags.backpackSlots) - 1;

/** Index of an equipment slot in the `ausruestung` area. */
export function equipmentSlotIndex(slot: EquipmentSlot): number {
  return EQUIPMENT_SLOTS.indexOf(slot);
}

/** The address of an equipment slot. */
export function equipmentRef(slot: EquipmentSlot): SlotRef {
  return { bereich: 'ausruestung', index: equipmentSlotIndex(slot) };
}

/** Whether `ref` may hold the item `def`. */
export function slotAccepts(ref: SlotRef, def: ItemDef): boolean {
  switch (ref.bereich) {
    case 'inventar':
    case 'schnellleiste':
    case 'rucksackfach':
      return true;
    case 'rucksack':
      return def.kategorie === 'rucksack';
    case 'guertel':
      return (CONSUMABLE_CATEGORIES as readonly string[]).includes(def.kategorie);
    case 'ausruestung': {
      const slot = EQUIPMENT_SLOTS[ref.index];
      return slot !== undefined && def.ausruestung === EQUIPMENT_SLOT_KIND[slot];
    }
  }
}

/** Most pieces of `def` one slot of `area` holds: a single piece in equipment and backpack slots, else the stack size. */
export function slotCapacity(area: BagArea, def: ItemDef): number {
  return area === 'ausruestung' || area === 'rucksack' ? 1 : def.stapel;
}

/** Whether two addresses name the same slot. */
export function sameSlot(a: SlotRef, b: SlotRef): boolean {
  return a.bereich === b.bereich && a.index === b.index;
}
