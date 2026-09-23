/**
 * M0-12: `npm run bench` scheitert bei künstlicher Schwellwertverletzung und schreibt trotzdem den
 * JSON-Bericht. Startet die echte CLI (Node mit `--expose-gc`, nur die Sim-Szenarien).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FIXTURE = 'tests/fixtures/bench/schwellwerte-zu-eng.json';

function runBench(args: readonly string[]): { status: number | null; output: string } {
  const res = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', 'tools/bench.ts', ...args], { cwd: process.cwd(), encoding: 'utf8' });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

describe('npm run bench (CLI)', () => {
  it('scheitert bei künstlicher Schwellwertverletzung und schreibt den Bericht', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dh-bench-'));
    try {
      const report = join(dir, 'bericht.json');
      const { status, output } = runBench(['--nur', 'sim', '--schwellwerte', FIXTURE, '--bericht', report]);
      expect(output).toMatch(/FAIL sim:headless-demo\s+tick p95/);
      expect(status).toBe(1);
      const json = JSON.parse(readFileSync(report, 'utf8')) as { ok: boolean; rows: Array<{ ok: boolean }> };
      expect(json.ok).toBe(false);
      expect(json.rows.some((r) => !r.ok)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('meldet falsche Bedienung mit Exit-Code 2', () => {
    expect(runBench(['--nur', 'gpu']).status).toBe(2);
  });
});
