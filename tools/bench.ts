/**
 * `npm run bench` (MASTERPROMPT §3.4, §30): Performance-Szenarien gegen die Budgets.
 * 1. Headless-Simulation in Node (Tick-Zeit, ECS-Iteration, Allokation, Heap-Trend).
 * 2. Browser (Chromium/SwiftShader): Draw-Calls, Render-Vorbereitung in JS, Heap, Konsolenfehler.
 * GPU-Zeiten sind unter SwiftShader nicht aussagekräftig und werden im F3-Overlay geprüft (§30).
 *
 * Grenzwerte: `tools/bench/schwellwerte.json` (Budget × Marge je Messwert, mit Begründung).
 * Bericht: JSON nach `tools/out/bench/bericht.json`. Überschreitung oder fehlender Schwellwert = Exit 1.
 *
 * CLI: `npm run bench -- [--schwellwerte <datei>] [--bericht <datei>] [--nur sim|render]`
 * (eine Datei mit absichtlich zu engen Grenzen belegt, dass der Lauf dann scheitert).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { RENDER_SCENARIOS, runRenderScenarios } from './bench/render';
import { SIM_SCENARIOS } from './bench/sim';
import { REPORT_FILE, THRESHOLDS_FILE, evaluate, formatRow, loadThresholds, type Measurement } from './bench/thresholds';

type Part = 'sim' | 'render';

interface BenchArgs {
  readonly thresholds: string;
  readonly report: string;
  readonly parts: ReadonlySet<Part>;
}

function parseArgs(argv: readonly string[]): BenchArgs {
  let thresholds = THRESHOLDS_FILE;
  let report = REPORT_FILE;
  let parts: Set<Part> = new Set(['sim', 'render']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--') continue;
    if ((arg === '--schwellwerte' || arg === '--bericht' || arg === '--nur') && value === undefined) throw new Error(`${arg} erwartet einen Wert`);
    if (arg === '--schwellwerte') thresholds = value as string;
    else if (arg === '--bericht') report = value as string;
    else if (arg === '--nur') {
      if (value !== 'sim' && value !== 'render') throw new Error(`--nur erwartet sim oder render, nicht „${String(value)}“`);
      parts = new Set([value]);
    } else throw new Error(`Unbekanntes Argument: ${String(arg)}`);
    i++;
  }
  return { thresholds: resolve(thresholds), report: resolve(report), parts };
}

let args: BenchArgs;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`bench: ${(err as Error).message}`);
  process.exit(2);
}

const thresholds = loadThresholds(args.thresholds);
const measurements: Measurement[] = [];
const ran = new Set<string>();
if (args.parts.has('sim')) {
  for (const s of SIM_SCENARIOS) {
    measurements.push(...s.run());
    ran.add(s.name);
  }
}
if (args.parts.has('render')) {
  measurements.push(...(await runRenderScenarios(RENDER_SCENARIOS)));
  for (const s of RENDER_SCENARIOS) ran.add(s.name);
}

const report = evaluate(measurements, thresholds, ran);
for (const r of report.rows) console.log(formatRow(r));
for (const e of report.errors) console.error(`FEHLER ${e}`);
mkdirSync(dirname(args.report), { recursive: true });
writeFileSync(args.report, `${JSON.stringify({ ...report, schwellwerte: args.thresholds }, null, 2)}\n`);
const failed = report.rows.filter((r) => !r.ok).length + report.errors.length;
console.log(failed === 0 ? `bench: alle ${report.rows.length} Messwerte im Budget (Bericht: ${args.report}).` : `bench: ${failed} Überschreitung(en)/Fehler (Bericht: ${args.report}).`);
process.exit(failed === 0 ? 0 : 1);
