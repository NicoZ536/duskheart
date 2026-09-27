/**
 * The open hearth as signals (M4-20): while the hearth screen is mounted it takes the session's hearth sample
 * (`UiBridge.basis.sampleHearth`, src/game/samples/basis.ts) once per rendered frame and publishes immutable views
 * whenever they changed – the fire (`herd`: burning, game time left, glow, store, radius, cores, reach) and the
 * overview of its base (`uebersicht`: the chests with their slots and the finds of the search), each on its own,
 * so the time ticking down does not redraw the overview. `suchen(items)` sets the items the search looks for.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import type { ItemStack } from '../../../game/items/stack';
import { createHearthSample } from '../../../game/samples/basis';
import type { UiBasis, UiBridge } from '../../bridge';
import type { KistenEintrag } from './modell';

/** A placed hearth as the screen shows it. */
export interface HerdAnsicht {
  readonly vorhanden: boolean;
  readonly id: number;
  readonly inReichweite: boolean;
  readonly brennt: boolean;
  /** Game minutes the fire lasts. */
  readonly restMinuten: number;
  /** Glow left of the piece in the fire [0–1]. */
  readonly glut: number;
  readonly vorrat: readonly ItemStack[];
  readonly stueck: number;
  readonly radius: number;
  readonly kerne: readonly (string | null)[];
}

/** A chest of the base with its slots. */
export interface BasisKiste extends KistenEintrag {
  readonly slots: readonly (ItemStack | null)[];
}

/** The overview of the base as the screen shows it. */
export interface UebersichtAnsicht {
  /** Whether it is there (the hearth burns). */
  readonly gezeigt: boolean;
  readonly kisten: readonly BasisKiste[];
  /** Finds of the current search. */
  readonly treffer: ReadonlyArray<{ readonly kiste: number; readonly index: number; readonly stack: ItemStack }>;
}

/** A source of hearth `id` over `basis`, driven by `onFrame`; `stop` ends the sampling. */
export function createHerdQuelle(
  basis: UiBasis,
  id: number,
  onFrame: (listener: () => void) => () => void,
): { readonly herd: ReadonlySignal<HerdAnsicht | null>; readonly uebersicht: ReadonlySignal<UebersichtAnsicht | null>; suchen(items: ReadonlySet<string> | null): void; stop(): void } {
  const sample = createHearthSample();
  const herd = signal<HerdAnsicht | null>(null);
  const uebersicht = signal<UebersichtAnsicht | null>(null);
  let stand = -1;
  let uebersichtStand = -1;
  const frame = (): void => {
    basis.sampleHearth(id, sample);
    if (sample.stand !== stand || herd.peek() === null) {
      stand = sample.stand;
      herd.value = {
        vorhanden: sample.vorhanden,
        id,
        inReichweite: sample.inReichweite,
        brennt: sample.brennt,
        restMinuten: sample.restMinuten,
        glut: sample.glut,
        vorrat: [...sample.vorrat],
        stueck: sample.stueck,
        radius: sample.radius,
        kerne: [...sample.kerne],
      };
    }
    if (sample.uebersichtStand !== uebersichtStand || uebersicht.peek() === null) {
      uebersichtStand = sample.uebersichtStand;
      uebersicht.value = {
        gezeigt: sample.uebersicht,
        kisten: sample.kisten.slice(0, sample.kistenAnzahl).map((k) => ({ id: k.id, item: k.item, name: k.name, label: k.label, belegt: k.belegt, plaetze: k.slots.length, entfernung: k.entfernung, slots: [...k.slots] })),
        treffer: sample.treffer.slice(0, sample.trefferAnzahl).map((t) => ({ kiste: t.kiste, index: t.index, stack: t.stack })),
      };
    }
  };
  frame();
  const stop = onFrame(frame);
  return {
    herd,
    uebersicht,
    suchen(items) {
      if (sample.suche === items) return;
      sample.suche = items;
      frame();
    },
    stop,
  };
}

/** The hearth source of `id` while the calling component is mounted (`null` without base samples). */
export function useHerdQuelle(bridge: UiBridge, id: number): ReturnType<typeof createHerdQuelle> | null {
  const quelle = useMemo(() => (bridge.basis === null ? null : createHerdQuelle(bridge.basis, id, (l) => bridge.onFrame(l))), [bridge, id]);
  useEffect(() => () => quelle?.stop(), [quelle]);
  return quelle;
}
