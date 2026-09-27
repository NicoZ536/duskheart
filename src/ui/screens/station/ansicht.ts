/**
 * The open station as a signal (M4-07): while the station screen is mounted it takes the session's station
 * sample (`UiBridge.werkstatt.sampleStation`, src/game/samples/werkstatt.ts) once per rendered frame and
 * publishes an immutable view whenever the station changed – its slots (the simulation's immutable stacks),
 * the batch in progress, the glow of its fuel, why it stands still, and whether the player still stands within
 * reach (the screen closes otherwise, like it does when the station is taken down). Progress and glow are published
 * in steps of 1 % (`ANTEIL_SCHRITT`): a working oven re-renders its screen a hundred times per batch, not every frame.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import type { ItemStack } from '../../../game/items/stack';
import { createStationSample } from '../../../game/samples/werkstatt';
import type { StationStopReason } from '../../../game/stations/state';
import type { UiBridge, UiWerkstatt } from '../../bridge';

/** A placed station as the screen shows it. */
export interface StationAnsicht {
  readonly vorhanden: boolean;
  readonly id: number;
  /** Station id (its item). */
  readonly station: string;
  readonly inReichweite: boolean;
  readonly verarbeitung: boolean;
  readonly eingang: readonly (ItemStack | null)[];
  readonly brennstoff: ItemStack | null;
  readonly ausgang: readonly (ItemStack | null)[];
  readonly rezept: string | null;
  readonly fortschritt: number;
  readonly glut: number;
  readonly laeuft: boolean;
  readonly halt: StationStopReason | null;
}

/** Steps of the published progress and glow [share]. */
export const ANTEIL_SCHRITT = 100;

function anteil(x: number): number {
  return Math.floor(x * ANTEIL_SCHRITT) / ANTEIL_SCHRITT;
}

function gleicheSlots(a: readonly (ItemStack | null)[], b: readonly (ItemStack | null)[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** Whether two views show the same. */
function gleich(a: StationAnsicht, b: StationAnsicht): boolean {
  return (
    a.vorhanden === b.vorhanden &&
    a.station === b.station &&
    a.inReichweite === b.inReichweite &&
    a.verarbeitung === b.verarbeitung &&
    a.brennstoff === b.brennstoff &&
    a.rezept === b.rezept &&
    a.fortschritt === b.fortschritt &&
    a.glut === b.glut &&
    a.laeuft === b.laeuft &&
    a.halt === b.halt &&
    gleicheSlots(a.eingang, b.eingang) &&
    gleicheSlots(a.ausgang, b.ausgang)
  );
}

/** A source of station `id` over `werkstatt`, driven by `onFrame`; `stop` ends the sampling. */
export function createStationQuelle(werkstatt: UiWerkstatt, id: number, onFrame: (listener: () => void) => () => void): { readonly ansicht: ReadonlySignal<StationAnsicht | null>; stop(): void } {
  const sample = createStationSample();
  const ansicht = signal<StationAnsicht | null>(null);
  let stand = -1;
  const frame = (): void => {
    werkstatt.sampleStation(id, sample);
    const alt = ansicht.peek();
    if (sample.stand === stand && alt !== null) return;
    stand = sample.stand;
    const neu: StationAnsicht = {
      vorhanden: sample.vorhanden,
      id,
      station: sample.station,
      inReichweite: sample.inReichweite,
      verarbeitung: sample.verarbeitung,
      eingang: [...sample.eingang],
      brennstoff: sample.brennstoff,
      ausgang: [...sample.ausgang],
      rezept: sample.rezept,
      fortschritt: anteil(sample.fortschritt),
      glut: anteil(sample.glut),
      laeuft: sample.laeuft,
      halt: sample.halt,
    };
    if (alt === null || !gleich(alt, neu)) ansicht.value = neu;
  };
  frame();
  const stop = onFrame(frame);
  return { ansicht, stop };
}

/** The view of station `id` while the calling component is mounted (`null` without station samples). */
export function useStationAnsicht(bridge: UiBridge, id: number): StationAnsicht | null {
  const quelle = useMemo(() => (bridge.werkstatt === null ? null : createStationQuelle(bridge.werkstatt, id, (l) => bridge.onFrame(l))), [bridge, id]);
  useEffect(() => () => quelle?.stop(), [quelle]);
  return quelle?.ansicht.value ?? null;
}
