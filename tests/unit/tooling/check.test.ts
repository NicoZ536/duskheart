/**
 * M0-03: `npm run check` (tools/check.ts) runs the §3.4 steps in order, stops at the first failure
 * with that step's exit code, prints a timing table and fails when it exceeds the 3-minute budget.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHECK_BUDGET_MS, CHECK_STEPS, EXIT_OVER_BUDGET, formatReport, runChecks, type CheckDeps } from '../../../tools/check';

const MS_PER_SECOND = 1000;
/** Three minutes in milliseconds (MASTERPROMPT §3.4: "schnell (< 3 min)"). */
const THREE_MINUTES_MS = 3 * 60 * MS_PER_SECOND;

/** Fake runner: every step takes `durations[step]` ms of fake time and exits with `codes[step]` (default 0). */
function fakeDeps(durations: Record<string, number>, codes: Record<string, number> = {}, budgetMs?: number): CheckDeps & { ran: string[] } {
  let clock = 0;
  const ran: string[] = [];
  return {
    ran,
    budgetMs,
    now: () => clock,
    run: (step) => {
      ran.push(step);
      clock += durations[step] ?? 0;
      return codes[step] ?? 0;
    },
  };
}

interface PackageJson {
  scripts: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as PackageJson;

describe('npm-Skripte (§3.4)', () => {
  it('check läuft über tools/check.ts, verify behält seine Reihenfolge', () => {
    expect(pkg.scripts.check).toBe('tsx tools/check.ts');
    expect(pkg.scripts.verify).toBe('npm run check && npm run test:integration && npm run build && npm run test:e2e && npm run bench');
  });

  it('jeder check-Schritt ist ein vorhandenes npm-Skript', () => {
    for (const step of CHECK_STEPS) expect(pkg.scripts[step], step).toBeTypeOf('string');
  });

  it('alle Pflichtskripte aus §3.4 existieren', () => {
    for (const name of ['dev', 'build', 'assets', 'check', 'test:e2e', 'shot', 'bench', 'validate:content', 'verify']) {
      expect(pkg.scripts[name], name).toBeTypeOf('string');
    }
  });

  it('check enthält Typecheck, Lint, Verbotsliste, Content-Validator, Unit- und schnelle Integrationstests', () => {
    expect(CHECK_STEPS).toEqual(['assets', 'typecheck', 'lint', 'forbidden', 'validate:content', 'test:unit', 'test:integration:fast']);
    expect(CHECK_BUDGET_MS).toBe(THREE_MINUTES_MS);
  });
});

describe('runChecks', () => {
  it('führt alle Schritte der Reihe nach aus und ist grün, wenn alle bestehen', () => {
    const deps = fakeDeps({ assets: 1000, typecheck: 5000, lint: 7000 });
    const report = runChecks(CHECK_STEPS, deps);
    expect(deps.ran).toEqual([...CHECK_STEPS]);
    expect(report.exitCode).toBe(0);
    expect(report.failedStep).toBeNull();
    expect(report.overBudget).toBe(false);
    expect(report.totalMs).toBe(13_000);
    expect(report.steps.map((s) => s.status)).toEqual(CHECK_STEPS.map(() => 'ok'));
    expect(report.steps.find((s) => s.name === 'typecheck')?.ms).toBe(5000);
  });

  it('bricht beim ersten fehlschlagenden Schritt ab und übernimmt dessen Exit-Code', () => {
    const deps = fakeDeps({ assets: 10, typecheck: 10, lint: 10 }, { lint: 3 });
    const report = runChecks(CHECK_STEPS, deps);
    expect(deps.ran).toEqual(['assets', 'typecheck', 'lint']);
    expect(report.exitCode).toBe(3);
    expect(report.failedStep).toBe('lint');
    expect(report.steps.map((s) => `${s.name}:${s.status}`)).toEqual([
      'assets:ok',
      'typecheck:ok',
      'lint:failed',
      'forbidden:skipped',
      'validate:content:skipped',
      'test:unit:skipped',
      'test:integration:fast:skipped',
    ]);
  });

  it('scheitert, wenn die Gesamtlaufzeit das Budget überschreitet', () => {
    const slow = fakeDeps({ 'test:unit': THREE_MINUTES_MS + 1 });
    const report = runChecks(CHECK_STEPS, slow);
    expect(report.overBudget).toBe(true);
    expect(report.failedStep).toBeNull();
    expect(report.exitCode).toBe(EXIT_OVER_BUDGET);
    expect(EXIT_OVER_BUDGET).not.toBe(0);

    const exact = runChecks(CHECK_STEPS, fakeDeps({ 'test:unit': THREE_MINUTES_MS }));
    expect(exact.overBudget).toBe(false);
    expect(exact.exitCode).toBe(0);
  });

  it('nutzt ein übergebenes Budget', () => {
    const report = runChecks(['a', 'b'], fakeDeps({ a: 60, b: 50 }, {}, 100));
    expect(report.budgetMs).toBe(100);
    expect(report.overBudget).toBe(true);
    expect(report.exitCode).toBe(EXIT_OVER_BUDGET);
  });

  it('ein fehlschlagender Schritt hat Vorrang vor dem Budget', () => {
    const report = runChecks(['a', 'b'], fakeDeps({ a: 500 }, { a: 2 }, 100));
    expect(report.exitCode).toBe(2);
  });
});

describe('formatReport', () => {
  it('druckt eine kompakte Zeittabelle mit Gesamtzeit und Budget', () => {
    const text = formatReport(runChecks(CHECK_STEPS, fakeDeps({ assets: 1234, lint: 5678 })));
    const lines = text.split('\n');
    expect(lines).toHaveLength(CHECK_STEPS.length + 3);
    expect(text).toMatch(/assets\s+1\.2 s\s+ok/);
    expect(text).toMatch(/lint\s+5\.7 s\s+ok/);
    expect(text).toMatch(/gesamt\s+6\.9 s\s+im Budget \(Budget 180\.0 s\)/);
    expect(lines[lines.length - 1]).toBe('check: grün.');
  });

  it('nennt den fehlgeschlagenen Schritt und übersprungene Schritte', () => {
    const text = formatReport(runChecks(CHECK_STEPS, fakeDeps({}, { typecheck: 2 })));
    expect(text).toMatch(/typecheck\s+0\.0 s\s+FEHLER \(Exit 2\)/);
    expect(text).toMatch(/lint\s+–\s+übersprungen/);
    expect(text).toContain('Schritt „typecheck“ ist fehlgeschlagen');
  });

  it('meldet eine Budgetüberschreitung', () => {
    const text = formatReport(runChecks(['a'], fakeDeps({ a: 200 }, {}, 100)));
    expect(text).toContain('ZU LANGSAM');
    expect(text).toContain('Budget aus §3.4');
  });
});
