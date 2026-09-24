/**
 * Equipment system (M3-03; MASTERPROMPT §13.1; docs/SPIEL.md §3): head, chest, legs, feet, back,
 * off-hand (light or shield), two jewellery slots and the belt with 3 quick-use slots.
 *
 * - The pieces live in the shared `PlayerBags` (areas `ausruestung` and `guertel`); putting on and
 *   taking off are bag moves (`inventory.move`, `inventory.quickMove`), which check what fits where.
 * - `stats()`: aggregated stats of the worn pieces (formulas.ts), cached per bag revision – read
 *   every tick by the player's modifier source (modifiers.ts) without allocating.
 * - Durability: `wear(sim, ref, uses)` wears the piece at any bag slot (the tool in the hand, a worn
 *   armour piece) and raises `itemBroken` when it breaks; `usable(ref)` tells tools and weapons
 *   whether they still work. Broken pieces stay where they are.
 * - Save participant `equipment` (version 1): the equipment slots by name and the belt.
 * - No time dependence (no tick hooks).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { EQUIPMENT_SLOTS, type EquipmentSlot, type SlotRef } from '../items/slots';
import { isValidRef, slotAt, withSlot, type BagsState, type PlayerBags, type Slot } from '../inventory/bags';
import { copySlots, restoredSlot, savedSlotSchema } from '../inventory/snapshot';
import type { SaveParticipant } from '../participant';
import type { SimSystem, Simulation } from '../sim';
import { aggregateEquipmentStats, isUsable, wearStack, type EquipmentStats, type EquippedPiece } from './formulas';

/** Data version of the `equipment` save participant. */
export const EQUIPMENT_SAVE_VERSION = 1;

const equipmentSnapshotSchema = z
  .object({
    ausruestung: z.object(Object.fromEntries(EQUIPMENT_SLOTS.map((s) => [s, savedSlotSchema])) as Record<EquipmentSlot, typeof savedSlotSchema>).strict(),
    guertel: z.array(savedSlotSchema).length(BALANCE.items.bags.beltSlots),
  })
  .strict();

/** Outcome of `wear`. */
export type WearOutcome = 'worn' | 'broke' | 'alreadyBroken' | 'noDurability' | 'empty';

export class EquipmentSystem implements SimSystem {
  readonly id = 'equipment';
  readonly save: SaveParticipant;
  private statsCache: EquipmentStats | null = null;
  private statsRevision = -1;

  constructor(readonly bags: PlayerBags) {
    this.save = {
      id: 'equipment',
      version: EQUIPMENT_SAVE_VERSION,
      serialize: () => {
        const s = this.bags.state;
        const worn = copySlots(s.ausruestung);
        return {
          ausruestung: Object.fromEntries(EQUIPMENT_SLOTS.map((slot, i) => [slot, worn[i] ?? null])),
          guertel: copySlots(s.guertel),
        };
      },
      deserialize: (data) => this.restore(data),
    };
  }

  /** The piece worn in `slot`, or `null`. */
  worn(slot: EquipmentSlot): Slot {
    return this.bags.state.ausruestung[EQUIPMENT_SLOTS.indexOf(slot)] ?? null;
  }

  /** The belt slots. */
  belt(): readonly Slot[] {
    return this.bags.state.guertel;
  }

  /** Aggregated stats of the worn equipment (cached until the bags change). */
  stats(): EquipmentStats {
    if (this.statsCache === null || this.statsRevision !== this.bags.revision) {
      const pieces: EquippedPiece[] = [];
      for (const stack of this.bags.state.ausruestung) if (stack !== null) pieces.push({ def: this.bags.catalog.get(stack.item), stack });
      this.statsCache = aggregateEquipmentStats(pieces);
      this.statsRevision = this.bags.revision;
    }
    return this.statsCache;
  }

  /** Whether the slot `ref` holds a piece that works (not broken). */
  usable(ref: SlotRef): boolean {
    const state = this.bags.state;
    if (!isValidRef(state, ref)) return false;
    const stack = slotAt(state, ref);
    return stack !== null && isUsable(stack);
  }

  /**
   * Wears the piece at `ref` by `uses` [uses] (a tool hit, an absorbed blow). Raises `itemBroken` when
   * its durability runs out; a broken piece does not wear further and stays in its slot.
   */
  wear(sim: Simulation, ref: SlotRef, uses = 1): WearOutcome {
    const state = this.bags.state;
    if (!isValidRef(state, ref)) return 'empty';
    const stack = slotAt(state, ref);
    if (stack === null) return 'empty';
    if (stack.haltbarkeit === undefined) return 'noDurability';
    if (stack.haltbarkeit === 0) return 'alreadyBroken';
    const worn = wearStack(stack, uses);
    this.bags.replace(withSlot(state, ref, worn.stack));
    if (!worn.broke) return 'worn';
    sim.events.push('itemBroken', { at: { bereich: ref.bereich, index: ref.index }, item: stack.item, tick: sim.eventTick });
    return 'broke';
  }

  private restore(data: unknown): void {
    const parsed = equipmentSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`equipment snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const catalog = this.bags.catalog;
    const d = parsed.data;
    const next: BagsState = {
      ...this.bags.state,
      ausruestung: Object.freeze(EQUIPMENT_SLOTS.map((slot, index) => restoredSlot(catalog, { bereich: 'ausruestung', index }, d.ausruestung[slot]))),
      guertel: Object.freeze(d.guertel.map((s, index) => restoredSlot(catalog, { bereich: 'guertel', index }, s))),
    };
    this.bags.replace(next);
  }
}
