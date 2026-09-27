/**
 * The search over the base of an open chest as a signal (MASTERPROMPT §16.7 "Suche über alle Kisten der Basis"; M4-21):
 * while the chest screen's search tab is shown it takes the session's chest search sample
 * (`UiBridge.kistensuche.sampleChestSearch`, src/game/samples/kistensuche.ts) every `VORRAT_TAKT`-th rendered frame
 * (≈ 10×/s) and at once when the query changes, and publishes an immutable view whenever the sample changed – the base
 * (a hearth's zone or the chests around this one), how many chests it holds and, per chest with finds, its name, label,
 * place relative to the open chest and the stacks found.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import type { ItemStack } from '../../../game/items/stack';
import { createChestSearchSample } from '../../../game/samples/kistensuche';
import type { UiBridge, UiKistensuche } from '../../bridge';
import { VORRAT_TAKT } from '../handwerk/quelle';

/** A stack the search found. */
export interface SucheFund {
  readonly index: number;
  readonly stack: ItemStack;
}

/** A chest of the base with finds. */
export interface SucheKiste {
  readonly id: number;
  readonly item: string;
  readonly name: string;
  readonly label: string | null;
  /** Offset of its centre from the open chest's [tiles; +x east, +y south]. */
  readonly dx: number;
  readonly dy: number;
  readonly entfernung: number;
  /** Whether it is the open chest. */
  readonly offen: boolean;
  readonly funde: readonly SucheFund[];
  /** Pieces found in it. */
  readonly stueck: number;
}

/** The search view of an open chest. */
export interface SucheAnsicht {
  readonly vorhanden: boolean;
  /** Whether a hearth's zone is the base (else the chests within `radius` of the open chest). */
  readonly herd: boolean;
  readonly radius: number;
  readonly kistenGesamt: number;
  /** Chests with finds, nearest first. */
  readonly kisten: readonly SucheKiste[];
}

/** A source of the search over the base of chest `id`: `suchen` sets the items, `aktiv` starts and stops the sampling. */
export interface KistenSucheQuelle {
  readonly ansicht: ReadonlySignal<SucheAnsicht | null>;
  suchen(items: ReadonlySet<string> | null): void;
  aktiv(an: boolean): void;
  stop(): void;
}

/** The source of the search over the base of chest `id` over `ui`, driven by `onFrame`. */
export function createKistenSucheQuelle(ui: UiKistensuche, id: number, onFrame: (listener: () => void) => () => void): KistenSucheQuelle {
  const sample = createChestSearchSample();
  const ansicht = signal<SucheAnsicht | null>(null);
  let stand = -1;
  let takt = 0;
  let an = false;
  const lesen = (): void => {
    ui.sampleChestSearch(id, sample);
    if (sample.stand === stand && ansicht.peek() !== null) return;
    stand = sample.stand;
    const kisten: SucheKiste[] = [];
    for (let i = 0; i < sample.kistenAnzahl; i++) {
      const k = sample.kisten[i];
      if (k === undefined) continue;
      kisten.push({
        id: k.id,
        item: k.item,
        name: k.name,
        label: k.label,
        dx: k.dx,
        dy: k.dy,
        entfernung: k.entfernung,
        offen: k.offen,
        funde: k.funde.slice(0, k.fundAnzahl).map((f) => ({ index: f.index, stack: f.stack })),
        stueck: k.stueck,
      });
    }
    ansicht.value = { vorhanden: sample.vorhanden, herd: sample.herd, radius: sample.radius, kistenGesamt: sample.kistenGesamt, kisten };
  };
  const stop = onFrame(() => {
    if (!an) return;
    takt = (takt + 1) % VORRAT_TAKT;
    if (takt === 0) lesen();
  });
  return {
    ansicht,
    suchen(items) {
      if (sample.suche === items) return;
      sample.suche = items;
      if (an) lesen();
    },
    aktiv(neu) {
      if (an === neu) return;
      an = neu;
      if (an) lesen();
    },
    stop,
  };
}

/** The search source of chest `id` while the calling component is mounted (`null` without search samples). */
export function useKistenSuche(bridge: UiBridge, id: number): KistenSucheQuelle | null {
  const quelle = useMemo(() => (bridge.kistensuche === null ? null : createKistenSucheQuelle(bridge.kistensuche, id, (l) => bridge.onFrame(l))), [bridge, id]);
  useEffect(() => () => quelle?.stop(), [quelle]);
  return quelle;
}
