/**
 * M4-09: the reading sample behind the repair tab of the station screen on a real session (src/game/samples/reparatur.ts
 * through `GameSession.sampleRepair`, and the tab's signal `createReparaturQuelle`) – a workbench set up on the start
 * beach, a worn stone axe and a worn bronze axe in the hotbar: the stone axe is mended here (Werkbank I, tier 0) with the
 * very quote `RepairSystem.quote` gives (station, costs), each material with what is at hand; the bronze axe needs
 * another station (no station in reach mends tier 1); nothing counts as changed while nothing changes; a twig given
 * shows up at hand; `repair.item` mends the axe and it leaves the list. The worn pieces are made by replacing the stack
 * in the bags (the test reads and writes the simulation; the UI never does, ADR-0010).
 */
import { describe, expect, it } from 'vitest';
import { withSlot } from '../../../src/game/inventory/bags';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../../src/game/items/slots';
import type { RepairSystem } from '../../../src/game/repair/system';
import { createRepairSample, REPAIR_AREAS } from '../../../src/game/samples/reparatur';
import { BOOT_SESSION_SEED, GameSession } from '../../../src/game/session';
import { TILE_PX } from '../../../src/world/model/coords';
import { createReparaturQuelle } from '../../../src/ui/screens/station/reparaturQuelle';
import { VORRAT_TAKT } from '../../../src/ui/screens/handwerk/quelle';

const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, -2],
  [-2, -2],
  [1, 1],
  [-2, 1],
  [2, -1],
  [-3, -1],
  [0, 2],
  [0, -3],
];

const STEINAXT: SlotRef = { bereich: 'schnellleiste', index: 0 };
const BRONZEAXT: SlotRef = { bereich: 'schnellleiste', index: 1 };

function inventar(s: GameSession): InventorySystem {
  return s.sim.system('inventory') as unknown as InventorySystem;
}

/** Sets the durability of the piece in `slot`. */
function abnutzen(s: GameSession, slot: SlotRef, haltbarkeit: number): void {
  const inv = inventar(s);
  const stack = inv.state[slot.bereich][slot.index];
  if (stack === null || stack === undefined) throw new Error(`nothing in ${slot.bereich}:${slot.index}`);
  inv.bags.replace(withSlot(inv.state, slot, { ...stack, haltbarkeit }));
}

/** A player on the start beach with a workbench beside them and two worn axes in the hotbar; returns the station id. */
function werkbankMitAexten(): { s: GameSession; id: number } {
  const s = new GameSession({ config: { seed: BOOT_SESSION_SEED } });
  s.command({ type: 'player.spawn' });
  s.step();
  for (const [item, count] of [
    ['werkbank', 1],
    ['steinaxt', 1],
    ['bronzeaxt', 1],
    ['stein', 4],
  ] as const) {
    s.command({ type: 'inventory.give', item, count });
  }
  s.step();
  const at = s.debugState().player;
  if (at === null) throw new Error('no player');
  for (const [dx, dy] of OFFSETS) {
    const before = s.debugState().events.stationPlaced;
    s.command({ type: 'station.place', from: { bereich: 'inventar', index: 0 }, tx: Math.floor(at.x / TILE_PX) + dx, ty: Math.floor(at.y / TILE_PX) + dy });
    s.step();
    const after = s.debugState().events.stationPlaced;
    if (after > before) {
      expect(inventar(s).state.schnellleiste[0]?.item).toBe('steinaxt');
      expect(inventar(s).state.schnellleiste[1]?.item).toBe('bronzeaxt');
      abnutzen(s, STEINAXT, 30);
      abnutzen(s, BRONZEAXT, 100);
      return { s, id: after };
    }
  }
  throw new Error('no spot for the workbench');
}

describe('Abtastung der Reparatur', () => {
  it('sucht jede Taschenfläche ab', () => {
    expect([...REPAIR_AREAS].sort()).toEqual([...BAG_AREAS].sort());
  });

  it('listet die abgenutzten Stücke mit dem Angebot der Reparatur, genau wie RepairSystem.quote', () => {
    const { s, id } = werkbankMitAexten();
    const out = createRepairSample();
    expect(s.sampleRepair(id, out)).toBe(true);
    expect(out).toMatchObject({ vorhanden: true, station: 'werkbank', anzahl: 2 });
    const [stein, bronze] = out.stuecke;
    expect(stein).toMatchObject({ bereich: 'schnellleiste', index: 0, voll: 60, hier: true, station: 'werkbank', grund: null });
    expect(stein?.stack.item).toBe('steinaxt');
    expect(stein?.stack.haltbarkeit).toBe(30);
    // The same quote as the simulation's: half worn, half of that in ingredients (rounded), each with what is at hand.
    const quote = (s.sim.system('repair') as unknown as RepairSystem).quote(s.sim, STEINAXT);
    if (typeof quote === 'string') throw new Error(`no quote: ${quote}`);
    expect(stein?.kosten.slice(0, stein.kostenAnzahl).map((k) => ({ key: k.key, anzahl: k.anzahl }))).toEqual(quote.costs.map((c) => ({ key: c.key, anzahl: c.anzahl })));
    const zweig = stein?.kosten.find((k) => k.key === 'zweig');
    const steinKosten = stein?.kosten.find((k) => k.key === 'stein');
    expect(zweig).toMatchObject({ anzahl: 1, vorhanden: 0 });
    expect(steinKosten).toMatchObject({ anzahl: 1, vorhanden: 4 });
    // Werkbank I mends tier 0 only; no station in reach mends the bronze axe.
    expect(bronze).toMatchObject({ bereich: 'schnellleiste', index: 1, voll: 150, hier: false, station: null, grund: 'noStation', kostenAnzahl: 0 });
    expect(bronze?.stack.item).toBe('bronzeaxt');
  });

  it('zählt nur Änderungen, sieht neues Material und verliert das reparierte Stück', () => {
    const { s, id } = werkbankMitAexten();
    const out = createRepairSample();
    s.sampleRepair(id, out);
    const stand = out.stand;
    s.step();
    s.sampleRepair(id, out);
    expect(out.stand).toBe(stand);
    s.command({ type: 'inventory.give', item: 'zweig', count: 2 });
    s.step();
    s.sampleRepair(id, out);
    expect(out.stand).toBe(stand + 1);
    expect(out.stuecke[0]?.kosten.find((k) => k.key === 'zweig')?.vorhanden).toBe(2);
    const repaired = s.debugState().events.itemRepaired;
    s.command({ type: 'repair.item', slot: STEINAXT });
    s.step();
    expect(s.debugState().events.itemRepaired).toBe(repaired + 1);
    expect(inventar(s).state.schnellleiste[0]?.haltbarkeit).toBe(60);
    s.sampleRepair(id, out);
    expect(out.anzahl).toBe(1);
    expect(out.stuecke[0]?.stack.item).toBe('bronzeaxt');
    expect(out.stand).toBe(stand + 2);
  });

  it('meldet eine Station, die es nicht gibt, als nicht vorhanden', () => {
    const { s, id } = werkbankMitAexten();
    const out = createRepairSample();
    s.sampleRepair(id, out);
    const stand = out.stand;
    expect(s.sampleRepair(id + 100, out)).toBe(false);
    expect(out).toMatchObject({ vorhanden: false, anzahl: 0 });
    expect(out.stand).toBe(stand + 1);
  });
});

describe('Signal des Reiters „Reparieren“', () => {
  it('tastet jeden VORRAT_TAKT-ten Frame ab und veröffentlicht nur Änderungen', () => {
    const { s, id } = werkbankMitAexten();
    const listeners: Array<() => void> = [];
    const frame = (): void => {
      for (const l of listeners) l();
    };
    const quelle = createReparaturQuelle({ sampleRepair: (i, out) => s.sampleRepair(i, out) }, id, (l) => {
      listeners.push(l);
      return () => listeners.splice(listeners.indexOf(l), 1);
    });
    const erste = quelle.ansicht.value;
    expect(erste?.stuecke.map((p) => p.key)).toEqual(['schnellleiste:0', 'schnellleiste:1']);
    expect(erste?.stuecke[0]).toMatchObject({ slot: STEINAXT, hier: true, station: 'werkbank' });
    for (let i = 0; i < VORRAT_TAKT; i++) frame();
    expect(quelle.ansicht.value).toBe(erste);
    s.command({ type: 'inventory.give', item: 'zweig', count: 1 });
    s.step();
    for (let i = 0; i < VORRAT_TAKT - 1; i++) frame();
    expect(quelle.ansicht.value).toBe(erste);
    frame();
    expect(quelle.ansicht.value).not.toBe(erste);
    expect(quelle.ansicht.value?.stuecke[0]?.kosten.find((k) => k.key === 'zweig')?.vorhanden).toBe(1);
    quelle.stop();
    expect(listeners).toHaveLength(0);
  });
});
