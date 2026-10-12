/**
 * M7-133: `countItem` – what the trigger observers ask every tick for every `besitz` condition (`carried`, src/game/triggers)
 * – counts with index loops: a `for … of` over the bag areas and their slots left iterator objects in V8's lower tiers
 * (0,41 MB per 55 s on the route of fluessiges-laufen). The count is the sum over inventory, backpack compartment and hotbar;
 * a call allocates nothing once optimised.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { emptyBags, withSlot, type BagsState } from '../../../src/game/inventory/bags';
import { countItem } from '../../../src/game/inventory/ops';
import { CARRY_AREAS, equipmentRef, type SlotRef } from '../../../src/game/items/slots';
import { newStack } from '../../../src/game/items/stack';
import { testCatalog } from './items-fixtures';

const SAMPLING_INTERVAL = 16;
const COMPILER_PAUSE_MS = 200;
const MAX_WINDOWS = 4;
const CALLS = 20_000;

let session: Session;
beforeAll(async () => {
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
});
afterAll(() => session.disconnect());

describe('countItem mit Indexschleifen (M7-133)', () => {
  const catalog = testCatalog();
  const put = (state: BagsState, ref: SlotRef, item: string, count: number): BagsState => withSlot(state, ref, newStack(catalog.get(item), count));
  let bags = emptyBags();
  bags = put(bags, { bereich: 'inventar', index: 0 }, 'stein', 40);
  bags = put(bags, { bereich: 'inventar', index: 7 }, 'holz', 12);
  bags = put(bags, { bereich: 'inventar', index: 29 }, 'stein', 25);
  bags = put(bags, { bereich: 'schnellleiste', index: 3 }, 'stein', 5);
  bags = put(bags, { bereich: 'schnellleiste', index: 9 }, 'holz', 1);
  bags = put(bags, { bereich: 'guertel', index: 0 }, 'stein', 9);
  bags = put(bags, equipmentRef('brust'), 'stein', 3);

  it('sums the carried areas (inventory, backpack compartment, hotbar), not belt or equipment', () => {
    expect([...CARRY_AREAS]).toEqual(['inventar', 'rucksackfach', 'schnellleiste']);
    expect(countItem(bags, 'stein')).toBe(40 + 25 + 5);
    expect(countItem(bags, 'holz')).toBe(12 + 1);
    expect(countItem(bags, 'fasern')).toBe(0);
  });

  it('a count allocates nothing once optimised', async () => {
    let sum = 0;
    function zaehlen(): void {
      for (let i = 0; i < CALLS; i++) sum += countItem(bags, i & 1 ? 'stein' : 'holz');
    }
    zaehlen();
    zaehlen();
    const windows: Array<{ per: number; top: unknown }> = [];
    do {
      if (windows.length > 0) await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      await session.post('HeapProfiler.collectGarbage');
      await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as never);
      sum = 0;
      zaehlen();
      const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
      const alloc = pathAllocation(profile, (f) => f.functionName === 'zaehlen' && /inventar-zaehlen/.test(f.url));
      windows.push({ per: alloc.inPath / CALLS, top: alloc.top });
      expect(sum).toBe((CALLS / 2) * 70 + (CALLS / 2) * 13);
    } while ((windows[windows.length - 1] as { per: number }).per >= 1 && windows.length < MAX_WINDOWS);
    const best = Math.min(...windows.map((w) => w.per));
    // An iterator per area and per slot array would be ≥ 4 × 32 B a call.
    expect(best, windows.map((w, i) => `window ${i + 1}: ${w.per.toFixed(2)} B/call ${JSON.stringify(w.top)}`).join('; ')).toBeLessThan(1);
  });
});
