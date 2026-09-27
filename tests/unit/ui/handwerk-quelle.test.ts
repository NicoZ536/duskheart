/**
 * M4-07/M4-08/M4-32: the crafting source of the recipe screens and the tracker (src/ui/screens/handwerk/quelle.ts)
 * and the crafting, station and chest commands of the bridge (src/ui/bridge.ts):
 *
 * - the source samples only while some view needs it, asks for the union of what the views need (at once for a new
 *   need, then every `VORRAT_TAKT` frames; the water only while a need asks for it), and publishes a signal only when
 *   its content changed (no re-render per frame for an idle queue);
 * - the pins are the sample's (the simulation's list): `anheften` sends `craft.pin`, the list follows with the sample;
 * - every action of the bridge queues exactly one valid game command.
 */
import { effect } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import { parseGameCommand } from '../../../src/game/commands';
import type { CraftingSample } from '../../../src/game/samples/werkstatt';
import type { SessionStatus } from '../../../src/game/session';
import { createUiBridge, type UiBridgeSession, type UiWerkstatt } from '../../../src/ui/bridge';
import { createWerkstattQuelle, VORRAT_TAKT } from '../../../src/ui/screens/handwerk/quelle';

/** A crafting sample driven by the test; counts its calls. */
function fakeWerkstatt() {
  const state = { calls: 0, bags: { fasern: 4 } as Record<string, number>, visible: ['rezept_faserseil'], progress: 0, orders: 0, asked: [] as string[][], pins: [] as string[], water: true, waterAsked: 0 };
  const werkstatt: UiWerkstatt = {
    sampleCrafting(out: CraftingSample) {
      state.calls++;
      state.asked.push([...out.frageItems]);
      out.vorhanden = true;
      if (out.sichtbar.size !== state.visible.length) {
        out.sichtbar.clear();
        for (const v of state.visible) out.sichtbar.add(v);
        out.sichtbarStand++;
      }
      if (out.angeheftet.join() !== state.pins.join()) {
        out.angeheftet.length = 0;
        out.angeheftet.push(...state.pins);
        out.angeheftetStand++;
      }
      if (out.frageWasser) {
        state.waterAsked++;
        out.amWasser = state.water;
      }
      out.auftragAnzahl = state.orders;
      for (let i = 0; i < state.orders; i++) out.auftraege[i] = { rezept: 'rezept_faserseil', anzahl: 2, fortschritt: state.progress, station: null };
      for (const item of out.frageItems) {
        out.imBeutel.set(item, state.bags[item] ?? 0);
        out.verfuegbar.set(item, state.bags[item] ?? 0);
      }
      for (const s of out.frageStationen) out.stationen.set(s, null);
      return true;
    },
    sampleStation: () => false,
    sampleChest: () => false,
  };
  return { werkstatt, state };
}

describe('Werkstatt-Quelle', () => {
  it('tastet nur ab, solange ein Bedarf besteht, und fragt die Vereinigung aller Bedarfe', () => {
    const { werkstatt, state } = fakeWerkstatt();
    const listeners: Array<() => void> = [];
    const onFrame = (l: () => void) => {
      listeners.push(l);
      return () => listeners.splice(listeners.indexOf(l), 1);
    };
    const q = createWerkstattQuelle(werkstatt, onFrame, { pin: () => undefined });
    expect(listeners).toHaveLength(0);
    const a = q.bedarf(['fasern'], []);
    const b = q.bedarf(['zweig', 'fasern'], ['werkbank']);
    expect(listeners).toHaveLength(1);
    // A new need is asked at once, then the stock every VORRAT_TAKT frames (the queue every frame).
    expect(state.asked[state.asked.length - 1]?.sort()).toEqual(['fasern', 'zweig']);
    state.asked.length = 0;
    for (let i = 0; i < VORRAT_TAKT; i++) for (const l of [...listeners]) l();
    expect(state.asked.map((x) => x.length)).toEqual([...Array<number>(VORRAT_TAKT - 1).fill(0), 2]);
    expect(q.vorrat.value.verfuegbar('fasern')).toBe(4);
    expect(q.vorrat.value.stationAnHand('werkbank')).toBeNull();
    a();
    b();
    expect(listeners).toHaveLength(0);
    const calls = state.calls;
    for (const l of [...listeners]) l();
    expect(state.calls).toBe(calls);
  });

  it('veröffentlicht nur bei Änderungen', () => {
    const { werkstatt, state } = fakeWerkstatt();
    const listeners: Array<() => void> = [];
    const q = createWerkstattQuelle(
      werkstatt,
      (l) => {
        listeners.push(l);
        return () => undefined;
      },
      { pin: () => undefined },
    );
    q.bedarf(['fasern'], []);
    let stand = 0;
    let schlange = 0;
    let vorrat = 0;
    const stop = effect(() => {
      void q.stand.value;
      void q.warteschlange.value;
      void q.vorrat.value;
    });
    const s1 = effect(() => {
      void q.stand.value;
      stand++;
    });
    const s2 = effect(() => {
      void q.warteschlange.value;
      schlange++;
    });
    const s3 = effect(() => {
      void q.vorrat.value;
      vorrat++;
    });
    const frame = () => {
      for (const l of listeners) l();
    };
    frame();
    frame();
    expect([stand, schlange, vorrat]).toEqual([1, 1, 1]);
    state.orders = 1;
    frame();
    expect(q.warteschlange.value.auftraege).toEqual([{ rezept: 'rezept_faserseil', anzahl: 2, fortschritt: 0, station: null }]);
    state.progress = 0.5;
    frame();
    frame();
    expect(schlange).toBe(3);
    state.bags.fasern = 7;
    for (let i = 0; i < VORRAT_TAKT; i++) frame();
    expect(vorrat).toBe(2);
    expect(q.vorrat.value.imBeutel('fasern')).toBe(7);
    state.visible = ['rezept_faserseil', 'rezept_fackel'];
    frame();
    expect(stand).toBe(2);
    expect([...q.stand.value.sichtbar]).toEqual(['rezept_faserseil', 'rezept_fackel']);
    for (const s of [stop, s1, s2, s3]) s();
  });

  it('Nadeln: anheften schickt craft.pin, die Liste kommt mit der Abtastung und wird nur bei Änderung veröffentlicht', () => {
    const { werkstatt, state } = fakeWerkstatt();
    const listeners: Array<() => void> = [];
    const pins: Array<[string, boolean]> = [];
    const q = createWerkstattQuelle(
      werkstatt,
      (l) => {
        listeners.push(l);
        return () => undefined;
      },
      { pin: (recipe, on) => pins.push([recipe, on]) },
    );
    q.bedarf([], []);
    let n = 0;
    const stop = effect(() => {
      void q.angeheftet.value;
      n++;
    });
    const frame = () => {
      for (const l of listeners) l();
    };
    frame();
    q.anheften('rezept_faserseil', true);
    expect(pins).toEqual([['rezept_faserseil', true]]);
    expect(q.angeheftet.value).toEqual([]);
    state.pins = ['rezept_faserseil'];
    frame();
    frame();
    expect(q.angeheftet.value).toEqual(['rezept_faserseil']);
    expect(n).toBe(2);
    q.anheften('rezept_faserseil', false);
    expect(pins).toEqual([
      ['rezept_faserseil', true],
      ['rezept_faserseil', false],
    ]);
    stop();
  });

  it('Wasser: nur gefragt, solange ein Bedarf es will; ohne Frage ist kein Wasser da', () => {
    const { werkstatt, state } = fakeWerkstatt();
    const listeners: Array<() => void> = [];
    const q = createWerkstattQuelle(
      werkstatt,
      (l) => {
        listeners.push(l);
        return () => listeners.splice(listeners.indexOf(l), 1);
      },
      { pin: () => undefined },
    );
    const frame = () => {
      for (const l of [...listeners]) l();
    };
    const trocken = q.bedarf(['fasern'], []);
    for (let i = 0; i < VORRAT_TAKT; i++) frame();
    expect(state.waterAsked).toBe(0);
    expect(q.vorrat.value.amWasser).toBe(false);
    const nass = q.bedarf([], [], true);
    expect(state.waterAsked).toBe(1);
    expect(q.vorrat.value.amWasser).toBe(true);
    state.water = false;
    for (let i = 0; i < VORRAT_TAKT; i++) frame();
    expect(state.waterAsked).toBe(2);
    expect(q.vorrat.value.amWasser).toBe(false);
    state.water = true;
    nass();
    for (let i = 0; i < VORRAT_TAKT; i++) frame();
    expect(state.waterAsked).toBe(2);
    expect(q.vorrat.value.amWasser).toBe(false);
    trocken();
  });
});

describe('Befehle der Brücke', () => {
  it('reiht für Handwerk, Stationen und Kisten je einen gültigen Befehl ein', () => {
    const sent: unknown[] = [];
    const session: UiBridgeSession = {
      sampleStatus: (out: SessionStatus) => out,
      onEvent: () => () => undefined,
      command: (raw: unknown) => {
        sent.push(raw);
        return parseGameCommand(raw);
      },
    };
    const bridge = createUiBridge(session);
    expect(bridge.werkstatt).toBeNull();
    const a = bridge.actions;
    a.crafting.start('rezept_faserseil', 3);
    a.crafting.cancel(0);
    a.crafting.useChests(false);
    a.crafting.pin('rezept_faserseil', true);
    a.stations.put(1, { bereich: 'inventar', index: 2 }, 'brennstoff');
    a.stations.put(1, { bereich: 'inventar', index: 2 }, 'eingang', 5);
    a.stations.take(1, 'ausgang', 0);
    a.stations.take(1, 'eingang', 1, 2);
    a.stations.takeAll(1);
    a.storage.open(2);
    a.storage.put(2, { bereich: 'schnellleiste', index: 0 }, 3);
    a.storage.take(2, 4);
    a.storage.takeAll(2);
    a.storage.storeAll(2);
    a.storage.sort(2);
    a.storage.rename(2, 'Erze');
    a.storage.label(2, 'kupfererz');
    a.storage.label(2, null);
    a.storage.quickStash();
    a.storage.close(2);
    expect(sent.map((c) => (c as { type: string }).type)).toEqual([
      'craft.start',
      'craft.cancel',
      'craft.useChests',
      'craft.pin',
      'station.put',
      'station.put',
      'station.take',
      'station.take',
      'station.takeAll',
      'storage.open',
      'storage.put',
      'storage.take',
      'storage.takeAll',
      'storage.storeAll',
      'storage.sort',
      'storage.rename',
      'storage.label',
      'storage.label',
      'storage.quickStash',
      'storage.close',
    ]);
    expect(sent[0]).toEqual({ type: 'craft.start', recipe: 'rezept_faserseil', count: 3 });
    expect(sent[3]).toEqual({ type: 'craft.pin', recipe: 'rezept_faserseil', on: true });
    expect(sent[5]).toEqual({ type: 'station.put', station: 1, from: { bereich: 'inventar', index: 2 }, bereich: 'eingang', count: 5 });
    bridge.dispose();
  });
});
