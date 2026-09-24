/**
 * Events of the equipment (aggregated into `SimEventMap`, src/game/sim.ts). Putting on and taking
 * off raise `equipmentChanged` (src/game/inventory/events.ts, the bag operations move the pieces);
 * durability raises `itemBroken` when a piece breaks – the feedback hook for the break sound
 * (`EQUIPMENT_FEEDBACK_SFX.broken`), a crack effect on the slot and the hint where to repair it.
 */
import type { SlotRef } from '../items/slots';

/** Equipment events by name. */
export interface EquipmentEventMap {
  /** A piece's durability ran out: unusable until repaired (never destroyed, §13.1). */
  itemBroken: { readonly at: SlotRef; readonly item: string; readonly tick: number };
}

/** Event names of `EquipmentEventMap`. */
export const EQUIPMENT_EVENT_TYPES = ['itemBroken'] as const satisfies ReadonlyArray<keyof EquipmentEventMap>;

/** Sound of equipment feedback (docs/SPIEL.md §5; presets in M3-33). */
export const EQUIPMENT_FEEDBACK_SFX = {
  broken: 'sfx_ausruestung_kaputt',
} as const;
