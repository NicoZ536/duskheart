/**
 * M0-03: `npm run check` (tools/check.ts) runs the §3.4 steps stage by stage, stops after the first failure
 * with that step's exit code, prints a timing table and fails when it exceeds the 3-minute budget.
 * M4-37 (ADR-0036): the independent static checks form one stage whose steps run side by side; the run's
 * wall time counts such a stage once.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHECK_BUDGET_MS, CHECK_PLAN, CHECK_STEPS, EXIT_OVER_BUDGET, formatReport, runChecks, type CheckDeps } from '../../../tools/check';

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

/** Lets pending promise callbacks run (a step that ended hands over to the next stage). */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Fake runner whose steps end only when the test ends them, at a fake time of its choosing. */
function manualDeps(codes: Record<string, number> = {}): CheckDeps & { started: string[]; parallel: Record<string, boolean>; end(step: string, atMs: number): Promise<void> } {
  let clock = 0;
  const started: string[] = [];
  const parallel: Record<string, boolean> = {};
  const pending = new Map<string, () => void>();
  return {
    started,
    parallel,
    now: () => clock,
    run: (step, side) => {
      started.push(step);
      parallel[step] = side;
      return new Promise<number>((resolve) => pending.set(step, () => resolve(codes[step] ?? 0)));
    },
    async end(step, atMs) {
      const finish = pending.get(step);
      if (finish === undefined) throw new Error(`${step} läuft nicht`);
      pending.delete(step);
      clock = atMs;
      finish();
      await settle();
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

  it('die statischen Prüfungen laufen nach assets gleichzeitig, die Testsuiten danach je allein', () => {
    expect(CHECK_PLAN).toEqual(['assets', ['typecheck', 'lint', 'forbidden', 'validate:content'], 'test:unit', 'test:integration:fast']);
  });
});

describe('runChecks', () => {
  it('führt alle Schritte der Reihe nach aus und ist grün, wenn alle bestehen', async () => {
    const deps = fakeDeps({ assets: 1000, typecheck: 5000, lint: 7000 });
    const report = await runChecks(CHECK_STEPS, deps);
    expect(deps.ran).toEqual([...CHECK_STEPS]);
    expect(report.exitCode).toBe(0);
    expect(report.failedStep).toBeNull();
    expect(report.overBudget).toBe(false);
    expect(report.totalMs).toBe(13_000);
    expect(report.steps.map((s) => s.status)).toEqual(CHECK_STEPS.map(() => 'ok'));
    expect(report.steps.find((s) => s.name === 'typecheck')?.ms).toBe(5000);
  });

  it('bricht beim ersten fehlschlagenden Schritt ab und übernimmt dessen Exit-Code', async () => {
    const deps = fakeDeps({ assets: 10, typecheck: 10, lint: 10 }, { lint: 3 });
    const report = await runChecks(CHECK_STEPS, deps);
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

  it('scheitert, wenn die Gesamtlaufzeit das Budget überschreitet', async () => {
    const slow = fakeDeps({ 'test:unit': THREE_MINUTES_MS + 1 });
    const report = await runChecks(CHECK_STEPS, slow);
    expect(report.overBudget).toBe(true);
    expect(report.failedStep).toBeNull();
    expect(report.exitCode).toBe(EXIT_OVER_BUDGET);
    expect(EXIT_OVER_BUDGET).not.toBe(0);

    const exact = await runChecks(CHECK_STEPS, fakeDeps({ 'test:unit': THREE_MINUTES_MS }));
    expect(exact.overBudget).toBe(false);
    expect(exact.exitCode).toBe(0);
  });

  it('nutzt ein übergebenes Budget', async () => {
    const report = await runChecks(['a', 'b'], fakeDeps({ a: 60, b: 50 }, {}, 100));
    expect(report.budgetMs).toBe(100);
    expect(report.overBudget).toBe(true);
    expect(report.exitCode).toBe(EXIT_OVER_BUDGET);
  });

  it('ein fehlschlagender Schritt hat Vorrang vor dem Budget', async () => {
    const report = await runChecks(['a', 'b'], fakeDeps({ a: 500 }, { a: 2 }, 100));
    expect(report.exitCode).toBe(2);
  });

  it('startet die Schritte einer Gruppe gleichzeitig; die Gruppe zählt einmal mit ihrem längsten Schritt', async () => {
    const deps = manualDeps();
    const running = runChecks(['vorher', ['a', 'b', 'c'], 'danach'], deps);
    await settle();
    expect(deps.started).toEqual(['vorher']);
    await deps.end('vorher', 10);
    // All three started before any of them ended; the next stage waits for the last one.
    expect(deps.started).toEqual(['vorher', 'a', 'b', 'c']);
    await deps.end('b', 40);
    await deps.end('a', 60);
    expect(deps.started).not.toContain('danach');
    await deps.end('c', 90);
    expect(deps.started).toEqual(['vorher', 'a', 'b', 'c', 'danach']);
    await deps.end('danach', 100);
    const report = await running;
    expect(deps.parallel).toEqual({ vorher: false, a: true, b: true, c: true, danach: false });
    expect(report.steps.map((s) => [s.name, s.status, s.ms, s.parallel])).toEqual([
      ['vorher', 'ok', 10, false],
      ['a', 'ok', 50, true],
      ['b', 'ok', 30, true],
      ['c', 'ok', 80, true],
      ['danach', 'ok', 10, false],
    ]);
    // Wall time, not the sum of the steps (10 + 50 + 30 + 80 + 10 = 180).
    expect(report.totalMs).toBe(100);
    expect(report.exitCode).toBe(0);
  });

  it('ein roter Schritt einer Gruppe: die anderen laufen zu Ende und melden sich, spätere Stufen entfallen', async () => {
    const deps = manualDeps({ b: 4 });
    const running = runChecks([['a', 'b'], 'danach'], deps);
    await settle();
    await deps.end('b', 5);
    expect(deps.started).toEqual(['a', 'b']);
    await deps.end('a', 20);
    const report = await running;
    expect(deps.started).toEqual(['a', 'b']);
    expect(report.steps.map((s) => `${s.name}:${s.status}`)).toEqual(['a:ok', 'b:failed', 'danach:skipped']);
    expect(report.failedStep).toBe('b');
    expect(report.exitCode).toBe(4);
  });

  it('scheitern mehrere Schritte einer Gruppe, zählt der erste in Plan-Reihenfolge – nicht der zuerst fertige', async () => {
    const deps = manualDeps({ a: 2, b: 3 });
    const running = runChecks([['a', 'b']], deps);
    await settle();
    await deps.end('b', 5);
    await deps.end('a', 9);
    const report = await running;
    expect(report.failedStep).toBe('a');
    expect(report.exitCode).toBe(2);
    expect(report.steps.map((s) => s.exitCode)).toEqual([2, 3]);
  });

  it('eine Gruppe über dem Budget scheitert wie ein einzelner Schritt', async () => {
    const deps = { ...manualDeps(), budgetMs: 100 };
    const running = runChecks([['a', 'b']], deps);
    await settle();
    await deps.end('a', 101);
    await deps.end('b', 101);
    const report = await running;
    expect(report.overBudget).toBe(true);
    expect(report.exitCode).toBe(EXIT_OVER_BUDGET);
  });
});

describe('formatReport', () => {
  it('druckt eine kompakte Zeittabelle mit Gesamtzeit und Budget', async () => {
    const text = formatReport(await runChecks(CHECK_STEPS, fakeDeps({ assets: 1234, lint: 5678 })));
    const lines = text.split('\n');
    expect(lines).toHaveLength(CHECK_STEPS.length + 3);
    expect(text).toMatch(/assets\s+1\.2 s\s+ok/);
    expect(text).toMatch(/lint\s+5\.7 s\s+ok/);
    expect(text).toMatch(/gesamt\s+6\.9 s\s+im Budget \(Budget 180\.0 s\)/);
    expect(lines[lines.length - 1]).toBe('check: grün.');
  });

  it('nennt den fehlgeschlagenen Schritt und übersprungene Schritte', async () => {
    const text = formatReport(await runChecks(CHECK_STEPS, fakeDeps({}, { typecheck: 2 })));
    expect(text).toMatch(/typecheck\s+0\.0 s\s+FEHLER \(Exit 2\)/);
    expect(text).toMatch(/lint\s+–\s+übersprungen/);
    expect(text).toContain('Schritt „typecheck“ ist fehlgeschlagen');
  });

  it('markiert gleichzeitig gelaufene Schritte und erklärt die Marke', async () => {
    const text = formatReport(await runChecks(['vorher', ['a', 'b']], fakeDeps({ vorher: 1000, a: 2000 })));
    const lines = text.split('\n');
    expect(lines).toHaveLength(3 + 4);
    expect(text).toMatch(/vorher\s+1\.0 s\s+ok$/m);
    expect(text).toMatch(/a\s+\d+\.\d s\s+ok\s+∥$/m);
    expect(text).toMatch(/b\s+\d+\.\d s\s+ok\s+∥$/m);
    expect(text).toContain('∥ = lief gleichzeitig');
    expect(lines[lines.length - 1]).toBe('check: grün.');
  });

  it('meldet eine Budgetüberschreitung', async () => {
    const text = formatReport(await runChecks(['a'], fakeDeps({ a: 200 }, {}, 100)));
    expect(text).toContain('ZU LANGSAM');
    expect(text).toContain('Budget aus §3.4');
  });
});
