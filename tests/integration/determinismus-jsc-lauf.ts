/**
 * The JavaScriptCore side of tests/integration/determinismus-jsc.test.ts (M7-140): run by `bun` (whose engine is WebKit's
 * JavaScriptCore), it computes what the test computes in Node – the probe's digests (src/debug/determinismProbe.ts), the
 * headless run of the fixture world and the reference save (tools/save/fixture.ts) – and prints them as one JSON line.
 * Argument: the number of argument sets of the digests.
 */
import { createHash } from 'node:crypto';
import { determinismRun, engineMathDigest, portableMathDigest, simFormulaDigest } from '../../src/debug/determinismProbe';
import { buildFixture, fixtureText } from '../../tools/save/fixture';
import { JSC_RUN_TICKS, JSC_CHECKPOINT_TICKS } from './determinismus-jsc-parameter';

const count = Number(process.argv[2]);
if (!Number.isSafeInteger(count) || count < 1) throw new RangeError('determinismus-jsc-lauf: Anzahl der Argumentsätze fehlt');
const fixture = fixtureText(await buildFixture());
console.log(
  JSON.stringify({
    portable: portableMathDigest(count),
    formulas: simFormulaDigest(count),
    engine: engineMathDigest(count),
    run: determinismRun(JSC_RUN_TICKS, JSC_CHECKPOINT_TICKS),
    fixtureSha256: createHash('sha256').update(fixture).digest('hex'),
  }),
);
