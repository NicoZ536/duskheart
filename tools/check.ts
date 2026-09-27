/**
 * `npm run check` (MASTERPROMPT §3.4): the fast gate. Runs the individual npm scripts stage by stage,
 * stops after the first stage with a failing step (the first failing step's exit code becomes ours),
 * prints a compact timing table and fails when the whole run exceeds the "< 3 min" budget.
 *
 * A stage is one npm script or a group of independent ones that run side by side (M4-37, ADR-0036): the
 * static checks – typecheck, lint, forbidden-list, content validator – are single-threaded and read
 * only the sources, so they share the four cores instead of queueing; their output is buffered and
 * printed step by step when the group ends, so it never interleaves. `assets` runs before them (the
 * typecheck and the validator read its generated manifests); each test suite has every core to itself.
 *
 * CLI: `tsx tools/check.ts` (no arguments).
 */
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One stage of `check`: an npm script, or several independent npm scripts run side by side. */
export type CheckStage = string | readonly string[];

/** The stages of `check`, in order (cheap and most often failing first). */
export const CHECK_PLAN: readonly CheckStage[] = ['assets', ['typecheck', 'lint', 'forbidden', 'validate:content'], 'test:unit', 'test:integration:fast'];
/** npm scripts run by `check`, in plan order. */
export const CHECK_STEPS: readonly string[] = CHECK_PLAN.flatMap((stage) => (typeof stage === 'string' ? [stage] : [...stage]));
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
  /** Whether the step ran side by side with the other steps of its stage. */
  readonly parallel: boolean;
}

export interface CheckReport {
  readonly steps: readonly StepResult[];
  /** Wall time of the whole run (a group of parallel steps counts once, with its longest step). */
  readonly totalMs: number;
  readonly budgetMs: number;
  readonly overBudget: boolean;
  /** First failing step in plan order, if any. */
  readonly failedStep: string | null;
  /** 0 = green; otherwise the failing step's exit code or `EXIT_OVER_BUDGET`. */
  readonly exitCode: number;
}

export interface CheckDeps {
  /**
   * Runs one npm script and returns (or resolves to) its exit code. `parallel`: the step runs beside the
   * other steps of its stage – its output must be held back until it ends.
   */
  run(step: string, parallel: boolean): number | Promise<number>;
  /** Monotonic clock in milliseconds. */
  now(): number;
  readonly budgetMs?: number;
}

/** The steps of a stage, and whether they run side by side. */
function stageSteps(stage: CheckStage): { names: readonly string[]; parallel: boolean } {
  return typeof stage === 'string' ? { names: [stage], parallel: false } : { names: stage, parallel: stage.length > 1 };
}

/**
 * Runs the stages of `plan` in order; the steps of a group stage start together and the stage ends when
 * the last of them ends. After a stage with a failing step, every later step is reported as skipped (the
 * other steps of a group stage finish and report their own result).
 */
export async function runChecks(plan: readonly CheckStage[], deps: CheckDeps): Promise<CheckReport> {
  const budgetMs = deps.budgetMs ?? CHECK_BUDGET_MS;
  const results: StepResult[] = [];
  const start = deps.now();
  let failed: StepResult | null = null;
  for (const stage of plan) {
    const { names, parallel } = stageSteps(stage);
    if (failed) {
      for (const name of names) results.push({ name, status: 'skipped', exitCode: null, ms: 0, parallel });
      continue;
    }
    const t0 = deps.now();
    const stageResults = await Promise.all(
      names.map(async (name): Promise<StepResult> => {
        const exitCode = await deps.run(name, parallel);
        return { name, status: exitCode === 0 ? 'ok' : 'failed', exitCode, ms: deps.now() - t0, parallel };
      }),
    );
    results.push(...stageResults);
    failed = stageResults.find((r) => r.status === 'failed') ?? null;
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

/** Compact timing table, one line per step (steps that ran side by side are marked) plus the total against the budget. */
export function formatReport(report: CheckReport): string {
  const lines = ['check – Laufzeiten'];
  for (const s of report.steps) {
    const time = s.status === 'skipped' ? '–' : seconds(s.ms);
    const code = s.status === 'failed' ? ` (Exit ${s.exitCode ?? '?'})` : '';
    const side = s.parallel ? '  ∥' : '';
    lines.push(`  ${s.name.padEnd(NAME_COLUMN)}${time.padStart(TIME_COLUMN)}  ${STATUS_TEXT[s.status]}${code}${side}`);
  }
  const verdict = report.overBudget ? 'ZU LANGSAM' : 'im Budget';
  lines.push(`  ${'gesamt'.padEnd(NAME_COLUMN)}${seconds(report.totalMs).padStart(TIME_COLUMN)}  ${verdict} (Budget ${seconds(report.budgetMs)})`);
  if (report.steps.some((s) => s.parallel)) lines.push('  ∥ = lief gleichzeitig mit den anderen ∥-Schritten; „gesamt“ ist Wandzeit.');
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

/**
 * Runs one npm script beside others: its stdout and stderr are kept (in arrival order) and written in one
 * piece, under a heading, when it ends. A signal-terminated or unstartable step counts as exit 1.
 */
function runNpmScriptBuffered(step: string): Promise<number> {
  return new Promise((done) => {
    const out: Array<{ readonly err: boolean; readonly chunk: Buffer }> = [];
    const child = spawn('npm', ['run', step], { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    child.stdout.on('data', (chunk: Buffer) => out.push({ err: false, chunk }));
    child.stderr.on('data', (chunk: Buffer) => out.push({ err: true, chunk }));
    let settled = false;
    const finish = (code: number, note: string | null): void => {
      if (settled) return;
      settled = true;
      process.stdout.write(`\n── check: npm run ${step} ──\n`);
      for (const o of out) (o.err ? process.stderr : process.stdout).write(o.chunk);
      if (note !== null) console.error(note);
      done(code);
    };
    child.on('error', (err) => finish(1, `check: „npm run ${step}“ konnte nicht gestartet werden: ${err.message}`));
    child.on('close', (code) => finish(code ?? 1, null));
  });
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const report = await runChecks(CHECK_PLAN, { run: (step, parallel) => (parallel ? runNpmScriptBuffered(step) : runNpmScript(step)), now: () => performance.now() });
  const text = formatReport(report);
  if (report.exitCode === 0) console.log(`\n${text}`);
  else console.error(`\n${text}`);
  process.exitCode = report.exitCode;
}
