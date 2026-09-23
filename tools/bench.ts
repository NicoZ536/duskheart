/**
 * `npm run bench` (MASTERPROMPT §3.4, §30): Performance-Szenarien gegen die Budgets.
 * 1. Headless-Simulation in Node (Sim-Tick-Zeit, Heap-Trend).
 * 2. Browser (Chromium/SwiftShader): Draw-Calls, Sprite-/Lichtzahl, Render-Vorbereitung in JS.
 * GPU-Zeiten sind unter SwiftShader nicht aussagekräftig und werden im F3-Overlay geprüft (§30).
 * Überschreitung eines Schwellwerts (Budget × Sicherheitsmarge) = Exit 1.
 */
import { SIM_SCENARIOS } from './bench/sim';
import { RENDER_SCENARIOS, runRenderScenarios } from './bench/render';

interface Row {
  name: string;
  metric: string;
  value: number;
  limit: number;
  unit: string;
}

const rows: Row[] = [];
for (const s of SIM_SCENARIOS) {
  const r = s.run();
  for (const m of r) rows.push({ name: s.name, ...m });
}
rows.push(...(await runRenderScenarios(RENDER_SCENARIOS)));

let failed = 0;
for (const r of rows) {
  const ok = r.value <= r.limit;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${r.name.padEnd(28)} ${r.metric.padEnd(22)} ${r.value.toFixed(3).padStart(10)} ${r.unit.padEnd(6)} ≤ ${r.limit}`);
}
console.log(failed === 0 ? `bench: alle ${rows.length} Messwerte im Budget.` : `bench: ${failed} Überschreitung(en).`);
process.exit(failed === 0 ? 0 : 1);
