/**
 * M6-16h Heap-Trend des Benchs `sim:headless-demo` mit robuster Methode: derselbe Code maß 9,99–19,6 KB/min (Budget 16),
 * weil `heapUsed` der ersten Welt vor allem den übersetzten Code wachsen sah, solange V8 heiße Funktionen übersetzte.
 * Jetzt misst das Szenario in einer zweiten Welt desselben Prozesses (die erste wärmt auf) den Daten-Heap nach voller
 * Speicherbereinigung – alter und junger Raum, große Objekte –, ohne die Räume des Codes und seiner Metadaten.
 * Geprüft wird die Methode (die Messung selbst läuft in `npm run bench`, sie braucht `node --expose-gc`):
 * - welche Heap-Räume zählen und dass `dataHeapKb` genau sie summiert;
 * - die Steigung ohne die erste Stichprobe, nie negativ;
 * - eine Welt des Szenarios liefert je Tick eine Zeit und je Stichprobe einen Heap-Wert, `onTick` sieht jeden Tick.
 */
import { getHeapSpaceStatistics } from 'node:v8';
import { describe, expect, it, vi } from 'vitest';
import { DATA_HEAP_SPACES, HEADLESS_DEMO_BENCH, HEADLESS_DEMO_OPTIONS, dataHeapKb, heapTrend, measureHeadlessDemo, runHeadlessDemoWorld, type HeadlessDemoWorld } from '../../../tools/bench/sim';

describe('Heap-Trend von sim:headless-demo (M6-16h)', () => {
  it('zählt die Räume der Spieldaten, nicht den übersetzten Code und seine Metadaten', () => {
    expect([...DATA_HEAP_SPACES].sort()).toEqual(['large_object_space', 'new_large_object_space', 'new_space', 'old_space']);
    const names = getHeapSpaceStatistics().map((s) => s.space_name);
    expect(names).toContain('old_space');
    expect(names).toContain('code_space');
    for (const code of ['code_space', 'code_large_object_space', 'trusted_space', 'trusted_large_object_space', 'read_only_space']) expect(DATA_HEAP_SPACES).not.toContain(code);
    // The sum of exactly those spaces (two readings a few allocations apart).
    const manual = getHeapSpaceStatistics()
      .filter((s) => DATA_HEAP_SPACES.includes(s.space_name))
      .reduce((n, s) => n + s.space_used_size, 0);
    const kb = dataHeapKb();
    expect(Math.abs(kb - manual / 1024)).toBeLessThan(256);
    const code = getHeapSpaceStatistics().find((s) => s.space_name === 'code_space')?.space_used_size ?? 0;
    expect(code).toBeGreaterThan(0);
    expect(kb).toBeLessThan(process.memoryUsage().heapUsed / 1024);
  });

  it('die Steigung über die Stichproben ohne die erste, nie negativ', () => {
    const world = (heapKb: number[]) => ({ tickMs: new Float64Array(0), heapKb: Float64Array.from(heapKb) });
    // The first sample (the settling) does not count, whatever it is.
    expect(heapTrend(world([900, 50, 52, 54, 56]))).toBeCloseTo(2, 12);
    expect(heapTrend(world([0, 50, 52, 54, 56]))).toBeCloseTo(2, 12);
    expect(heapTrend(world([50, 60, 58, 56, 54]))).toBe(0);
    expect(heapTrend(world([50, 60]))).toBe(0);
  });

  it('zehn Echtminuten, eine Stichprobe je Minute; eine Welt liefert Zeiten und Heap-Werte und ruft onTick je Tick', () => {
    expect(HEADLESS_DEMO_OPTIONS).toEqual({ ticks: 36_000, sampleEvery: 3_600 });
    const gc = vi.fn();
    vi.stubGlobal('gc', gc);
    const ticks: number[] = [];
    // The reader is called exactly at the samples, each time right after a full collection (the gc call count at each read).
    const gcAtRead: number[] = [];
    const tickAtRead: number[] = [];
    const w = runHeadlessDemoWorld(
      { ticks: 120, sampleEvery: 30 },
      (t) => ticks.push(t),
      () => {
        gcAtRead.push(gc.mock.calls.length);
        tickAtRead.push(ticks.length);
        return 1000 + gcAtRead.length;
      },
    );
    expect(w.tickMs).toHaveLength(120);
    expect([...w.tickMs].every((ms) => ms >= 0)).toBe(true);
    expect([...w.heapKb]).toEqual([1001, 1002, 1003, 1004]);
    expect(gcAtRead).toEqual([1, 2, 3, 4]);
    expect(tickAtRead).toEqual([30, 60, 90, 120]);
    expect(ticks).toEqual(Array.from({ length: 120 }, (_, i) => i));
    // Without a reader the bench reads the data heap (`dataHeapKb`, its spaces checked above): positive kilobytes.
    const real = runHeadlessDemoWorld({ ticks: 30, sampleEvery: 30 });
    expect(real.heapKb).toHaveLength(1);
    expect(real.heapKb[0]).toBeGreaterThan(0);
    expect(gc).toHaveBeenCalledTimes(5);
  });

  it('misst den Heap-Trend in der zweiten Welt, die Tick-Zeit in der ersten ohne ihre erste Minute', () => {
    const o = { ticks: 8, sampleEvery: 2 };
    const worlds: HeadlessDemoWorld[] = [
      // The first world: its heap grows fast while the JIT works (it must not count), its first minute is slow.
      { tickMs: Float64Array.from([9, 9, 1, 1, 1, 1, 1, 2]), heapKb: Float64Array.from([10, 100, 200, 300]) },
      // The second: flat but for 4 KB per sample.
      { tickMs: Float64Array.from([5, 5, 5, 5, 5, 5, 5, 5]), heapKb: Float64Array.from([10, 20, 24, 28]) },
    ];
    let calls = 0;
    const m = measureHeadlessDemo(o, () => worlds[calls++] as HeadlessDemoWorld);
    expect(calls).toBe(2);
    expect(m).toEqual([
      { scenario: HEADLESS_DEMO_BENCH, metric: 'tick p95', value: 2, unit: 'ms' },
      { scenario: HEADLESS_DEMO_BENCH, metric: 'Heap-Trend', value: 4, unit: 'KB/min' },
    ]);
  });
});
