/**
 * M4-09: the reading sample behind the repair tab of the station screen on a real session (src/game/samples/reparatur.ts
 * through `GameSession.sampleRepair`, and the tab's signal `createReparaturQuelle`) – a workbench set up on the start
 * beach, a worn stone axe and a worn bronze axe in the hotbar: the stone axe is mended here (Werkbank I, tier 0) with the
 * very quote `RepairSystem.quote` gives (station, costs), each material with what is at hand; the bronze axe needs
 * another station (no station in reach mends tier 1); nothing counts as changed while nothing changes; a twig given
 * shows up at hand; `repair.item` mends the axe and it leaves the list. The worn pieces are made by replacing the stack
 * in the bags (the test reads and writes the simulation; the UI never does, ADR-0010).
 *
 * M5-40 (§30 "Keine Allokationen in Hot-Loops"): after the first sample the sampler makes no new objects – its records stay
 * the same, and sampling again allocates nothing (sampling heap profile of `node:inspector`, like the streaming and the
 * room cache tests), with the material counted in a chest in reach too. Worn pieces come from `inventory.give
 * {haltbarkeit}` (M5-38).
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
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

/** Samples measured per window. */
const SAMPLES = 20_000;
/** Mean bytes between two heap samples (small: almost every allocation is seen). */
const SAMPLING_INTERVAL = 16;
/** A single object per sample (≥ 12 B) would exceed this by far. */
const MAX_BYTES_PER_SAMPLE = 1;
/** Windows at most, with a pause for the background compiler between them (one-off code of a tier-up lands in one). */
const MAX_WINDOWS = 4;
const COMPILER_PAUSE_MS = 200;
/**
 * Every window after its forced collection first samples `SAMPLES` times unsampled, then pauses for the background compiler
 * and samples `INSTALL_SAMPLES` times more, in which V8 installs what it finished (M6-94): the collection retires
 * optimised code whose embedded maps died (V8: „weak objects“, in the shared worker also those of the files before), and
 * sampled right after it the first window held 1–16 B per sample of baseline code and recompilation (`repairRecipe`,
 * `writeCosts`, the iterators of `countAtHand`).
 */
const INSTALL_SAMPLES = 100;
/** A session, a warm-up and up to four profiled windows: more than the default 5 s on a loaded machine. */
const ALLOCATION_TIMEOUT_MS = 60_000;

/**
 * A player beside a workbench with a worn stone axe and a worn bronze axe (given worn, M5-38) and a wooden crate in reach
 * holding a twig – the material of the stone axe's repair; returns the station id.
 */
function werkbankMitKiste(): { s: GameSession; id: number } {
  const s = new GameSession({ config: { seed: BOOT_SESSION_SEED } });
  s.command({ type: 'player.spawn' });
  s.step();
  s.command({ type: 'inventory.give', item: 'werkbank', count: 1 });
  s.command({ type: 'inventory.give', item: 'steinaxt', count: 1, haltbarkeit: 30 });
  s.command({ type: 'inventory.give', item: 'bronzeaxt', count: 1, haltbarkeit: 100 });
  s.command({ type: 'inventory.give', item: 'kiste_holz', count: 1 });
  s.command({ type: 'inventory.give', item: 'zweig', count: 1 });
  s.command({ type: 'inventory.give', item: 'stein', count: 4 });
  s.step();
  const at = s.debugState().player;
  if (at === null) throw new Error('no player');
  let id = 0;
  let chest = 0;
  for (const [dx, dy] of OFFSETS) {
    const tx = Math.floor(at.x / TILE_PX) + dx;
    const ty = Math.floor(at.y / TILE_PX) + dy;
    if (id === 0) {
      s.command({ type: 'station.place', from: { bereich: 'inventar', index: 0 }, tx, ty });
      s.step();
      id = s.debugState().events.stationPlaced;
    } else if (chest === 0) {
      const slot = inventar(s).state.inventar.findIndex((x) => x?.item === 'kiste_holz');
      s.command({ type: 'build.place', part: 'kiste_holz', tx, ty });
      s.step();
      if (inventar(s).state.inventar[slot]?.item !== 'kiste_holz') chest = s.debugState().events.chestPlaced;
    }
  }
  if (id === 0 || chest === 0) throw new Error('no spot for the workbench and the crate');
  const zweig = inventar(s).state.inventar.findIndex((x) => x?.item === 'zweig');
  s.command({ type: 'storage.put', chest, from: { bereich: 'inventar', index: zweig } });
  s.step();
  expect(inventar(s).count('zweig')).toBe(0);
  return { s, id };
}

describe('Abtastung ohne neue Objekte (M5-40)', { timeout: ALLOCATION_TIMEOUT_MS }, () => {
  let session: Session;
  beforeAll(async () => {
    session = new Session();
    session.connect();
    await session.post('HeapProfiler.enable');
  });
  afterAll(() => session.disconnect());

  it('nach dem ersten Abtasten bleiben die Datensätze dieselben, und erneutes Abtasten legt nichts an – auch mit Material in einer Kiste', async () => {
    const { s, id } = werkbankMitKiste();
    const out = createRepairSample();
    expect(s.sampleRepair(id, out)).toBe(true);
    const [stein, bronze] = out.stuecke;
    expect(stein).toMatchObject({ stack: { item: 'steinaxt', haltbarkeit: 30 }, station: 'werkbank', grund: null });
    expect(bronze).toMatchObject({ stack: { item: 'bronzeaxt', haltbarkeit: 100 }, grund: 'noStation' });
    // The twig lies in the crate in reach: at hand for the repair, like `repair.item` would take it.
    expect(stein?.kosten.slice(0, stein.kostenAnzahl).map((k) => [k.key, k.anzahl, k.vorhanden])).toEqual([
      ['zweig', 1, 1],
      ['stein', 1, 4],
    ]);
    const records = [out.stuecke, stein, bronze, ...(stein?.kosten ?? [])];
    const stand = out.stand;
    for (let i = 0; i < 100; i++) s.sampleRepair(id, out);
    expect([out.stuecke, ...out.stuecke, ...(out.stuecke[0]?.kosten ?? [])]).toEqual(records);
    expect([out.stuecke, ...out.stuecke, ...(out.stuecke[0]?.kosten ?? [])].every((r, i) => r === records[i])).toBe(true);
    expect(out.stand).toBe(stand);

    // Warm-up: optimized code.
    for (let i = 0; i < SAMPLES; i++) s.sampleRepair(id, out);
    const measure = async (): Promise<{ perSample: number; top: unknown }> => {
      await session.post('HeapProfiler.collectGarbage');
      for (let i = 0; i < SAMPLES; i++) s.sampleRepair(id, out);
      await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      for (let i = 0; i < INSTALL_SAMPLES; i++) s.sampleRepair(id, out);
      await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      for (let i = 0; i < SAMPLES; i++) s.sampleRepair(id, out);
      const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
      const alloc = pathAllocation(profile, (f) => f.functionName === 'sampleRepair' && /game\/(session|samples\/reparatur)/.test(f.url));
      return { perSample: alloc.inPath / SAMPLES, top: alloc.top };
    };
    const windows = [await measure()];
    while ((windows[windows.length - 1] as { perSample: number }).perSample >= MAX_BYTES_PER_SAMPLE && windows.length < MAX_WINDOWS) {
      await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      windows.push(await measure());
    }
    const best = Math.min(...windows.map((w) => w.perSample));
    const report = windows.map((w, i) => `window ${i + 1}: ${w.perSample.toFixed(3)} B/sample ${JSON.stringify(w.top)}`).join('; ');
    expect(best, `allocations below sampleRepair – ${report}`).toBeLessThan(MAX_BYTES_PER_SAMPLE);
    expect(out.stand).toBe(stand);
  });
});
