/**
 * M6-16 Bench `sim:pfad-200`: das Szenario läuft auf einer kleinen Welt in Sekundenbruchteilen – genau 200 Anfragen je
 * 60 Ticks, alle werden ausgeliefert, die Wartezeit hält die Latenz, keine Allokation je Anfrage im zweiten Lauf –, und
 * die Schwellwertdatei nennt jeden seiner Messwerte mit passender Einheit.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SIZE, packChunkId } from '../../../src/world/model/coords';
import { PATH_BENCH, PATH_BENCH_RATE, pathBenchMeasurements, runPathBench, windowedP95, type PathBenchWorld } from '../../../tools/bench/pfad';
import { SIM_SCENARIOS } from '../../../tools/bench/sim';
import { THRESHOLDS_FILE, loadThresholds, thresholdKey } from '../../../tools/bench/thresholds';

const IDS = contentWorldIdTables();
const GRAS = IDS.terrain.runtimeId('gras');
const BIRKE = IDS.objects.runtimeId('baum_birke');

/** 5 × 5 chunks of meadow with a birch every 17 tiles; the zone is the middle 3 × 3. */
function smallWorld(): PathBenchWorld {
  const chunks = new Map<number, ChunkData>();
  for (let cy = 0; cy < 5; cy++) {
    for (let cx = 0; cx < 5; cx++) {
      const c = new ChunkData(0, cx, cy);
      c.ground.fill(GRAS);
      for (let i = 0; i < c.object.length; i += 17) c.object[i] = BIRKE;
      chunks.set(packChunkId(0, cx, cy), c);
    }
  }
  return { chunks, worldTiles: 5 * CHUNK_SIZE, zoneCx0: 1, zoneCy0: 1, zoneChunks: 3 };
}

describe('Bench sim:pfad-200 (M6-16)', () => {
  it('200 Anfragen je Sekunde, alle ausgeliefert, Wartezeit in der Latenz, Messwerte mit Schwellwerten', () => {
    const options = { warmupTicks: 60, windows: 2, windowTicks: 60, allocTicks: 0, seed: 3 };
    const r = runPathBench(smallWorld(), options);
    const ticks = options.warmupTicks + options.windows * options.windowTicks;
    expect(r.requested).toBe((ticks * PATH_BENCH_RATE) / BALANCE.time.tickHz);
    // Everything but the last latency's worth of requests is delivered.
    expect(r.delivered).toBeGreaterThanOrEqual(r.requested - (PATH_BENCH_RATE / BALANCE.time.tickHz) * (BALANCE.ai.pathLatencyTicks + 1));
    expect(r.found + r.partial + r.none).toBe(r.delivered);
    expect(r.found).toBeGreaterThan(r.delivered * 0.9);
    expect(r.waitP95).toBeLessThanOrEqual(BALANCE.ai.pathLatencyTicks + 1);
    expect(r.tickMs.length).toBe(ticks);
    const measured = pathBenchMeasurements(r, options);
    const thresholds = loadThresholds(fileURLToPath(new URL(`../../../${THRESHOLDS_FILE}`, import.meta.url)));
    for (const m of measured) {
      expect(m.scenario).toBe(PATH_BENCH);
      expect(thresholds.get(thresholdKey(m.scenario, m.metric))?.einheit, m.metric).toBe(m.unit);
    }
    expect(SIM_SCENARIOS.map((s) => s.name)).toContain(PATH_BENCH);
  });

  it('p95 der Messfenster: Median der Fenster, ein Ausreißerfenster entscheidet nicht', () => {
    const samples = new Float64Array([9, 9, 1, 1, 1, 1, 50, 50, 2, 2, 2, 2]);
    // Warm-up 2, three windows of four: p95 1, 50, 2 → median 2.
    expect(windowedP95(samples, 2, 3)).toBe(2);
    expect(() => windowedP95(samples, 2, 20)).toThrow(RangeError);
  });
});
