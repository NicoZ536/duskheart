/**
 * M1-10: `WEBGL_lose_context` – während der Grafikkontext fehlt, tickt die Simulation lückenlos
 * weiter; nach `restoreContext()` baut der Renderer alle GPU-Ressourcen neu auf und die Szene
 * erscheint wieder pixelgleich.
 */
import { expect, test, type Page } from '@playwright/test';

type Rgba = readonly [number, number, number, number];

interface DhRender {
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
  screenshotMode(on: boolean): void;
  freezeTime(on: boolean): void;
}

interface RenderInfo {
  frames: number;
  contextLost: boolean;
  contextLosses: number;
  contextRestores: number;
  resources: number;
  resourceRestores: number;
}

const POINTS: ReadonlyArray<readonly [number, number]> = [
  [480, 540],
  [720, 480],
  [960, 700],
  [1400, 300],
  [300, 900],
];
/** Wall time the context stays lost, and the ticks the simulation must make meanwhile (60 Hz). */
const LOST_MS = 1000;
const MIN_TICKS_WHILE_LOST = 30;

/** 1920×1080: internal 480×270 at exactly ×4 (no linear step, palette-exact pixels). */
test.use({ viewport: { width: 1920, height: 1080 } });

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function dh<T>(page: Page, name: string): Promise<T> {
  return page.evaluate((n) => (window as unknown as { __dh: DhRender }).__dh.call(n) as T, name);
}

function probe(page: Page): Promise<Rgba[]> {
  return page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: DhRender }).__dh;
    return Promise.all(pts.map(([x, y]) => d.readPixel(x, y)));
  }, POINTS);
}

/** Loses or restores the context through WEBGL_lose_context (kept from before the loss: a lost context hands out no extensions). */
function loseContext(page: Page, lose: boolean): Promise<void> {
  return page.evaluate((l) => {
    const w = window as unknown as { __dhLoseContext?: WEBGL_lose_context | null };
    if (w.__dhLoseContext === undefined) {
      const canvas = document.getElementById('dh-canvas') as HTMLCanvasElement;
      w.__dhLoseContext = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null;
    }
    const ext = w.__dhLoseContext;
    if (!ext) throw new Error('WEBGL_lose_context fehlt');
    if (l) ext.loseContext();
    else ext.restoreContext();
  }, lose);
}

test('Kontextverlust: Simulation tickt weiter, Szene erscheint nach dem Wiederherstellen', async ({ page }) => {
  const msgs = collectConsole(page);
  await page.goto('/?debug=1&scenario=gbuffer-albedo');
  await page.waitForFunction(() => (window as unknown as { __dh?: DhRender }).__dh?.call('scenarioReady') === true);
  // The picture stays frozen (scenario time), the simulation runs.
  await page.evaluate(() => {
    const d = (window as unknown as { __dh: DhRender }).__dh;
    d.screenshotMode(false);
    d.freezeTime(false);
  });
  await page.waitForFunction(() => ((window as unknown as { __dh: DhRender }).__dh.call('tick') as number) > 10);
  const before = await probe(page);
  const resources = (await dh<RenderInfo>(page, 'renderInfo')).resources;

  await loseContext(page, true);
  await page.waitForFunction(() => ((window as unknown as { __dh: DhRender }).__dh.call('renderInfo') as RenderInfo).contextLost);
  const tickLost = await dh<number>(page, 'tick');
  const framesLost = (await dh<RenderInfo>(page, 'renderInfo')).frames;
  await page.waitForTimeout(LOST_MS);
  const tickStillLost = await dh<number>(page, 'tick');
  expect(tickStillLost - tickLost).toBeGreaterThanOrEqual(MIN_TICKS_WHILE_LOST);
  expect((await dh<RenderInfo>(page, 'renderInfo')).frames).toBe(framesLost);

  await loseContext(page, false);
  await page.waitForFunction(() => {
    const info = (window as unknown as { __dh: DhRender }).__dh.call('renderInfo') as RenderInfo;
    return !info.contextLost && info.contextRestores === 1;
  });
  await page.waitForFunction((f) => ((window as unknown as { __dh: DhRender }).__dh.call('renderInfo') as RenderInfo).frames > f + 3, framesLost);
  const info = await dh<RenderInfo>(page, 'renderInfo');
  expect(info.contextLosses).toBe(1);
  expect(info.resourceRestores).toBe(1);
  expect(info.resources).toBe(resources);
  expect(await probe(page)).toEqual(before);
  expect(await dh<number>(page, 'tick')).toBeGreaterThan(tickStillLost);
  // Chromium reports the deliberate loss as a WebGL warning; nothing else may appear.
  for (const m of msgs) expect(m).toMatch(/WebGL.*(CONTEXT_LOST|context lost)/i);
});
