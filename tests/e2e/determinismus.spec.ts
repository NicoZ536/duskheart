/**
 * M7-76 acceptance (ADR-0210; docs/ARCHITEKTUR.md "Determinismus über JS-Engines"): the simulation gives the same bits in
 * Node – the tests, the headless runs, the fixture – and in the browser the player plays in.
 *
 * - The portable functions (`src/engine/portableMath.ts`: `psin`, `pcos`, `sinCosIn`, `plog`, `pexp`, `pexp2`, `ppow`, and
 *   since M7-139 `ptan`, `patan2`, `pasin`, `phypot`) over 200 000 argument sets: the page's digests
 *   (`__dh.call('mathDigest')`) equal the ones this Node process computes from the same module
 *   (src/debug/determinismProbe.ts). The engine's own `Math` functions over the same arguments are the control: which of
 *   them differ between this Node and this browser is reported (annotation), not judged – it is why the simulation may not
 *   call them (tools/forbidden.ts, rule `sim-engine-math`). The simulation's own formulas that called them before (drop
 *   spots, event points, boss circles, rings and cones, block and sight cones, the sun's shadow, light cones and flicker,
 *   angle vectors, aim and turn angles, magnet and interaction distances, the XP table) give the same digest in the page as
 *   in Node.
 * - A headless run of the fixture world (seed 3, Klein; `determinismRun`): dusk, a wolf pack hunting and biting, a Speier
 *   spitting, the player's blows in eight directions while walking, fear with its hallucinations, the Lumen rain and
 *   lightning – 1 800 ticks after the set-up. The state hash after every 300 ticks and the event counts in the page
 *   (`__dh.call('determinismRun')`) equal Node's; the run demonstrably reaches the code that used engine trigonometry
 *   (bites, blows, shots, drops, lightning, vanished hallucinations).
 * No console errors or warnings.
 *
 * M7-140 (MASTERPROMPT §33 "Smoke-Tests in Chromium, Firefox und WebKit"): this spec runs in the projects `chromium`,
 * `firefox` and `webkit` (playwright.config.ts).
 * - "JS-Engine allein": the same probe, bundled for a bare page (no app, no WebGL2 – only the browser's JS engine), gives
 *   Node's digests and Node's headless hashes. That is what the determinism depends on, and it needs no GPU.
 * - The app page needs WebGL2 headless: where a browser has none, its two app tests are skipped with that reason and the
 *   engine tests are the substitute evidence (§33).
 * - A browser that is not installed on this machine (Playwright's browsers under `PLAYWRIGHT_BROWSERS_PATH`) skips the
 *   whole spec with the reason "nicht installiert" and its expected path. tests/unit/engine/portable-math-ieee.test.ts
 *   proves the premise everywhere (the portable functions are pure IEEE-754 arithmetic), and
 *   tests/integration/determinismus-jsc.test.ts runs the probe in JavaScriptCore (WebKit's engine) where `bun` exists.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, expect, firefox, test, webkit, type BrowserType, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { determinismRun, engineMathDigest, portableMathDigest, simFormulaDigest, type DeterminismRun } from '../../src/debug/determinismProbe';
import { logicUrl } from './logik';

interface Dh {
  ready: boolean;
  call(name: string, ...args: unknown[]): unknown;
}

/** The probe's functions in a bare page (the bundle's global, see `probeBundle`). */
interface BareProbe {
  portableMathDigest(count: number): Record<string, string>;
  engineMathDigest(count: number): Record<string, string>;
  simFormulaDigest(count: number): string;
  determinismRun(ticks: number, checkpointTicks: number): DeterminismRun;
}

/** Argument sets of the math digests. */
const MATH_ARGS = 200_000;
/** Ticks of the scripted run after its set-up, and the distance of its hash checkpoints. */
const RUN_TICKS = 1_800;
const CHECKPOINT_TICKS = 300;
/** A run in the page plus the world generation takes a few seconds on the main thread beside SwiftShader. */
const RUN_TIMEOUT_MS = 180_000;
/** The portable functions the digests cover (M7-76, M7-139). */
const PORTABLE_KEYS = ['sin', 'cos', 'sinCos', 'log', 'exp', 'exp2', 'pow', 'tan', 'atan2', 'asin', 'hypot'];
/** Global name of the bundled probe in a bare page. */
const PROBE_GLOBAL = '__determinismProbe';
const PROBE_ENTRY = fileURLToPath(new URL('../../src/debug/determinismProbe.ts', import.meta.url));

const BROWSER_TYPES: Readonly<Record<string, BrowserType>> = { chromium, firefox, webkit };

/** Where Playwright expects `browserName`'s executable, and whether it is there (M7-140: never downloaded by a test). */
function browserExecutable(browserName: string): { path: string; installed: boolean } {
  const type = BROWSER_TYPES[browserName];
  if (type === undefined) return { path: '', installed: false };
  const path = type.executablePath();
  return { path, installed: path !== '' && existsSync(path) };
}

// Before any page exists: a browser that is not installed is never launched (and never downloaded).
test.beforeEach(({ browserName }) => {
  const exe = browserExecutable(browserName);
  test.skip(!exe.installed, `${browserName} nicht installiert (erwartet: ${exe.path || 'unbekannt'}; Ersatznachweis: portable-math-ieee.test.ts, determinismus-jsc.test.ts – M7-140)`);
});

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

/** Skips an app test in a browser without WebGL2 headless (the app needs it; the engine tests stand in, §33). */
async function needWebGl2(page: Page, browserName: string): Promise<void> {
  if (browserName === 'chromium') return;
  await page.setContent('<!doctype html><title>webgl2</title>');
  const webgl2 = await page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null);
  test.skip(!webgl2, `${browserName}: kein WebGL2 headless – die App-Seite startet nicht; Ersatznachweis sind die Tests „JS-Engine allein“ (§33)`);
}

let bundle: Promise<string> | null = null;

/**
 * The probe module bundled into one script for a bare page (esbuild, as Vite and tsx use it): the same source the app and
 * Node run, without the app around it. `import.meta.env` is absent as in Node (the content check runs in its Node mode).
 */
function probeBundle(): Promise<string> {
  bundle ??= build({
    entryPoints: [PROBE_ENTRY],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: PROBE_GLOBAL,
    platform: 'browser',
    target: 'es2022',
    define: { 'import.meta.env': 'undefined' },
    logLevel: 'error',
  }).then((out) => {
    const file = out.outputFiles[0];
    if (file === undefined) throw new Error('determinismProbe: esbuild gab keine Ausgabe');
    return file.text;
  });
  return bundle;
}

/** A bare page holding only the bundled probe. */
async function openBare(page: Page): Promise<void> {
  await page.setContent('<!doctype html><meta charset="utf-8"><title>Determinismus-Probe</title>');
  await page.addScriptTag({ content: await probeBundle() });
  await page.waitForFunction((name) => typeof (window as unknown as Record<string, unknown>)[name] === 'object', PROBE_GLOBAL);
}

function bare<K extends keyof BareProbe>(page: Page, fn: K, ...args: Parameters<BareProbe[K]>): Promise<ReturnType<BareProbe[K]>> {
  return page.evaluate(
    ([g, f, a]) => {
      const probe = (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>)[g as string];
      if (probe === undefined) throw new Error(`${g as string} fehlt`);
      return (probe[f as string] as (...x: unknown[]) => unknown)(...(a as unknown[])) as ReturnType<BareProbe[K]>;
    },
    [PROBE_GLOBAL, fn, args] as const,
  );
}

/** Which engine functions differ between this Node and the browser (reported, not judged). */
function reportEngineDifferences(browserName: string, inBrowser: Record<string, string>, label: string): void {
  const engine = engineMathDigest(MATH_ARGS);
  const differ = Object.keys(engine).filter((k) => engine[k] !== inBrowser[k]);
  const text = differ.length === 0 ? 'keine' : differ.join(', ');
  test.info().annotations.push({ type: `Engine-Mathematik verschieden (Node ↔ ${browserName}, ${label})`, description: text });
  console.info(`Engine-Mathematik verschieden (Node ${process.versions.v8} ↔ ${browserName}, ${label}): ${text}`);
}

/** The run reaches the code that called the engine's trigonometry before M7-76 and M7-139. */
function expectReachedTrigCode(node: DeterminismRun): void {
  // Creatures' bites and shots (facing, arc, aim angle), the player's blows and the hallucinations they dissolve (arc), drops
  // and the Lumen rain's shards (scatter, magnet), lightning (strike spot).
  for (const type of ['creatureAttack', 'projectileFired', 'hitLanded', 'dropSpawned', 'lumenShardFell', 'lightningStruck', 'hallucinationVanished', 'xpGained']) {
    expect(node.events[type] ?? 0, type).toBeGreaterThan(0);
  }
  expect(node.hashes).toHaveLength(RUN_TICKS / CHECKPOINT_TICKS);
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

test('portable Mathematik: die Seite und Node geben dieselben Bits (Engine-Mathematik als Kontrolle)', async ({ page, browserName }) => {
  await needWebGl2(page, browserName);
  const messages = collectConsole(page);
  await open(page);
  const inPage = await dh<{ portable: Record<string, string>; engine: Record<string, string>; formulas: string }>(page, 'mathDigest', MATH_ARGS);
  const portable = portableMathDigest(MATH_ARGS);
  expect(Object.keys(portable)).toEqual(PORTABLE_KEYS);
  expect(inPage.portable).toEqual(portable);
  // The simulation's own formulas that called engine trigonometry or powers before M7-76 and M7-139.
  expect(inPage.formulas).toBe(simFormulaDigest(MATH_ARGS));
  // The control: which engine functions differ between this Node and this browser (reported, not judged).
  reportEngineDifferences(browserName, inPage.engine, 'App');
  expect(messages).toEqual([]);
});

test('Zustands-Hash eines Headless-Laufs: im Browser derselbe wie in Node', async ({ page, browserName }) => {
  test.setTimeout(RUN_TIMEOUT_MS);
  await needWebGl2(page, browserName);
  const messages = collectConsole(page);
  await open(page);
  const inPage = await dh<DeterminismRun>(page, 'determinismRun', RUN_TICKS, CHECKPOINT_TICKS);
  const node = determinismRun(RUN_TICKS, CHECKPOINT_TICKS);
  expectReachedTrigCode(node);
  expect(inPage.tick).toBe(node.tick);
  expect(inPage.hashes).toEqual(node.hashes);
  expect(inPage.events).toEqual(node.events);
  expect(messages).toEqual([]);
});

test.describe('JS-Engine allein (M7-140): die Probe ohne App und ohne WebGL2', () => {
  test('portable Mathematik und Simulationsformeln: dieselben Bits wie in Node', async ({ page, browserName }) => {
    test.setTimeout(RUN_TIMEOUT_MS);
    const messages = collectConsole(page);
    await openBare(page);
    const portable = portableMathDigest(MATH_ARGS);
    expect(Object.keys(portable)).toEqual(PORTABLE_KEYS);
    expect(await bare(page, 'portableMathDigest', MATH_ARGS)).toEqual(portable);
    expect(await bare(page, 'simFormulaDigest', MATH_ARGS)).toBe(simFormulaDigest(MATH_ARGS));
    reportEngineDifferences(browserName, await bare(page, 'engineMathDigest', MATH_ARGS), 'JS-Engine allein');
    expect(messages).toEqual([]);
  });

  test('Zustands-Hash eines Headless-Laufs: in der Engine derselbe wie in Node', async ({ page }) => {
    test.setTimeout(RUN_TIMEOUT_MS);
    const messages = collectConsole(page);
    await openBare(page);
    const inEngine = await bare(page, 'determinismRun', RUN_TICKS, CHECKPOINT_TICKS);
    const node = determinismRun(RUN_TICKS, CHECKPOINT_TICKS);
    expectReachedTrigCode(node);
    expect(inEngine.tick).toBe(node.tick);
    expect(inEngine.hashes).toEqual(node.hashes);
    expect(inEngine.events).toEqual(node.events);
    expect(messages).toEqual([]);
  });
});
