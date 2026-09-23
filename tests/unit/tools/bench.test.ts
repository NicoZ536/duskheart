/**
 * M0-12 Bench-Gerüst: Schwellwertdatei (Budget × Marge mit Begründung), Bewertung, JSON-Bericht.
 * Eine künstliche Schwellwertverletzung lässt den Lauf scheitern; den echten CLI-Lauf mit zu engen
 * Grenzen prüft tests/integration/bench.test.ts.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RENDER_SCENARIOS } from '../../../tools/bench/render';
import { SIM_SCENARIOS } from '../../../tools/bench/sim';
import { THRESHOLDS_FILE, evaluate, formatRow, loadThresholds, parseThresholds, thresholdKey, type Measurement } from '../../../tools/bench/thresholds';

const PROJECT = fileURLToPath(new URL(`../../../${THRESHOLDS_FILE}`, import.meta.url));

const file = (schwellwerte: Record<string, unknown>) => ({ beschreibung: 'Test', schwellwerte });
const limit = (budget: number, marge = 1, einheit = 'ms') => ({ budget, marge, einheit, grund: 'Test' });
const m = (scenario: string, metric: string, value: number, unit = 'ms'): Measurement => ({ scenario, metric, value, unit });

describe('Schwellwertdatei', () => {
  it('die Projektdatei ist gültig und nennt nur bekannte Szenarien, jede Marge ≥ 1 ist begründet', () => {
    const thresholds = loadThresholds(PROJECT);
    const known = new Set([...SIM_SCENARIOS.map((s) => s.name), ...RENDER_SCENARIOS.map((s) => s.name)]);
    const scenarios = new Set([...thresholds.keys()].map((k) => k.slice(0, k.indexOf(' · '))));
    expect([...scenarios].sort()).toEqual([...known].sort());
    for (const [key, t] of thresholds) {
      expect(t.marge, key).toBeGreaterThanOrEqual(1);
      expect(t.grund.length, key).toBeGreaterThan(10);
    }
    expect(thresholds.get(thresholdKey('sim:ecs-100k-iteration', 'iteration median'))).toMatchObject({ budget: 2, marge: 1 });
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
