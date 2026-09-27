/**
 * M4-07: the station view of the station screen (src/ui/screens/station/ansicht.ts) – sampled once per frame while
 * the screen is mounted, published only when something shown changed: a slot, the batch, the stop reason, the
 * reach – and progress and glow in whole percent steps, so a working oven does not re-render its screen every frame.
 */
import { effect } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import type { StationSample } from '../../../src/game/samples/werkstatt';
import type { UiWerkstatt } from '../../../src/ui/bridge';
import { ANTEIL_SCHRITT, createStationQuelle } from '../../../src/ui/screens/station/ansicht';

describe('Stationsansicht', () => {
  it('veröffentlicht nur Änderungen, Fortschritt und Glut in ganzen Prozent', () => {
    const lehm = newStack(contentItemCatalog().get('lehm'), 3);
    const state = { fortschritt: 0, stand: 1, eingang: [lehm, null] as (typeof lehm | null)[], vorhanden: true };
    const werkstatt: UiWerkstatt = {
      sampleCrafting: () => false,
      sampleChest: () => false,
      sampleStation(_id: number, out: StationSample) {
        out.vorhanden = state.vorhanden;
        out.station = 'lehmofen';
        out.inReichweite = true;
        out.verarbeitung = true;
        out.eingang.length = 0;
        out.eingang.push(...state.eingang);
        out.ausgang.length = 2;
        out.ausgang.fill(null);
        out.rezept = 'rezept_keramik_topf';
        out.fortschritt = state.fortschritt;
        out.glut = 0.5;
        out.laeuft = true;
        out.halt = null;
        out.stand = state.stand;
        return state.vorhanden;
      },
    };
    const listeners: Array<() => void> = [];
    const q = createStationQuelle(werkstatt, 7, (l) => {
      listeners.push(l);
      return () => listeners.splice(listeners.indexOf(l), 1);
    });
    let renders = 0;
    const stop = effect(() => {
      void q.ansicht.value;
      renders++;
    });
    const frame = () => {
      for (const l of listeners) l();
    };
    expect(q.ansicht.value).toMatchObject({ id: 7, station: 'lehmofen', rezept: 'rezept_keramik_topf', fortschritt: 0 });
    // A tick's worth of progress (1/3600 of a batch) changes the sample, not the published view.
    for (let i = 1; i <= 30; i++) {
      state.fortschritt = i / 3600;
      state.stand++;
      frame();
    }
    expect(renders).toBe(1);
    state.fortschritt = 0.4234;
    state.stand++;
    frame();
    expect(renders).toBe(2);
    expect(q.ansicht.value?.fortschritt).toBe(Math.floor(0.4234 * ANTEIL_SCHRITT) / ANTEIL_SCHRITT);
    // A slot change always shows.
    state.eingang = [null, null];
    state.stand++;
    frame();
    expect(renders).toBe(3);
    expect(q.ansicht.value?.eingang).toEqual([null, null]);
    // Taken down: not there any more; stopping ends the sampling.
    state.vorhanden = false;
    state.stand++;
    frame();
    expect(q.ansicht.value?.vorhanden).toBe(false);
    q.stop();
    expect(listeners).toHaveLength(0);
    stop();
  });
});
