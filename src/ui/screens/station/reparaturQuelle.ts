/**
 * The worn pieces of the player for the repair tab of an open station as a signal (M4-09): while the tab strip of a
 * repairing station is shown it takes the session's repair sample (`UiBridge.reparatur.sampleRepair`,
 * src/game/samples/reparatur.ts) every `VORRAT_TAKT`-th rendered frame (≈ 10×/s: the quote of every piece counts its
 * materials in the chests in reach) and publishes an immutable view whenever the sample changed – per piece its slot,
 * the stack, its full durability, whether this station mends it, the station `repair.item` would use and its material
 * costs with what is at hand, or why it cannot be mended now.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import type { SlotRef } from '../../../game/items/slots';
import type { ItemStack } from '../../../game/items/stack';
import type { RepairRejectReason } from '../../../game/repair/events';
import { createRepairSample } from '../../../game/samples/reparatur';
import type { UiBridge, UiReparatur } from '../../bridge';
import { VORRAT_TAKT } from '../handwerk/quelle';
import { slotKey } from '../inventar/model';

/** One material cost of mending a piece. */
export interface ReparaturKosten {
  /** The ingredient: an item id or an ingredient group id. */
  readonly key: string;
  /** Items that pay it (a group: its members). */
  readonly items: readonly string[];
  readonly anzahl: number;
  /** Usable pieces at hand (bags and the chests in reach). */
  readonly vorhanden: number;
}

/** A worn piece as the repair tab shows it. */
export interface ReparaturStueck {
  /** Its slot as a DOM key (`bereich:index`). */
  readonly key: string;
  readonly slot: SlotRef;
  readonly stack: ItemStack;
  /** Full durability of its quality [uses]. */
  readonly voll: number;
  /** Whether the open station mends it. */
  readonly hier: boolean;
  /** The station in reach `repair.item` would mend it at now, or `null`. */
  readonly station: string | null;
  /** Why it cannot be mended now apart from missing materials, or `null`. */
  readonly grund: RepairRejectReason | null;
  readonly kosten: readonly ReparaturKosten[];
}

/** The repair tab's view of an open station. */
export interface ReparaturAnsicht {
  readonly vorhanden: boolean;
  readonly stuecke: readonly ReparaturStueck[];
}

/** A source of the repair view of station `id` over `reparatur`, driven by `onFrame`; `stop` ends the sampling. */
export function createReparaturQuelle(reparatur: UiReparatur, id: number, onFrame: (listener: () => void) => () => void): { readonly ansicht: ReadonlySignal<ReparaturAnsicht | null>; stop(): void } {
  const sample = createRepairSample();
  const ansicht = signal<ReparaturAnsicht | null>(null);
  let stand = -1;
  let takt = 0;
  const lesen = (): void => {
    reparatur.sampleRepair(id, sample);
    if (sample.stand === stand && ansicht.peek() !== null) return;
    stand = sample.stand;
    const stuecke: ReparaturStueck[] = [];
    for (let i = 0; i < sample.anzahl; i++) {
      const p = sample.stuecke[i];
      if (p === undefined) continue;
      const slot: SlotRef = { bereich: p.bereich, index: p.index };
      stuecke.push({
        key: slotKey(slot),
        slot,
        stack: p.stack,
        voll: p.voll,
        hier: p.hier,
        station: p.station,
        grund: p.grund,
        kosten: p.kosten.slice(0, p.kostenAnzahl).map((k) => ({ key: k.key, items: k.items, anzahl: k.anzahl, vorhanden: k.vorhanden })),
      });
    }
    ansicht.value = { vorhanden: sample.vorhanden, stuecke };
  };
  lesen();
  const stop = onFrame(() => {
    takt = (takt + 1) % VORRAT_TAKT;
    if (takt === 0) lesen();
  });
  return { ansicht, stop };
}

/** The repair view of station `id` while the calling component is mounted and `an` holds (`null` otherwise or without samples). */
export function useReparaturAnsicht(bridge: UiBridge, id: number, an: boolean): ReparaturAnsicht | null {
  const quelle = useMemo(() => (!an || bridge.reparatur === null ? null : createReparaturQuelle(bridge.reparatur, id, (l) => bridge.onFrame(l))), [bridge, id, an]);
  useEffect(() => () => quelle?.stop(), [quelle]);
  return quelle?.ansicht.value ?? null;
}
