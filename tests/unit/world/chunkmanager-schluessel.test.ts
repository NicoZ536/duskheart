/**
 * M6-16b `ChunkManager.get` ohne HeapNumber-Schlüssel (§30 „Keine Allokationen in Hot-Loops“): die gepackte Chunk-Id
 * (`packChunkId`) der Höhlenebenen liegt ab 2^30 und ist damit keine kleine Ganzzahl (im Browser 31 Bit; in Node mit 32 Bit
 * die beiden tiefsten Ebenen) – jede Abfrage über sie legte eine Zahl auf dem Heap an (16 B; Kollision, Pfade, Licht,
 * Kreaturen und Temperatur fragen Chunks je Kachel ab).
 * Der Manager führt die residenten Chunks deshalb zusätzlich je Ebene unter einem Ortsschlüssel unter 2^30.
 *
 * Geprüft wird: `get` liefert auf jeder Ebene genau, was `getById(packChunkId(…))` liefert – nach `ensure`, nach dem
 * Entladen (`trim`) und nach dem Wiederladen –, wirft für nicht packbare Koordinaten wie zuvor, und eine Abfrage legt auf
 * keiner Ebene etwas an (Stichproben-Heap-Profil von `node:inspector`, wie `stream.alloc.test.ts`).
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { CHUNK_COORD_MAX, LAYERS, packChunkId, type Layer } from '../../../src/world/model/coords';
import type { ChunkManager } from '../../../src/world/stream/chunkManager';
import { fixtureManager, type FixturePlan } from './streamFixture';

/** Chunks je Ebene im Test: ein 4×4-Feld mitten in der Welt (Klein: 32² Chunks). */
const FIELD = { x0: 8, y0: 8, size: 4 } as const;
/** Mittlerer Abstand zweier Heap-Stichproben [B] (klein: fast jede Allokation wird gesehen). */
const SAMPLING_INTERVAL = 16;
/** Abfragen je Messung; eine Allokation je Abfrage (16 B) überträfe die Grenze um das Sechzehnfache. */
const LOOKUPS = 200_000;
/** Grenze [B je Abfrage]. */
const MAX_BYTES_PER_LOOKUP = 1;

function residentField(manager: ChunkManager<FixturePlan>): void {
  for (const layer of LAYERS) {
    for (let y = FIELD.y0; y < FIELD.y0 + FIELD.size; y++) for (let x = FIELD.x0; x < FIELD.x0 + FIELD.size; x++) manager.ensure(layer, x, y);
  }
}

/** Ob `get` auf jeder Ebene im Feld und rundherum dasselbe liefert wie die Abfrage über die gepackte Id. */
function agrees(manager: ChunkManager<FixturePlan>): number {
  let resident = 0;
  for (const layer of LAYERS) {
    for (let y = FIELD.y0 - 1; y <= FIELD.y0 + FIELD.size; y++) {
      for (let x = FIELD.x0 - 1; x <= FIELD.x0 + FIELD.size; x++) {
        const chunk = manager.get(layer, x, y);
        expect(chunk, `${layer}:${x}:${y}`).toBe(manager.getById(packChunkId(layer, x, y)));
        if (chunk !== undefined) {
          expect([chunk.layer, chunk.cx, chunk.cy]).toEqual([layer, x, y]);
          resident++;
        }
      }
    }
  }
  return resident;
}

let session: Session;
beforeAll(async () => {
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
});
afterAll(() => session.disconnect());

describe('ChunkManager.get ohne HeapNumber-Schlüssel (M6-16b)', () => {
  it('liefert auf jeder Ebene dasselbe wie die gepackte Id – geladen, entladen, wieder geladen', () => {
    const { manager } = fixtureManager();
    expect(agrees(manager)).toBe(0);
    residentField(manager);
    expect(agrees(manager)).toBe(LAYERS.length * FIELD.size * FIELD.size);
    // Ohne Kamera entlädt `trim` jeden nicht gepinnten Chunk.
    expect(manager.trim()).toBe(LAYERS.length * FIELD.size * FIELD.size);
    expect(agrees(manager)).toBe(0);
    residentField(manager);
    expect(agrees(manager)).toBe(LAYERS.length * FIELD.size * FIELD.size);
    expect(manager.ensure(-3, FIELD.x0, FIELD.y0)).toBe(manager.get(-3, FIELD.x0, FIELD.y0));
  });

  it('wirft für Koordinaten, die keine Id fassen kann, wie zuvor', () => {
    const { manager } = fixtureManager();
    expect(() => manager.get(0, CHUNK_COORD_MAX + 1, 0)).toThrow(RangeError);
    expect(() => manager.get(-2, 0, 0.5)).toThrow(RangeError);
    expect(manager.get(-2, CHUNK_COORD_MAX, CHUNK_COORD_MAX)).toBeUndefined();
  });

  it('legt je Abfrage auf keiner Ebene etwas an', async () => {
    const { manager } = fixtureManager();
    residentField(manager);
    // Die Ebene wechselt je Abfrage: die tiefste (Id über 2^31) ist in jedem Viertel dabei.
    const lookups = (n: number): number => {
      let hits = 0;
      for (let i = 0; i < n; i++) {
        const layer = LAYERS[i & 3] as Layer;
        if (manager.get(layer, FIELD.x0 + ((i >> 2) & 3), FIELD.y0 + ((i >> 4) & 3)) !== undefined) hits++;
      }
      return hits;
    };
    expect(lookups(LOOKUPS)).toBe(LOOKUPS); // Aufwärmen: optimierter Code
    await session.post('HeapProfiler.collectGarbage');
    await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    const hits = lookups(LOOKUPS);
    const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
    expect(hits).toBe(LOOKUPS);
    const alloc = pathAllocation(profile, (f) => f.functionName === 'lookups' && /chunkmanager-schluessel\.test/.test(f.url));
    expect(alloc.inPath / LOOKUPS, `Allokation unter den Abfragen: ${JSON.stringify(alloc.top)}`).toBeLessThan(MAX_BYTES_PER_LOOKUP);
  });
});
