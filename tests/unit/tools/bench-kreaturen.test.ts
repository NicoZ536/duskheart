/**
 * M6-16d Bench `sim:kreaturen-50`: das Szenario steht in der Liste der Sim-Szenarien und hat seinen Schwellwert (1 B je
 * Kreatur und Tick); seine Welt baut sich mit den 50 Kreaturen auf (kein Befehl abgelehnt). Gemessen wird nur in
 * `npm run bench` (die Allokationsmessung braucht `node --expose-gc`) – hier läuft eine Runde ohne Aufwärmwelt und ohne Fenster.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CREATURE_BENCH, CREATURE_BENCH_OPTIONS, creatureBenchMeasurements, runCreatureBench } from '../../../tools/bench/kreaturen';
import { SIM_SCENARIOS } from '../../../tools/bench/sim';
import { THRESHOLDS_FILE, loadThresholds, thresholdKey } from '../../../tools/bench/thresholds';

describe('Bench sim:kreaturen-50 (M6-16d)', () => {
  it('ist ein Sim-Szenario mit dem Budget der Akzeptanz: höchstens 1 B je Kreatur und Tick', () => {
    expect(SIM_SCENARIOS.map((s) => s.name)).toContain(CREATURE_BENCH);
    const thresholds = loadThresholds(fileURLToPath(new URL(`../../../${THRESHOLDS_FILE}`, import.meta.url)));
    expect(thresholds.get(thresholdKey(CREATURE_BENCH, 'Allokation je Kreatur'))).toMatchObject({ budget: 1, marge: 1, einheit: 'B' });
    // Steady state: two rounds, the warm-up world with four times the creatures, three windows.
    expect(CREATURE_BENCH_OPTIONS).toMatchObject({ rounds: 2, warmupScale: 4, windows: 3 });
  });

  it('die Messwelt baut sich auf und läuft; ohne Fenster misst sie nichts', () => {
    const r = runCreatureBench({ ...CREATURE_BENCH_OPTIONS, rounds: 1, warmupScale: 0, settleTicks: 60, windows: 0 });
    expect(r.perCreature).toEqual([]);
    expect(creatureBenchMeasurements(r)).toEqual([{ scenario: CREATURE_BENCH, metric: 'Allokation je Kreatur', value: 0, unit: 'B' }]);
    expect(() => runCreatureBench({ ...CREATURE_BENCH_OPTIONS, rounds: 0 })).toThrow(RangeError);
  });
});
