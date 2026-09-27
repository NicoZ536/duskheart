/**
 * The open chest as a signal (M4-21): while the chest screen is mounted it takes the session's chest sample
 * (`UiBridge.werkstatt.sampleChest`, src/game/samples/werkstatt.ts) once per rendered frame and publishes an
 * immutable view whenever the chest changed – its slots (the simulation's immutable stacks), name, icon label,
 * the categories it takes and whether the player still stands within reach (the screen closes otherwise, like it
 * does when the chest is taken down).
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import type { ItemStack } from '../../../game/items/stack';
import { createChestSample } from '../../../game/samples/werkstatt';
import type { UiBridge, UiWerkstatt } from '../../bridge';

/** A placed chest as the screen shows it. */
export interface KistenAnsicht {
  readonly vorhanden: boolean;
  readonly id: number;
  readonly item: string;
  readonly name: string;
  readonly label: string | null;
  readonly slots: readonly (ItemStack | null)[];
  readonly nur: readonly string[] | null;
  readonly inReichweite: boolean;
}

/** A source of chest `id` over `werkstatt`, driven by `onFrame`; `stop` ends the sampling. */
export function createKistenQuelle(werkstatt: UiWerkstatt, id: number, onFrame: (listener: () => void) => () => void): { readonly ansicht: ReadonlySignal<KistenAnsicht | null>; stop(): void } {
  const sample = createChestSample();
  const ansicht = signal<KistenAnsicht | null>(null);
  let stand = -1;
  const frame = (): void => {
    werkstatt.sampleChest(id, sample);
    if (sample.stand === stand && ansicht.peek() !== null) return;
    stand = sample.stand;
    ansicht.value = { vorhanden: sample.vorhanden, id, item: sample.item, name: sample.name, label: sample.label, slots: [...sample.slots], nur: sample.nur, inReichweite: sample.inReichweite };
  };
  frame();
  const stop = onFrame(frame);
  return { ansicht, stop };
}

/** The view of chest `id` while the calling component is mounted (`null` without chest samples). */
export function useKistenAnsicht(bridge: UiBridge, id: number): KistenAnsicht | null {
  const quelle = useMemo(() => (bridge.werkstatt === null ? null : createKistenQuelle(bridge.werkstatt, id, (l) => bridge.onFrame(l))), [bridge, id]);
  useEffect(() => () => quelle?.stop(), [quelle]);
  return quelle?.ansicht.value ?? null;
}
