/**
 * Events of repair (MASTERPROMPT §2.7, §13.1; M4-09). The presentation maps `itemRepaired` to the mending
 * sound (src/audio/baseSounds.ts), sparks at the anvil and a notification.
 *
 * - `itemRepaired`: the piece `item` in slot `slot` is whole again (`haltbarkeit` uses) – mended at `station`,
 *   paid with `materialien` (item → pieces).
 */
import type { SlotRef } from '../items/slots';

/** Why a repair was refused. */
export const REPAIR_REJECT_REASONS = ['noPlayer', 'dead', 'asleep', 'invalidSlot', 'slotEmpty', 'notRepairable', 'notDamaged', 'noStation', 'notEnough'] as const;
/** One rejection reason of repair. */
export type RepairRejectReason = (typeof REPAIR_REJECT_REASONS)[number];

export interface RepairEventMap {
  itemRepaired: {
    readonly item: string;
    readonly slot: SlotRef;
    readonly haltbarkeit: number;
    readonly station: string;
    readonly materialien: Readonly<Record<string, number>>;
    readonly tick: number;
  };
}

/** Event names of `RepairEventMap`. */
export const REPAIR_EVENT_TYPES = ['itemRepaired'] as const satisfies ReadonlyArray<keyof RepairEventMap>;
