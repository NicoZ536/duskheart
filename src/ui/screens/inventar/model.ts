/**
 * Interaction rules of the inventory screen (MASTERPROMPT §26 "Inventar-Komfort", §13.1; M3-30) as
 * pure functions, so they are unit tested without a DOM:
 *
 * - Slots are addressed as `{ bereich, index }` (src/game/items/slots.ts); in the DOM as
 *   `data-slot="<bereich>:<index>"` (`slotKey`/`parseSlotKey`).
 * - Pointer: drag & drop moves (`dropIntent`), Shift+click moves to the natural other place
 *   (`quickMove`), right click splits, double click gathers the same item (`collect`), number keys
 *   1–0 over a slot put its stack onto that hotbar slot (`hotbarIntent`), the bin destroys – from
 *   rarity Selten on only after a confirmation (`needsDiscardConfirm`).
 * - Keyboard/controller: confirm picks a stack up and confirm on another slot puts it there;
 *   confirm on the same slot again gathers the same item (the double click) – `carryConfirm`.
 *   Next/prev (E/Q, RB/LB) are Shift+click and right click on the focused slot.
 * The simulation decides whether an intent succeeds; the screen only sends commands.
 */
import { RARITIES, type Rarity } from '../../../content/schema/common';
import type { ItemDef } from '../../../content/schema/item';
import type { BagsState, Slot } from '../../../game/inventory/bags';
import { BAG_AREAS, EQUIPMENT_SLOTS, EQUIPMENT_SLOT_KIND, sameSlot, type BagArea, type EquipmentSlot, type SlotRef } from '../../../game/items/slots';

/** Slots per row of the inventory, backpack compartment and hotbar grids. */
export const GRID_COLUMNS = 10;
/** Lowest rarity whose items the bin only destroys after a confirmation (§26 "Mülleimer (Bestätigung ab Selten)"). */
export const DISCARD_CONFIRM_FROM: Rarity = 'selten';

/** DOM key of a slot (`inventar:3`). */
export function slotKey(ref: SlotRef): string {
  return `${ref.bereich}:${ref.index}`;
}

/** The slot of a DOM key, or `null` when it is malformed. */
export function parseSlotKey(key: string | null | undefined): SlotRef | null {
  if (typeof key !== 'string') return null;
  const sep = key.indexOf(':');
  if (sep < 0) return null;
  const bereich = key.slice(0, sep);
  const index = Number(key.slice(sep + 1));
  if (!(BAG_AREAS as readonly string[]).includes(bereich) || !Number.isInteger(index) || index < 0) return null;
  return { bereich: bereich as BagArea, index };
}

/** What a gesture asks the simulation to do. */
export type SlotIntent =
  | { readonly kind: 'none' }
  | { readonly kind: 'move'; readonly from: SlotRef; readonly to: SlotRef }
  | { readonly kind: 'quickMove'; readonly from: SlotRef }
  | { readonly kind: 'split'; readonly from: SlotRef }
  | { readonly kind: 'collect'; readonly at: SlotRef }
  | { readonly kind: 'discard'; readonly from: SlotRef; readonly confirm: boolean };

const NONE: SlotIntent = { kind: 'none' };

/** Whether the bin asks before destroying `def` (rarity Selten or higher). */
export function needsDiscardConfirm(def: Pick<ItemDef, 'raritaet'>): boolean {
  return RARITIES.indexOf(def.raritaet) >= RARITIES.indexOf(DISCARD_CONFIRM_FROM);
}

/** Dropping the stack of `from` on `to`: a move, nothing on its own slot. */
export function dropIntent(from: SlotRef, to: SlotRef): SlotIntent {
  return sameSlot(from, to) ? NONE : { kind: 'move', from, to };
}

/** Dropping the stack of `from` (holding `def`) on the bin. */
export function discardIntent(from: SlotRef, def: Pick<ItemDef, 'raritaet'>): SlotIntent {
  return { kind: 'discard', from, confirm: needsDiscardConfirm(def) };
}

/** Number key `index` (0 = key 1 … 9 = key 0) over the slot `from`: its stack goes onto that hotbar slot. */
export function hotbarIntent(from: SlotRef, index: number): SlotIntent {
  return dropIntent(from, { bereich: 'schnellleiste', index });
}

/** Modifiers of a click on a filled slot. */
export interface ClickGesture {
  /** 0 = primary, 2 = secondary button. */
  readonly button: number;
  readonly shift: boolean;
  /** Click count of the browser (2 = double click). */
  readonly detail: number;
}

/** A click on the filled slot `at` (drags are handled by `dropIntent`). */
export function clickIntent(at: SlotRef, click: ClickGesture): SlotIntent {
  if (click.button === 2) return { kind: 'split', from: at };
  if (click.button !== 0) return NONE;
  if (click.shift) return { kind: 'quickMove', from: at };
  if (click.detail === 2) return { kind: 'collect', at };
  return NONE;
}

/** Keyboard carry: the stack picked up with confirm (`null` = hands empty). */
export interface CarryStep {
  readonly carry: SlotRef | null;
  readonly intent: SlotIntent;
}

/** Confirm on the slot `at` (holding `filled` items or not) while carrying `carry` (see module comment). */
export function carryConfirm(carry: SlotRef | null, at: SlotRef, filled: boolean): CarryStep {
  if (carry === null) return { carry: filled ? at : null, intent: NONE };
  if (sameSlot(carry, at)) return { carry: null, intent: { kind: 'collect', at } };
  return { carry: null, intent: { kind: 'move', from: carry, to: at } };
}

/** The stack in `ref`, or `null` (also for an index outside the area). */
export function stackAt(bags: BagsState, ref: SlotRef): Slot {
  return bags[ref.bereich][ref.index] ?? null;
}

/**
 * The worn piece a tooltip of `def` compares with (§26 "Vergleichs-Tooltips grün/rot"): the piece
 * in the equipment slot of its kind (the first jewellery slot that holds one), a backpack with the
 * worn backpack, a tool or weapon with the stack in the hand (selected hotbar slot) of the same
 * category. `from` = where `def` lies: a worn piece is not compared with itself.
 */
export function comparisonSlot(bags: BagsState, def: Pick<ItemDef, 'ausruestung' | 'kategorie'>, from: SlotRef): SlotRef | null {
  if (from.bereich === 'ausruestung' || from.bereich === 'rucksack' || from.bereich === 'guertel') return null;
  if (def.ausruestung !== undefined) {
    const slots = EQUIPMENT_SLOTS.filter((s) => EQUIPMENT_SLOT_KIND[s] === def.ausruestung);
    const worn = slots.find((s) => stackAt(bags, equipmentSlotRef(s)) !== null);
    return worn === undefined ? null : equipmentSlotRef(worn);
  }
  if (def.kategorie === 'rucksack') return stackAt(bags, { bereich: 'rucksack', index: 0 }) === null ? null : { bereich: 'rucksack', index: 0 };
  if (def.kategorie === 'werkzeug' || def.kategorie === 'waffe') {
    const hand: SlotRef = { bereich: 'schnellleiste', index: bags.auswahl };
    return sameSlot(hand, from) || stackAt(bags, hand) === null ? null : hand;
  }
  return null;
}

/** The address of an equipment slot. */
export function equipmentSlotRef(slot: EquipmentSlot): SlotRef {
  return { bereich: 'ausruestung', index: EQUIPMENT_SLOTS.indexOf(slot) };
}

/** Equipment slots left and right of the figure (§13.1 order: armour left, back, off-hand and jewellery right). */
export const DOLL_LEFT: readonly EquipmentSlot[] = ['kopf', 'brust', 'beine', 'fuesse'];
export const DOLL_RIGHT: readonly EquipmentSlot[] = ['ruecken', 'nebenhand', 'schmuck1', 'schmuck2'];

/** Rows of a grid of `count` slots with `columns` per row. */
export function gridRows(count: number, columns: number = GRID_COLUMNS): number {
  return Math.ceil(count / columns);
}
