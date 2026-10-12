/**
 * M7-76 acceptance (ADR-0210; docs/ARCHITEKTUR.md "Determinismus über JS-Engines"): the simulation gives the same bits in
 * Node – the tests, the headless runs, the fixture – and in the browser the player plays in.
 *
 * - The portable functions (`src/engine/portableMath.ts`: `psin`, `pcos`, `sinCosIn`, `plog`, `pexp`, `pexp2`, `ppow`) over
 *   200 000 argument sets: the page's digests (`__dh.call('mathDigest')`) equal the ones this Node process computes from the
 *   same module (src/debug/determinismProbe.ts). The engine's own `Math` functions over the same arguments are the control:
 *   which of them differ between this Node and this Chromium is reported (annotation), not judged – it is why the
 *   simulation may not call `Math.sin`, `Math.cos`, `Math.pow` or `**` (tools/forbidden.ts). The simulation's own formulas
 *   that called them before (drop spots, event points, boss circles and rings, block and sight cones, the sun's shadow,
 *   light cones and flicker, angle vectors, the XP table) give the same digest in the page as in Node.
 * - A headless run of the fixture world (seed 3, Klein; `determinismRun`): dusk, a wolf pack hunting and biting, a Speier
 *   spitting, the player's blows in eight directions while walking, fear with its hallucinations, the Lumen rain and
 *   lightning – 1 800 ticks after the set-up. The state hash after every 300 ticks and the event counts in the page
 *   (`__dh.call('determinismRun')`) equal Node's; the run demonstrably reaches the code that used engine trigonometry
 *   (bites, blows, shots, drops, lightning, vanished hallucinations).
 * No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { determinismRun, engineMathDigest, portableMathDigest, simFormulaDigest, type DeterminismRun } from '../../src/debug/determinismProbe';
import { logicUrl } from './logik';

interface Dh {
  ready: boolean;
  call(name: string, ...args: unknown[]): unknown;
}

/** Argument sets of the math digests. */
const MATH_ARGS = 200_000;
/** Ticks of the scripted run after its set-up, and the distance of its hash checkpoints. */
const RUN_TICKS = 1_800;
const CHECKPOINT_TICKS = 300;
/** A run in the page plus the world generation takes a few seconds on the main thread beside SwiftShader. */
const RUN_TIMEOUT_MS = 180_000;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function open(page: Page): Promise<void> {
  await page.goto(logicUrl());
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
}

function dh<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: Dh }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

test('portable Mathematik: die Seite und Node geben dieselben Bits (Engine-Mathematik als Kontrolle)', async ({ page }) => {
  const messages = collectConsole(page);
  await open(page);
  const inPage = await dh<{ portable: Record<string, string>; engine: Record<string, string>; formulas: string }>(page, 'mathDigest', MATH_ARGS);
  const portable = portableMathDigest(MATH_ARGS);
  expect(Object.keys(portable)).toEqual(['sin', 'cos', 'sinCos', 'log', 'exp', 'exp2', 'pow']);
  expect(inPage.portable).toEqual(portable);
  // The simulation's own formulas that called engine trigonometry or powers before M7-76.
  expect(inPage.formulas).toBe(simFormulaDigest(MATH_ARGS));
  // The control: which engine functions differ between this Node and this Chromium (reported, not judged).
  const engine = engineMathDigest(MATH_ARGS);
  const differ = Object.keys(engine).filter((k) => engine[k] !== inPage.engine[k]);
  test.info().annotations.push({ type: 'Engine-Mathematik verschieden (Node ↔ Chromium)', description: differ.length === 0 ? 'keine' : differ.join(', ') });
  console.info(`Engine-Mathematik verschieden (Node ${process.versions.v8} ↔ Chromium): ${differ.length === 0 ? 'keine' : differ.join(', ')}`);
  expect(messages).toEqual([]);
});

test('Zustands-Hash eines Headless-Laufs: im Browser derselbe wie in Node', async ({ page }) => {
  test.setTimeout(RUN_TIMEOUT_MS);
  const messages = collectConsole(page);
  await open(page);
  const inPage = await dh<DeterminismRun>(page, 'determinismRun', RUN_TICKS, CHECKPOINT_TICKS);
  const node = determinismRun(RUN_TICKS, CHECKPOINT_TICKS);
  // The run reaches the code that called the engine's trigonometry: creatures' bites and shots (facing, arc), the player's
  // blows and the hallucinations they dissolve (arc), drops and the Lumen rain's shards (scatter), lightning (strike spot).
  for (const type of ['creatureAttack', 'projectileFired', 'hitLanded', 'dropSpawned', 'lumenShardFell', 'lightningStruck', 'hallucinationVanished', 'xpGained']) {
    expect(node.events[type] ?? 0, type).toBeGreaterThan(0);
  }
  expect(node.hashes).toHaveLength(RUN_TICKS / CHECKPOINT_TICKS);
  expect(inPage.tick).toBe(node.tick);
  expect(inPage.hashes).toEqual(node.hashes);
  expect(inPage.events).toEqual(node.events);
  expect(messages).toEqual([]);
});
