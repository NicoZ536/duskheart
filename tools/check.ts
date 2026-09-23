/**
 * `npm run check` (MASTERPROMPT §3.4): the fast gate. Runs the individual npm scripts one after the
 * other with inherited output, stops at the first failing step (its exit code becomes ours), prints a
 * compact timing table and fails when the whole run exceeds the "< 3 min" budget.
 *
 * CLI: `tsx tools/check.ts` (no arguments).
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** npm scripts run by `check`, in order (cheap and most often failing first). */
export const CHECK_STEPS: readonly string[] = ['assets', 'typecheck', 'lint', 'forbidden', 'validate:content', 'test:unit', 'test:integration:fast'];
/** §3.4: `check` must stay under 3 minutes of wall time. */
export const CHECK_BUDGET_MS = 180_000;
/** Exit code when every step passed but the run was too slow. */
export const EXIT_OVER_BUDGET = 1;

const MS_PER_SECOND = 1000;
/** Width of the step-name column in the timing table. */
const NAME_COLUMN = 22;
/** Width of the duration column (e.g. "123.4 s"). */
const TIME_COLUMN = 8;

export type StepStatus = 'ok' | 'failed' | 'skipped';

export interface StepResult {
  readonly name: string;
  readonly status: StepStatus;
  /** Exit code of the step; `null` when skipped. */
  readonly exitCode: number | null;
  /** Wall time in milliseconds (0 when skipped). */
  readonly ms: number;
}

export interface CheckReport {
  readonly steps: readonly StepResult[];
  readonly totalMs: number;
  readonly budgetMs: number;
  readonly overBudget: boolean;
  /** First failing step, if any. */
  readonly failedStep: string | null;
  /** 0 = green; otherwise the failing step's exit code or `EXIT_OVER_BUDGET`. */
  readonly exitCode: number;
}

export interface CheckDeps {
  /** Runs one npm script and returns its exit code. */
  run(step: string): number;
  /** Monotonic clock in milliseconds. */
  now(): number;
  readonly budgetMs?: number;
}

/** Runs `steps` sequentially; after the first failure the remaining steps are reported as skipped. */
export function runChecks(steps: readonly string[], deps: CheckDeps): CheckReport {
  const budgetMs = deps.budgetMs ?? CHECK_BUDGET_MS;
  const results: StepResult[] = [];
  const start = deps.now();
  let failed: StepResult | null = null;
  for (const name of steps) {
    if (failed) {
      results.push({ name, status: 'skipped', exitCode: null, ms: 0 });
      continue;
    }
    const t0 = deps.now();
    const exitCode = deps.run(name);
    const result: StepResult = { name, status: exitCode === 0 ? 'ok' : 'failed', exitCode, ms: deps.now() - t0 };
    results.push(result);
    if (result.status === 'failed') failed = result;
  }
  const totalMs = deps.now() - start;
  const overBudget = totalMs > budgetMs;
  const exitCode = failed ? (failed.exitCode ?? EXIT_OVER_BUDGET) : overBudget ? EXIT_OVER_BUDGET : 0;
  return { steps: results, totalMs, budgetMs, overBudget, failedStep: failed?.name ?? null, exitCode };
}

function seconds(ms: number): string {
  return `${(ms / MS_PER_SECOND).toFixed(1)} s`;
}

const STATUS_TEXT: Readonly<Record<StepStatus, string>> = { ok: 'ok', failed: 'FEHLER', skipped: 'übersprungen' };

/** Compact timing table, one line per step plus the total against the budget. */
export function formatReport(report: CheckReport): string {
  const lines = ['check – Laufzeiten'];
  for (const s of report.steps) {
    const time = s.status === 'skipped' ? '–' : seconds(s.ms);
    const code = s.status === 'failed' ? ` (Exit ${s.exitCode ?? '?'})` : '';
    lines.push(`  ${s.name.padEnd(NAME_COLUMN)}${time.padStart(TIME_COLUMN)}  ${STATUS_TEXT[s.status]}${code}`);
  }
  const verdict = report.overBudget ? 'ZU LANGSAM' : 'im Budget';
  lines.push(`  ${'gesamt'.padEnd(NAME_COLUMN)}${seconds(report.totalMs).padStart(TIME_COLUMN)}  ${verdict} (Budget ${seconds(report.budgetMs)})`);
  if (report.failedStep) lines.push(`check: rot – Schritt „${report.failedStep}“ ist fehlgeschlagen.`);
  else if (report.overBudget) lines.push(`check: rot – Laufzeit überschreitet das Budget aus §3.4 (< 3 min).`);
  else lines.push('check: grün.');
  return lines.join('\n');
}

/** Runs one npm script with inherited stdio; a signal-terminated or unstartable step counts as exit 1. */
function runNpmScript(step: string): number {
  const res = spawnSync('npm', ['run', step], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.error) console.error(`check: „npm run ${step}“ konnte nicht gestartet werden: ${res.error.message}`);
  return res.status ?? 1;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const report = runChecks(CHECK_STEPS, { run: runNpmScript, now: () => performance.now() });
  const text = formatReport(report);
  if (report.exitCode === 0) console.log(`\n${text}`);
  else console.error(`\n${text}`);
  process.exitCode = report.exitCode;
}
