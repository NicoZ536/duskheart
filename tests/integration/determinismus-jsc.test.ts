/**
 * M7-140, WebKit's JavaScript engine without a browser (MASTERPROMPT §33 "wo WebGL2 headless nicht verfügbar ist:
 * dokumentierter Ersatznachweis"; ADR-0210): `bun` runs JavaScriptCore, the engine of WebKit and Safari. Where it is
 * installed, tests/integration/determinismus-jsc-lauf.ts computes in JavaScriptCore what this test computes in Node:
 * - the digests of the portable functions (src/engine/portableMath.ts, 200 000 argument sets each) and of the simulation's
 *   formulas that called engine trigonometry, powers, `atan2`, `tan`, `asin` or `hypot` before M7-76 and M7-139;
 * - the headless run of the fixture world (`determinismRun`: state hash every 300 ticks, event counts);
 * - the reference save (tools/save/fixture.ts, `fixtureText`) – the whole saved state of a played scenario, byte for byte.
 * All must be equal. The engine's own `Math` functions are the control: which of them differ between V8 and JavaScriptCore
 * is printed (before M7-139 the run's hashes and the fixture differed – `Math.tan`, `Math.atan2`, `Math.hypot` – after it
 * they are equal). Without `bun` the comparison is skipped with that reason; the IEEE-754 argument of
 * tests/unit/engine/portable-math-ieee.test.ts holds everywhere.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { determinismRun, engineMathDigest, portableMathDigest, simFormulaDigest, type DeterminismRun } from '../../src/debug/determinismProbe';
import { buildFixture, fixtureText } from '../../tools/save/fixture';
import { JSC_CHECKPOINT_TICKS, JSC_MATH_ARGS, JSC_RUN_TICKS } from './determinismus-jsc-parameter';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./determinismus-jsc-lauf.ts', import.meta.url));
/** A world generation, a 1 800-tick run, the fixture scenario and 3 × 200 000 digest sets in JavaScriptCore. */
const JSC_TIMEOUT_MS = 300_000;

interface JscResult {
  readonly portable: Record<string, string>;
  readonly formulas: string;
  readonly engine: Record<string, string>;
  readonly run: DeterminismRun;
  readonly fixtureSha256: string;
}

/** The version of `bun` on this machine, or null. */
function bunVersion(): string | null {
  const probe = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  return probe.status === 0 ? probe.stdout.trim() : null;
}

const BUN = bunVersion();

describe.skipIf(BUN === null)(`JavaScriptCore (bun ${BUN ?? '– nicht installiert, übersprungen'}) gibt die Bits von Node (M7-140)`, () => {
  it(
    'portable Digests, Formel-Digest, Headless-Hashes und der Referenzspielstand sind gleich',
    async () => {
      const jsc = spawnSync('bun', [SCRIPT, String(JSC_MATH_ARGS)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: JSC_TIMEOUT_MS });
      expect(jsc.status, jsc.stderr).toBe(0);
      const inJsc = JSON.parse(jsc.stdout.trim().split('\n').pop() ?? '') as JscResult;

      expect(inJsc.portable).toEqual(portableMathDigest(JSC_MATH_ARGS));
      expect(inJsc.formulas).toBe(simFormulaDigest(JSC_MATH_ARGS));
      const node = determinismRun(JSC_RUN_TICKS, JSC_CHECKPOINT_TICKS);
      expect(node.hashes).toHaveLength(JSC_RUN_TICKS / JSC_CHECKPOINT_TICKS);
      expect(inJsc.run).toEqual(node);
      expect(inJsc.fixtureSha256).toBe(createHash('sha256').update(fixtureText(await buildFixture())).digest('hex'));

      // The control (reported, not judged): the engine functions whose bits differ between V8 and JavaScriptCore.
      const engine = engineMathDigest(JSC_MATH_ARGS);
      const differ = Object.keys(engine).filter((k) => engine[k] !== inJsc.engine[k]);
      console.info(`Engine-Mathematik verschieden (Node ${process.versions.v8} ↔ JavaScriptCore, bun ${BUN ?? ''}): ${differ.length === 0 ? 'keine' : differ.join(', ')}`);
    },
    JSC_TIMEOUT_MS * 2,
  );
});
