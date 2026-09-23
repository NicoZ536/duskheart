/**
 * M0-12 Bench-Gerüst: Schwellwertdatei (Budget × Marge mit Begründung), Bewertung, JSON-Bericht.
 * Eine künstliche Schwellwertverletzung lässt den Lauf scheitern; den echten CLI-Lauf mit zu engen
 * Grenzen prüft tests/integration/bench.test.ts.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation, type HeapCallFrame, type HeapProfileNode } from '../../../tools/bench/heap';
import { FRAME_PATH_BENCH, framePathMetric, RENDER_SCENARIOS } from '../../../tools/bench/render';
import { SIM_SCENARIOS } from '../../../tools/bench/sim';
import { THRESHOLDS_FILE, evaluate, formatRow, loadThresholds, parseThresholds, thresholdKey, type Measurement } from '../../../tools/bench/thresholds';

const PROJECT = fileURLToPath(new URL(`../../../${THRESHOLDS_FILE}`, import.meta.url));

const file = (schwellwerte: Record<string, unknown>) => ({ beschreibung: 'Test', schwellwerte });
const limit = (budget: number, marge = 1, einheit = 'ms') => ({ budget, marge, einheit, grund: 'Test' });
const m = (scenario: string, metric: string, value: number, unit = 'ms'): Measurement => ({ scenario, metric, value, unit });

describe('Schwellwertdatei', () => {
  it('die Projektdatei ist gültig und nennt nur bekannte Szenarien, jede Marge ≥ 1 ist begründet', () => {
    const thresholds = loadThresholds(PROJECT);
    const known = new Set([...SIM_SCENARIOS.map((s) => s.name), ...RENDER_SCENARIOS.map((s) => s.name), FRAME_PATH_BENCH.name]);
    const scenarios = new Set([...thresholds.keys()].map((k) => k.slice(0, k.indexOf(' · '))));
    expect([...scenarios].sort()).toEqual([...known].sort());
    for (const [key, t] of thresholds) {
      expect(t.marge, key).toBeGreaterThanOrEqual(1);
      expect(t.grund.length, key).toBeGreaterThan(10);
    }
    expect(thresholds.get(thresholdKey('sim:ecs-100k-iteration', 'iteration median'))).toMatchObject({ budget: 2, marge: 1 });
    // M1-12: jede Szene des Frame-Pfads hat ihr Allokationsbudget.
    for (const scene of FRAME_PATH_BENCH.scenes) expect(thresholds.has(thresholdKey(FRAME_PATH_BENCH.name, framePathMetric(scene))), scene).toBe(true);
  });

  it('lehnt fehlerhafte Dateien ab', () => {
    expect(() => parseThresholds(file({ 'a · b': limit(1) }))).not.toThrow();
    expect(() => parseThresholds(file({ 'ohne-trenner': limit(1) }))).toThrow(/Schwellwerte ungültig/);
    expect(() => parseThresholds(file({ 'a · b': { ...limit(1), grund: '' } }))).toThrow(/grund/);
    expect(() => parseThresholds(file({ 'a · b': { ...limit(1), marge: 0 } }))).toThrow(/marge/);
    expect(() => parseThresholds({ schwellwerte: {} })).toThrow(/beschreibung/);
  });
});

describe('Bewertung', () => {
  const thresholds = parseThresholds(file({ 'sim:x · tick p95': limit(3, 1.5), 'sim:x · heap': limit(10, 1, 'MB'), 'render:y · draws': limit(150, 1, '') }));

  it('ist grün, wenn jeder Messwert unter Budget × Marge liegt', () => {
    const report = evaluate([m('sim:x', 'tick p95', 4.4), m('sim:x', 'heap', 10, 'MB')], thresholds, new Set(['sim:x']));
    expect(report.errors).toEqual([]);
    expect(report.rows.map((r) => r.limit)).toEqual([4.5, 10]);
    expect(report.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('eine künstliche Schwellwertverletzung lässt den Lauf scheitern', () => {
    const report = evaluate([m('sim:x', 'tick p95', 4.6), m('sim:x', 'heap', 1, 'MB')], thresholds, new Set(['sim:x']));
    expect(report.ok).toBe(false);
    expect(report.rows.filter((r) => !r.ok).map((r) => r.metric)).toEqual(['tick p95']);
    expect(formatRow(report.rows[0] as (typeof report.rows)[number])).toMatch(/^FAIL sim:x/);
  });

  it('NaN oder ∞ als Messwert ist eine Verletzung', () => {
    expect(evaluate([m('sim:x', 'tick p95', Number.NaN), m('sim:x', 'heap', 1, 'MB')], thresholds, new Set(['sim:x'])).ok).toBe(false);
  });

  it('Messwert ohne Schwellwert, Schwellwert ohne Messwert und falsche Einheit sind Fehler', () => {
    const report = evaluate([m('sim:x', 'tick p95', 1, 's'), m('sim:x', 'neu', 1)], thresholds, new Set(['sim:x']));
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual([
      'Einheit von sim:x · tick p95: gemessen s, Schwellwert ms',
      'Kein Schwellwert für sim:x · neu in der Schwellwertdatei',
      'Schwellwert ohne Messwert: sim:x · heap',
    ]);
  });

  it('nicht gelaufene Szenarien (--nur sim) verlangen keine Messwerte', () => {
    const report = evaluate([m('sim:x', 'tick p95', 1), m('sim:x', 'heap', 1, 'MB')], thresholds, new Set(['sim:x']));
    expect(report.ok).toBe(true);
  });
});

describe('Allokationsprofil des Render-Pfads', () => {
  const node = (id: number, functionName: string, children: HeapProfileNode[] = [], url = ''): HeapProfileNode => ({ id, callFrame: { url, functionName, lineNumber: id }, children });
  // (root) → measure → frame → render → pack; measure → memoryUsage; (root) → (GC)
  const pack = node(5, 'pack', [], 'http://127.0.0.1/src/render/light/lightBatch.ts?t=1');
  const render = node(4, 'render', [pack]);
  const frame = node(3, 'framePathFrame', [render]);
  const measure = node(2, 'measure', [frame, node(6, 'memoryUsage')]);
  const head = node(1, '(root)', [measure, node(7, '(GC)')]);
  const inPath = (f: HeapCallFrame): boolean => f.functionName === 'framePathFrame';

  it('ordnet Stichproben unter dem Treiber des Pfads zu und nennt den innersten Frame', () => {
    const r = pathAllocation(
      {
        head,
        samples: [
          { nodeId: 5, size: 32 },
          { nodeId: 5, size: 16 },
          { nodeId: 4, size: 8 },
          { nodeId: 6, size: 100 },
          { nodeId: 7, size: 64 },
        ],
      },
      inPath,
    );
    expect(r.total).toBe(220);
    expect(r.inPath).toBe(56);
    expect(r.top).toEqual([
      { frame: 'pack src/render/light/lightBatch.ts:6', bytes: 48 },
      { frame: 'render:5', bytes: 8 },
    ]);
  });

  it('liest das Protokollformat und lehnt Profile ohne Stichproben ab', () => {
    const raw = { head: { id: 1, callFrame: { functionName: 'f', url: 'u', lineNumber: 2, scriptId: '7' }, selfSize: 0, children: [] }, samples: [{ size: 16, nodeId: 1, ordinal: 1 }] };
    expect(heapProfileOf(raw)).toEqual({ head: { id: 1, callFrame: { functionName: 'f', url: 'u', lineNumber: 2 }, children: [] }, samples: [{ size: 16, nodeId: 1 }] });
    expect(() => heapProfileOf({ head: raw.head })).toThrow(/Stichproben/);
    expect(() => heapProfileOf({ head: { callFrame: {} }, samples: [] })).toThrow(/Knoten/);
  });

  it('ohne Stichproben im Pfad ist die Allokation 0', () => {
    expect(pathAllocation({ head, samples: [{ nodeId: 6, size: 40 }] }, inPath)).toEqual({ total: 40, inPath: 0, top: [] });
  });
});
